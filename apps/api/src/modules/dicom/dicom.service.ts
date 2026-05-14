import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectPinoLogger, type PinoLogger } from 'nestjs-pino';

import { AuditLogService } from '../../common/audit/audit-log.service';
import type { RequestContext } from '../../common/request-context/request-context';
import { hasClinicalAccess } from '../../common/request-context/role-helpers';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  DicomLinkDto,
  DicomStudyDetailDto,
  DicomStudyDto,
} from './dicom.dto';
import { OrthancClient, type OrthancStudyMeta } from './orthanc.client';

const RECENT_LIMIT = 10;

/**
 * DICOM bridge orchestrator.
 *
 * Read paths: every endpoint scopes by `clinicId` (the request context
 * comes from the subdomain; RLS is the second layer). Image bytes are
 * fetched from Orthanc by the controller via {@link OrthancClient} —
 * this service handles only the Klinika-side metadata + audit + links.
 *
 * Doctor / clinic-admin only. Receptionists 403 at the controller
 * guard layer; the service rechecks defensively.
 */
@Injectable()
export class DicomService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orthanc: OrthancClient,
    private readonly audit: AuditLogService,
    @InjectPinoLogger(DicomService.name)
    private readonly logger: PinoLogger,
  ) {}

  // --------------------------------------------------------------------------
  // Picker — last 10 studies received
  // --------------------------------------------------------------------------

  async listRecent(
    clinicId: string,
    ctx: RequestContext,
  ): Promise<DicomStudyDto[]> {
    this.requireDoctorOrAdmin(ctx);

    const studies = await this.prisma.dicomStudy.findMany({
      where: { clinicId },
      orderBy: { receivedAt: 'desc' },
      take: RECENT_LIMIT,
    });

    await this.audit.record({
      ctx,
      action: 'dicom.study.viewed',
      resourceType: 'dicom_picker',
      // The picker isn't a single resource — record the user's
      // clinic as the resource id so platform audits can scope by
      // tenant easily.
      resourceId: clinicId,
      changes: null,
    });

    return studies.map(toStudyDto);
  }

  // --------------------------------------------------------------------------
  // Study detail — used by the lightbox to enumerate instances
  // --------------------------------------------------------------------------

  async getStudyDetail(
    clinicId: string,
    studyId: string,
    ctx: RequestContext,
  ): Promise<DicomStudyDetailDto> {
    this.requireDoctorOrAdmin(ctx);

    const study = await this.prisma.dicomStudy.findFirst({
      where: { id: studyId, clinicId },
    });
    if (!study) throw new NotFoundException('Studimi nuk u gjet.');

    // Pull instance ids from Orthanc. The DB only stores the parent
    // study id; the instance list is volatile (extras could land
    // after the webhook), so we always go to Orthanc for the
    // authoritative list at view time.
    const instances = await this.orthanc.listInstances(study.orthancStudyId);

    return {
      ...toStudyDto(study),
      // Bump the persisted image_count if Orthanc has more instances
      // now than at first ingest (rare; small studies might trickle
      // in over a few seconds).
      imageCount: Math.max(study.imageCount, instances.length),
      instances: instances.map((id, idx) => ({ id, index: idx + 1 })),
    };
  }

  // --------------------------------------------------------------------------
  // Link / unlink against a visit
  // --------------------------------------------------------------------------

  async linkStudyToVisit(
    clinicId: string,
    visitId: string,
    dicomStudyId: string,
    ctx: RequestContext,
  ): Promise<DicomLinkDto> {
    this.requireDoctorOrAdmin(ctx);
    if (!ctx.userId) {
      throw new ForbiddenException('Sesioni i pavlefshëm.');
    }

    const [visit, study] = await Promise.all([
      this.prisma.visit.findFirst({
        where: { id: visitId, clinicId, deletedAt: null },
        select: { id: true },
      }),
      this.prisma.dicomStudy.findFirst({
        where: { id: dicomStudyId, clinicId },
      }),
    ]);
    if (!visit) throw new NotFoundException('Vizita nuk u gjet.');
    if (!study) throw new NotFoundException('Studimi nuk u gjet.');

    const link = await this.prisma.visitDicomLink.upsert({
      where: {
        visit_dicom_unique: { visitId, dicomStudyId },
      },
      create: {
        visitId,
        dicomStudyId,
        linkedBy: ctx.userId,
      },
      update: {
        // Re-link is idempotent: bump linkedAt so the doctor sees the
        // study at the top of the visit's list again.
        linkedAt: new Date(),
        linkedBy: ctx.userId,
      },
    });

    await this.audit.record({
      ctx,
      action: 'dicom.study.linked',
      resourceType: 'visit_dicom_link',
      resourceId: link.id,
      changes: [
        { field: 'visitId', old: null, new: visitId },
        { field: 'dicomStudyId', old: null, new: dicomStudyId },
      ],
    });

    return {
      id: link.id,
      visitId: link.visitId,
      dicomStudyId: link.dicomStudyId,
      linkedAt: link.linkedAt.toISOString(),
      study: toStudyDto(study),
    };
  }

  async unlinkStudyFromVisit(
    clinicId: string,
    visitId: string,
    linkId: string,
    ctx: RequestContext,
  ): Promise<void> {
    this.requireDoctorOrAdmin(ctx);

    const link = await this.prisma.visitDicomLink.findFirst({
      where: {
        id: linkId,
        visitId,
        visit: { clinicId },
      },
      include: { dicomStudy: { select: { clinicId: true } } },
    });
    if (!link) throw new NotFoundException('Lidhja nuk u gjet.');
    if (link.dicomStudy.clinicId !== clinicId) {
      throw new ForbiddenException('Lidhja i përket një klinike tjetër.');
    }

    await this.prisma.visitDicomLink.delete({ where: { id: link.id } });

    await this.audit.record({
      ctx,
      action: 'dicom.study.unlinked',
      resourceType: 'visit_dicom_link',
      resourceId: link.id,
      changes: [
        { field: 'visitId', old: link.visitId, new: null },
        { field: 'dicomStudyId', old: link.dicomStudyId, new: null },
      ],
    });
  }

  async listLinksForVisit(
    clinicId: string,
    visitId: string,
    ctx: RequestContext,
  ): Promise<DicomLinkDto[]> {
    this.requireDoctorOrAdmin(ctx);

    const visit = await this.prisma.visit.findFirst({
      where: { id: visitId, clinicId, deletedAt: null },
      select: { id: true },
    });
    if (!visit) throw new NotFoundException('Vizita nuk u gjet.');

    const links = await this.prisma.visitDicomLink.findMany({
      where: { visitId },
      include: { dicomStudy: true },
      orderBy: { linkedAt: 'desc' },
    });
    return links.map((l) => ({
      id: l.id,
      visitId: l.visitId,
      dicomStudyId: l.dicomStudyId,
      linkedAt: l.linkedAt.toISOString(),
      study: toStudyDto(l.dicomStudy),
    }));
  }

  // --------------------------------------------------------------------------
  // Lightbox image access — every fetch writes an audit row.
  // --------------------------------------------------------------------------

  /**
   * Authorize the browser to view an Orthanc instance via the proxy.
   * The instance id is opaque from the user's perspective; we trust
   * Orthanc's id but require the caller's clinic to have a study
   * containing the instance. Returns the (clinic-owned) parent
   * study so the proxy can audit by study id.
   */
  async authorizeInstanceFetch(
    clinicId: string,
    instanceId: string,
    ctx: RequestContext,
    auditAction: 'dicom.instance.viewed' | 'dicom.instance.exported',
  ): Promise<{ orthancStudyId: string; studyId: string }> {
    this.requireDoctorOrAdmin(ctx);

    // We can't infer the parent study purely from the DB (we don't
    // store instances). Fetch the instance metadata from Orthanc and
    // check that its parent study exists in this clinic's index.
    const study = await this.findStudyContainingInstance(clinicId, instanceId);
    if (!study) {
      throw new NotFoundException('Imazhi nuk u gjet.');
    }

    await this.audit.record({
      ctx,
      action: auditAction,
      resourceType: 'dicom_instance',
      // Use the Klinika-side study id so audit queries can group by
      // study without a join through dicom_studies.
      resourceId: study.id,
      changes: null,
    });

    return { orthancStudyId: study.orthancStudyId, studyId: study.id };
  }

  // --------------------------------------------------------------------------
  // Webhook — receives Orthanc's on-stored event
  // --------------------------------------------------------------------------

  /**
   * Idempotent upsert called by the bridge webhook on every received
   * instance. The first event for a study creates the dicom_studies
   * row; subsequent events for the same study bump the image count
   * (Orthanc tells us how many instances the study has by the time
   * we call back).
   */
  async ingestStudyEvent(clinicId: string, orthancStudyId: string): Promise<void> {
    const meta = await this.orthanc.getStudy(orthancStudyId);
    if (!meta) {
      this.logger.warn(
        { clinicId, orthancStudyId },
        'Webhook fired for unknown Orthanc study',
      );
      return;
    }

    const receivedAt = parseOrthancTimestamp(meta) ?? new Date();
    const imageCount = Math.max(1, meta.Instances?.length ?? 0);
    const studyDescription = meta.MainDicomTags?.StudyDescription ?? null;
    const patientNameDicom =
      meta.PatientMainDicomTags?.PatientName ??
      meta.MainDicomTags?.PatientName ??
      null;

    await this.prisma.dicomStudy.upsert({
      where: {
        dicom_clinic_orthanc_unique: { clinicId, orthancStudyId },
      },
      create: {
        clinicId,
        orthancStudyId,
        receivedAt,
        imageCount,
        studyDescription,
        patientNameDicom,
      },
      update: {
        imageCount,
        studyDescription,
        patientNameDicom,
      },
    });

    // No audit row on ingest — the modality, not a user, is the
    // actor. Telemetry captures Orthanc activity from the disk-usage
    // probe.
    this.logger.info(
      { orthancStudyId, imageCount },
      'DICOM study indexed',
    );
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  private requireDoctorOrAdmin(ctx: RequestContext): void {
    if (hasClinicalAccess(ctx.roles)) return;
    throw new ForbiddenException('Vetëm mjeku ka qasje në studimet DICOM.');
  }

  private async findStudyContainingInstance(
    clinicId: string,
    instanceId: string,
  ): Promise<{
    id: string;
    orthancStudyId: string;
  } | null> {
    // Ask Orthanc which study owns the instance, then verify the
    // study is indexed under this clinic. The DB lookup uses the
    // (clinic_id, orthanc_study_id) unique index — RLS is the
    // second layer.
    const meta = await this.orthanc.getInstance(instanceId);
    const parentStudyId = meta?.ParentStudy;
    if (!parentStudyId) return null;
    return this.prisma.dicomStudy.findFirst({
      where: { clinicId, orthancStudyId: parentStudyId },
      select: { id: true, orthancStudyId: true },
    });
  }
}

