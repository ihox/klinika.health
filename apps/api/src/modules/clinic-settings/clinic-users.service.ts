import { randomBytes } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectPinoLogger, type PinoLogger } from 'nestjs-pino';

import { AuditLogService, type AuditFieldDiff } from '../../common/audit/audit-log.service';
import type { RequestContext } from '../../common/request-context/request-context';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { PasswordService } from '../auth/password.service';
import { EmailService } from '../email/email.service';
import {
  type ClinicUserRow,
  type CreateUserRequest,
  type UpdateUserRequest,
} from './clinic-settings.dto';
import { ClinicStorageService } from './clinic-storage.service';

const TEMP_PASSWORD_BYTES = 12;
const ROLE_LABEL: Record<'doctor' | 'receptionist' | 'clinic_admin', string> = {
  doctor: 'mjek',
  receptionist: 'infermier/e',
  clinic_admin: 'administrator',
};

/**
 * Users tab on clinic settings. Add / edit / activate-deactivate.
 *
 *   - Cannot hard-delete (audit-log integrity per CLAUDE.md §1).
 *   - Cannot deactivate yourself or the last active clinic_admin
 *     (would lock the clinic out of administration).
 *   - New users get a temporary password by email; they rotate it on
 *     first login.
 *
 * Doctor signatures are uploaded separately via the storage controller.
 */
