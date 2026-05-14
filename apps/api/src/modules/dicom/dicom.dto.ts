// DICOM bridge DTOs.
//
// Wire shapes for the picker, lightbox, and link endpoints. The
// browser never sees Orthanc identifiers in their raw form — it
// receives Klinika UUIDs (`DicomStudyDto.id`) plus opaque instance
// ids that round-trip through the authenticated image proxy. The
// Orthanc study id is exposed only as part of the picker subtitle
// so the doctor can disambiguate similarly-timed studies.
//
// Endpoints:
//   GET    /api/dicom/recent                     — last 10 received
//   GET    /api/dicom/studies/:id                — study + instances
//   POST   /api/visits/:visitId/dicom-links      — link a study
//   DELETE /api/visits/:visitId/dicom-links/:id  — unlink
//
// Webhook (internal — not on the public surface, secret-guarded):
//   POST   /api/dicom/internal/orthanc-event     — Orthanc → Klinika

import { z } from 'zod';

/**
 * Body Orthanc's Lua on-stored hook POSTs. Keys mirror the Lua dump.
 * The clinic id is derived from the request's clinic context (every
 * clinic runs its own Orthanc), so there is no clinic id in the body.
 */
export const OrthancEventSchema = z
  .object({
    studyId: z.string().min(1, 'studyId is required'),
    instanceId: z.string().min(1, 'instanceId is required').optional(),
    timestamp: z.string().optional(),
  })
  .passthrough();

export type OrthancEventInput = z.infer<typeof OrthancEventSchema>;

/**
 * `dicom_link` body — only `dicomStudyId` is required; the visit id
 * comes from the URL.
 */
export const CreateDicomLinkSchema = z
  .object({
    dicomStudyId: z.string().uuid('ID e studimit e pavlefshme'),
  })
  .strict();

export type CreateDicomLinkInput = z.infer<typeof CreateDicomLinkSchema>;

// ---------------------------------------------------------------------------
// Response shapes (mirrored 1:1 by apps/web/lib/dicom-client.ts)
// ---------------------------------------------------------------------------

export interface DicomInstanceDto {
  /** Klinika-side opaque id (= Orthanc instance id). The browser fetches
   * /api/dicom/instances/:id/preview.png with this value. */
  id: string;
  /** Sequence position within the study (1-based). */
  index: number;
}

export interface DicomStudyDto {
  /** Klinika UUID (dicom_studies.id). */
  id: string;
  /** Display-only — truncated Orthanc id appears on the picker card. */
  orthancStudyId: string;
  receivedAt: string;
  imageCount: number;
  studyDescription: string | null;
}

export interface DicomStudyDetailDto extends DicomStudyDto {
  instances: DicomInstanceDto[];
}

export interface DicomLinkDto {
  id: string;
  visitId: string;
  dicomStudyId: string;
  linkedAt: string;
  study: DicomStudyDto;
}