// ===========================================================================
// Pure helpers (exported for unit tests)
// ===========================================================================

interface DicomStudyRow {
  id: string;
  orthancStudyId: string;
  receivedAt: Date;
  imageCount: number;
  studyDescription: string | null;
}

export function toStudyDto(row: DicomStudyRow): DicomStudyDto {
  return {
    id: row.id,
    orthancStudyId: row.orthancStudyId,
    receivedAt: row.receivedAt.toISOString(),
    imageCount: row.imageCount,
    studyDescription: row.studyDescription,
  };
}

/**
 * Best-effort parse of Orthanc's `StudyDate` (YYYYMMDD) + `StudyTime`
 * (HHMMSS[.fff]) tags into a Date. Falls back to `null` when either
 * tag is missing or malformed, so callers can default to `now()`.
 */
export function parseOrthancTimestamp(meta: OrthancStudyMeta): Date | null {
  const date = meta.MainDicomTags?.StudyDate;
  const time = meta.MainDicomTags?.StudyTime;
  if (!date || date.length < 8) return null;
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(4, 6));
  const d = Number(date.slice(6, 8));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    return null;
  }
  let hh = 0,
    mm = 0,
    ss = 0;
  if (time && time.length >= 6) {
    hh = Number(time.slice(0, 2));
    mm = Number(time.slice(2, 4));
    ss = Number(time.slice(4, 6));
    if (!Number.isFinite(hh) || !Number.isFinite(mm) || !Number.isFinite(ss)) {
      hh = 0;
      mm = 0;
      ss = 0;
    }
  }
  const ts = Date.UTC(y, m - 1, d, hh, mm, ss);
  if (!Number.isFinite(ts)) return null;
  return new Date(ts);
}
