import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { InjectPinoLogger, type PinoLogger } from 'nestjs-pino';

import { AuditLogService, type AuditFieldDiff } from '../../common/audit/audit-log.service';
import type { RequestContext } from '../../common/request-context/request-context';
import { PrismaService } from '../../prisma/prisma.service';
import {
  type ClinicGeneralUpdate,
  type ClinicSettingsResponse,
  defaultHoursConfig,
  defaultPaymentCodes,
  type HoursConfig,
  HoursConfigSchema,
  type PaymentCodes,
  PaymentCodesSchema,
  type SmtpUpdateRequest,
} from './clinic-settings.dto';
import { ClinicStorageService } from './clinic-storage.service';
import { encryptString, type EncryptedString } from './storage-cipher';

interface StoredSmtpConfig {
  host: string;
  port: number;
  username: string;
  password: EncryptedString;
  fromName: string;
  fromAddress: string;
}

/**
 * Reads and updates per-clinic settings. Every mutation writes one
 * audit-log row (action = `settings.<section>.updated`) with the
 * field-level diff. Sensitive fields (SMTP password) appear in the
 * diff as `[REDACTED]`, never the plaintext value.
 *
 * The clinic row is always fetched via `clinicId` from the request
 * context — never trusted from the request body. RLS provides the
 * defense in depth.
 */
