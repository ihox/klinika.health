import { apiFetch, apiUrl } from './api';

// ---------------------------------------------------------------------------
// Wire shapes — keep aligned with
//   apps/api/src/modules/dicom/dicom.dto.ts
// ---------------------------------------------------------------------------

export interface DicomInstanceDto {
  id: string;
  index: number;
}

export interface DicomStudyDto {
  id: string;
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

export const dicomClient = {
  recent: () =>
    apiFetch<{ studies: DicomStudyDto[] }>('/api/dicom/recent'),

  studyDetail: (studyId: string) =>
    apiFetch<{ study: DicomStudyDetailDto }>(`/api/dicom/studies/${studyId}`),

  listLinks: (visitId: string) =>
    apiFetch<{ links: DicomLinkDto[] }>(`/api/visits/${visitId}/dicom-links`),

  linkStudy: (visitId: string, dicomStudyId: string) =>
    apiFetch<{ link: DicomLinkDto }>(`/api/visits/${visitId}/dicom-links`, {
      method: 'POST',
      json: { dicomStudyId },
    }),

  unlinkStudy: (visitId: string, linkId: string) =>
    apiFetch<void>(`/api/visits/${visitId}/dicom-links/${linkId}`, {
      method: 'DELETE',
    }),
};

/**
 * URL of the authenticated image proxy. The browser fetches this URL
 * with the session cookie attached; the API streams the rendered PNG
 * back from Orthanc and writes an audit row.
 */
export function dicomPreviewUrl(instanceId: string): string {
  return apiUrl(`/api/dicom/instances/${encodeURIComponent(instanceId)}/preview.png`);
}