@Injectable()
export class ClinicUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly email: EmailService,
    private readonly audit: AuditLogService,
    private readonly storage: ClinicStorageService,
    private readonly auth: AuthService,
    @InjectPinoLogger(ClinicUsersService.name)
    private readonly logger: PinoLogger,
  ) {}

  async list(clinicId: string): Promise<ClinicUserRow[]> {
    const users = await this.prisma.user.findMany({
      where: { clinicId, deletedAt: null },
      orderBy: [{ isActive: 'desc' }, { lastName: 'asc' }],
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        title: true,
        credential: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
      },
    });
    const signaturePresence = await Promise.all(
      users.map((u) => this.storage.hasUserSignature(clinicId, u.id)),
    );
    return users.map((u, i) => ({
      id: u.id,
      email: u.email,
      firstName: u.firstName,
      lastName: u.lastName,
      role: u.role,
      title: u.title,
      credential: u.credential,
      hasSignature: signaturePresence[i] ?? false,
      isActive: u.isActive,
      lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
      createdAt: u.createdAt.toISOString(),
    }));
  }

  async create(
    clinicId: string,
    payload: CreateUserRequest,
    ctx: RequestContext,
  ): Promise<ClinicUserRow> {
    const taken = await this.prisma.user.findUnique({ where: { email: payload.email } });
    if (taken) {
      throw new ConflictException('Ky email është tashmë i regjistruar.');
    }
    const inviter = await this.prisma.user.findUnique({
      where: { id: ctx.userId! },
      select: { firstName: true, lastName: true, title: true },
    });
    const clinic = await this.prisma.clinic.findUniqueOrThrow({
      where: { id: clinicId },
      select: { name: true, subdomain: true },
    });

    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await this.passwords.hash(temporaryPassword);

    const created = await this.prisma.user.create({
      data: {
        clinicId,
        email: payload.email,
        passwordHash,
        role: payload.role,
        firstName: payload.firstName,
        lastName: payload.lastName,
        title: payload.title ?? null,
        credential: payload.credential ?? null,
        isActive: true,
      },
    });

    try {
      await this.email.sendUserInvite(payload.email, {
        firstName: payload.firstName,
        clinicName: clinic.name,
        inviterName: inviter ? `${inviter.title ? `${inviter.title} ` : ''}${inviter.firstName} ${inviter.lastName}`.trim() : 'Administratori',
        loginUrl: `https://${clinic.subdomain}.klinika.health/login`,
        temporaryPassword,
        role: payload.role,
      });
    } catch (err: unknown) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err), userId: created.id },
        'User invite email failed to send',
      );
    }

    await this.audit.record({
      ctx,
      action: 'settings.user.created',
      resourceType: 'user',
      resourceId: created.id,
      changes: [
        { field: 'email', old: null, new: created.email },
        { field: 'role', old: null, new: created.role },
        { field: 'firstName', old: null, new: created.firstName },
        { field: 'lastName', old: null, new: created.lastName },
      ],
    });

    return (await this.list(clinicId)).find((u) => u.id === created.id)!;
  }

  async update(
    clinicId: string,
    userId: string,
    payload: UpdateUserRequest,
    ctx: RequestContext,
  ): Promise<ClinicUserRow> {
    const before = await this.prisma.user.findFirst({
      where: { id: userId, clinicId, deletedAt: null },
    });
    if (!before) throw new NotFoundException('Përdoruesi nuk u gjet.');
    if (payload.email !== before.email) {
      const taken = await this.prisma.user.findUnique({ where: { email: payload.email } });
      if (taken) throw new ConflictException('Ky email është tashmë i regjistruar.');
    }
    // Last-active-admin guard: if we're demoting the last clinic_admin,
    // refuse — the clinic must always have an admin who can manage it.
    if (before.role === 'clinic_admin' && payload.role !== 'clinic_admin') {
      const otherActiveAdmins = await this.prisma.user.count({
        where: {
          clinicId,
          role: 'clinic_admin',
          isActive: true,
          deletedAt: null,
          NOT: { id: userId },
        },
      });
      if (otherActiveAdmins === 0) {
        throw new BadRequestException(
          'Të paktën një administrator i klinikës duhet të mbetet aktiv.',
        );
      }
    }

    const after = await this.prisma.user.update({
      where: { id: userId },
      data: {
        email: payload.email,
        firstName: payload.firstName,
        lastName: payload.lastName,
        role: payload.role,
        title: payload.title ?? null,
        credential: payload.credential ?? null,
      },
    });

    const diffs: AuditFieldDiff[] = [];
    for (const k of ['email', 'firstName', 'lastName', 'role', 'title', 'credential'] as const) {
      if (before[k] !== after[k]) {
        diffs.push({ field: k, old: before[k], new: after[k] });
      }
    }
    if (diffs.length > 0) {
      await this.audit.record({
        ctx,
        action: 'settings.user.updated',
        resourceType: 'user',
        resourceId: userId,
        changes: diffs,
      });
    }

    return (await this.list(clinicId)).find((u) => u.id === userId)!;
  }

  async setActive(
    clinicId: string,
    userId: string,
    isActive: boolean,
    ctx: RequestContext,
  ): Promise<ClinicUserRow> {
    if (ctx.userId === userId && !isActive) {
      throw new ForbiddenException('Nuk mund të çaktivizoni vetveten.');
    }
    const before = await this.prisma.user.findFirst({
      where: { id: userId, clinicId, deletedAt: null },
    });
    if (!before) throw new NotFoundException('Përdoruesi nuk u gjet.');
    if (before.isActive === isActive) {
      return (await this.list(clinicId)).find((u) => u.id === userId)!;
    }
    if (before.role === 'clinic_admin' && !isActive) {
      const otherActiveAdmins = await this.prisma.user.count({
        where: {
          clinicId,
          role: 'clinic_admin',
          isActive: true,
          deletedAt: null,
          NOT: { id: userId },
        },
      });
      if (otherActiveAdmins === 0) {
        throw new BadRequestException(
          'Të paktën një administrator i klinikës duhet të mbetet aktiv.',
        );
      }
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { isActive },
    });
    if (!isActive) {
      // Revoke active sessions so deactivation takes effect immediately.
      await this.prisma.authSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'user_deactivated' },
      });
    }
    await this.audit.record({
      ctx,
      action: isActive ? 'settings.user.activated' : 'settings.user.deactivated',
      resourceType: 'user',
      resourceId: userId,
      changes: [{ field: 'isActive', old: before.isActive, new: isActive }],
    });
    return (await this.list(clinicId)).find((u) => u.id === userId)!;
  }

  async sendPasswordReset(
    clinicId: string,
    userId: string,
    ctx: RequestContext,
  ): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, clinicId, deletedAt: null },
      select: { email: true },
    });
    if (!user) throw new NotFoundException('Përdoruesi nuk u gjet.');
    await this.auth.requestPasswordReset(user.email, ctx);
    await this.audit.record({
      ctx,
      action: 'settings.user.password_reset_requested',
      resourceType: 'user',
      resourceId: userId,
      changes: null,
    });
  }
}

function generateTemporaryPassword(): string {
  return randomBytes(TEMP_PASSWORD_BYTES).toString('base64url');
}

// Exported for templates that compose UI labels.
export { ROLE_LABEL };