@Injectable()
export class ClinicSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly storage: ClinicStorageService,
    @InjectPinoLogger(ClinicSettingsService.name)
    private readonly logger: PinoLogger,
  ) {}

  // ---- Read ------------------------------------------------------------

  async getSettings(clinicId: string): Promise<ClinicSettingsResponse> {
    const clinic = await this.prisma.clinic.findUnique({
      where: { id: clinicId },
    });
    if (!clinic) {
      throw new NotFoundException('Klinika nuk u gjet.');
    }

    const hours = parseHoursOrDefault(clinic.hoursConfig);
    const paymentCodes = parsePaymentCodesOrDefault(clinic.paymentCodes);
    const stored = parseStoredSmtp(clinic.smtpConfig);
    const logo = await this.storage.readLogo(clinicId);
    const signature = await this.storage.readClinicSignature(clinicId);

    return {
      general: {
        name: clinic.name,
        shortName: clinic.shortName,
        subdomain: clinic.subdomain,
        address: clinic.address,
        city: clinic.city,
        phones: clinic.phones,
        email: clinic.email,
        walkinDurationMinutes: clinic.walkinDurationMinutes,
      },
      branding: {
        hasLogo: Boolean(logo),
        logoContentType: logo?.contentType ?? null,
        hasSignature: Boolean(signature),
      },
      hours,
      paymentCodes,
      email: {
        mode: stored ? 'smtp' : 'default',
        smtp: stored
          ? {
              host: stored.host,
              port: stored.port,
              username: stored.username,
              fromName: stored.fromName,
              fromAddress: stored.fromAddress,
              passwordSet: true,
            }
          : null,
      },
    };
  }

  // ---- General ---------------------------------------------------------

  async updateGeneral(
    clinicId: string,
    payload: ClinicGeneralUpdate,
    ctx: RequestContext,
  ): Promise<ClinicSettingsResponse> {
    const before = await this.prisma.clinic.findUniqueOrThrow({ where: { id: clinicId } });
    const after = await this.prisma.clinic.update({
      where: { id: clinicId },
      data: {
        name: payload.name,
        shortName: payload.shortName,
        address: payload.address,
        city: payload.city,
        phones: payload.phones,
        email: payload.email,
        walkinDurationMinutes: payload.walkinDurationMinutes,
      },
    });

    const diffs = diffScalar(before, after, [
      'name',
      'shortName',
      'address',
      'city',
      'email',
      'walkinDurationMinutes',
    ]);
    if (!arraysEqualStr(before.phones, after.phones)) {
      diffs.push({ field: 'phones', old: before.phones, new: after.phones });
    }
    await this.recordIfChanged(ctx, clinicId, 'settings.general.updated', diffs);

    return this.getSettings(clinicId);
  }

  // ---- Hours -----------------------------------------------------------

  async updateHours(
    clinicId: string,
    payload: HoursConfig,
    ctx: RequestContext,
  ): Promise<ClinicSettingsResponse> {
    const parsed = HoursConfigSchema.safeParse(payload);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Orari i pavlefshëm.',
        issues: parsed.error.flatten(),
      });
    }
    const before = await this.prisma.clinic.findUniqueOrThrow({ where: { id: clinicId } });
    await this.prisma.clinic.update({
      where: { id: clinicId },
      data: { hoursConfig: parsed.data as Prisma.InputJsonValue },
    });
    const prev = parseHoursOrDefault(before.hoursConfig);
    if (!shallowEqualJson(prev, parsed.data)) {
      await this.audit.record({
        ctx,
        action: 'settings.hours.updated',
        resourceType: 'clinic',
        resourceId: clinicId,
        changes: [{ field: 'hoursConfig', old: prev, new: parsed.data }],
      });
    }
    return this.getSettings(clinicId);
  }

  // ---- Payment codes ---------------------------------------------------

  async updatePaymentCodes(
    clinicId: string,
    payload: PaymentCodes,
    ctx: RequestContext,
  ): Promise<ClinicSettingsResponse> {
    const parsed = PaymentCodesSchema.safeParse(payload);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Kodet e pagesave janë të pavlefshme.',
        issues: parsed.error.flatten(),
      });
    }
    const before = await this.prisma.clinic.findUniqueOrThrow({ where: { id: clinicId } });
    await this.prisma.clinic.update({
      where: { id: clinicId },
      data: { paymentCodes: parsed.data as Prisma.InputJsonValue },
    });
    const prev = parsePaymentCodesOrDefault(before.paymentCodes);
    if (!shallowEqualJson(prev, parsed.data)) {
      await this.audit.record({
        ctx,
        action: 'settings.payment_codes.updated',
        resourceType: 'clinic',
        resourceId: clinicId,
        changes: [{ field: 'paymentCodes', old: prev, new: parsed.data }],
      });
    }
    return this.getSettings(clinicId);
  }

  // ---- Email / SMTP ----------------------------------------------------

  async updateEmailMode(
    clinicId: string,
    payload: SmtpUpdateRequest,
    ctx: RequestContext,
  ): Promise<ClinicSettingsResponse> {
    const before = await this.prisma.clinic.findUniqueOrThrow({ where: { id: clinicId } });
    const previousStored = parseStoredSmtp(before.smtpConfig);

    if (payload.mode === 'default') {
      await this.prisma.clinic.update({
        where: { id: clinicId },
        data: { smtpConfig: { set: null } },
      });
      if (previousStored) {
        await this.audit.record({
          ctx,
          action: 'settings.email.updated',
          resourceType: 'clinic',
          resourceId: clinicId,
          changes: [
            {
              field: 'mode',
              old: 'smtp',
              new: 'default',
            },
          ],
        });
      }
      return this.getSettings(clinicId);
    }

    // SMTP mode: re-use previous password if the request omits one
    // (UI sends `undefined` when the user didn't touch the masked field).
    const password = payload.password;
    if (!password && previousStored) {
      // Keep the existing ciphertext as-is.
      const merged: StoredSmtpConfig = {
        host: payload.host,
        port: payload.port,
        username: payload.username,
        password: previousStored.password,
        fromName: payload.fromName,
        fromAddress: payload.fromAddress,
      };
      await this.prisma.clinic.update({
        where: { id: clinicId },
        data: { smtpConfig: merged as unknown as Prisma.InputJsonValue },
      });
      await this.recordSmtpChange(ctx, clinicId, previousStored, merged);
      return this.getSettings(clinicId);
    }
    if (!password) {
      throw new BadRequestException('Fjalëkalimi SMTP mungon.');
    }

    const encrypted = encryptString(password);
    const merged: StoredSmtpConfig = {
      host: payload.host,
      port: payload.port,
      username: payload.username,
      password: encrypted,
      fromName: payload.fromName,
      fromAddress: payload.fromAddress,
    };
    await this.prisma.clinic.update({
      where: { id: clinicId },
      data: { smtpConfig: merged as unknown as Prisma.InputJsonValue },
    });
    await this.recordSmtpChange(ctx, clinicId, previousStored, merged);
    return this.getSettings(clinicId);
  }

  async getDecryptedSmtpPassword(clinicId: string): Promise<string | null> {
    const clinic = await this.prisma.clinic.findUnique({ where: { id: clinicId } });
    const stored = parseStoredSmtp(clinic?.smtpConfig ?? null);
    if (!stored) return null;
    // Lazy require to avoid pulling cipher into the read path when no SMTP.
    const { decryptString } = await import('./storage-cipher');
    return decryptString(stored.password);
  }

  // ---- Helpers ---------------------------------------------------------

  private async recordIfChanged(
    ctx: RequestContext,
    clinicId: string,
    action: string,
    diffs: AuditFieldDiff[],
  ): Promise<void> {
    if (diffs.length === 0) return;
    await this.audit.record({
      ctx,
      action,
      resourceType: 'clinic',
      resourceId: clinicId,
      changes: diffs,
    });
  }

  private async recordSmtpChange(
    ctx: RequestContext,
    clinicId: string,
    before: StoredSmtpConfig | null,
    after: StoredSmtpConfig,
  ): Promise<void> {
    const diffs: AuditFieldDiff[] = [];
    if (!before) {
      diffs.push({ field: 'mode', old: 'default', new: 'smtp' });
      diffs.push({ field: 'host', old: null, new: after.host });
      diffs.push({ field: 'port', old: null, new: after.port });
      diffs.push({ field: 'username', old: null, new: after.username });
      diffs.push({ field: 'fromAddress', old: null, new: after.fromAddress });
      diffs.push({ field: 'fromName', old: null, new: after.fromName });
      diffs.push({ field: 'password', old: null, new: '[REDACTED]' });
    } else {
      for (const k of ['host', 'port', 'username', 'fromAddress', 'fromName'] as const) {
        if (before[k] !== after[k]) diffs.push({ field: k, old: before[k], new: after[k] });
      }
      if (before.password.cipher !== after.password.cipher) {
        diffs.push({ field: 'password', old: '[REDACTED]', new: '[REDACTED]' });
      }
    }
    if (diffs.length === 0) return;
    await this.audit.record({
      ctx,
      action: 'settings.email.updated',
      resourceType: 'clinic',
      resourceId: clinicId,
      changes: diffs,
    });
    this.logger.info({ clinicId, host: after.host }, 'Clinic SMTP config updated');
  }
}

