import { apiFetch, apiUrl } from './api';

// ---------------------------------------------------------------------------
// Wire shapes — keep aligned with
//   apps/api/src/modules/vertetim/vertetim.dto.ts
// ---------------------------------------------------------------------------

export interface VertetimDto {
  id: string;
  clinicId: string;
  patientId: string;
  visitId: string;
  issuedAt: string;
  absenceFrom: string;
  absenceTo: string;
  durationDays: number;
  diagnosisSnapshot: string;
}

export interface IssueVertetimInput {
  visitId: string;
  absenceFrom: string;
  absenceTo: string;
}

export const vertetimClient = {
  issue: (input: IssueVertetimInput) =>
    apiFetch<{ vertetim: VertetimDto }>('/api/vertetim', {
      method: 'POST',
      json: input,
    }),

  getOne: (id: string) =>
    apiFetch<{ vertetim: VertetimDto }>(`/api/vertetim/${id}`),
};

// ---------------------------------------------------------------------------
// Print URL helpers — used by the iframe-based print flow.
// ---------------------------------------------------------------------------

export const printUrls = {
  visitReport: (visitId: string): string => apiUrl(`/api/print/visit/${visitId}`),
  vertetim: (vertetimId: string): string => apiUrl(`/api/print/vertetim/${vertetimId}`),
  history: (patientId: string, includeUltrasound: boolean): string =>
    apiUrl(
      `/api/print/history/${patientId}?include_ultrasound=${includeUltrasound ? 'true' : 'false'}`,
    ),
};