// ---------------------------------------------------------------------------
// JSON helpers
// ---------------------------------------------------------------------------

export function parseHoursOrDefault(raw: Prisma.JsonValue | null | undefined): HoursConfig {
  if (!raw) return defaultHoursConfig();
  const parsed = HoursConfigSchema.safeParse(raw);
  return parsed.success ? parsed.data : defaultHoursConfig();
}

export function parsePaymentCodesOrDefault(raw: Prisma.JsonValue | null | undefined): PaymentCodes {
  if (!raw) return defaultPaymentCodes();
  const parsed = PaymentCodesSchema.safeParse(raw);
  return parsed.success ? parsed.data : defaultPaymentCodes();
}

export function parseStoredSmtp(raw: Prisma.JsonValue | null | undefined): StoredSmtpConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const password = r['password'];
  if (
    typeof r['host'] !== 'string' ||
    typeof r['port'] !== 'number' ||
    typeof r['username'] !== 'string' ||
    typeof r['fromName'] !== 'string' ||
    typeof r['fromAddress'] !== 'string' ||
    !password ||
    typeof password !== 'object'
  ) {
    return null;
  }
  const enc = password as Record<string, unknown>;
  if (
    typeof enc['cipher'] !== 'string' ||
    typeof enc['iv'] !== 'string' ||
    typeof enc['tag'] !== 'string'
  ) {
    return null;
  }
  return {
    host: r['host'] as string,
    port: r['port'] as number,
    username: r['username'] as string,
    fromName: r['fromName'] as string,
    fromAddress: r['fromAddress'] as string,
    password: {
      cipher: enc['cipher'] as string,
      iv: enc['iv'] as string,
      tag: enc['tag'] as string,
    },
  };
}

function diffScalar<T extends Record<string, unknown>>(
  before: T,
  after: T,
  keys: ReadonlyArray<keyof T>,
): AuditFieldDiff[] {
  const out: AuditFieldDiff[] = [];
  for (const k of keys) {
    if (before[k] !== after[k]) {
      out.push({ field: String(k), old: before[k], new: after[k] });
    }
  }
  return out;
}

function arraysEqualStr(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

function shallowEqualJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
