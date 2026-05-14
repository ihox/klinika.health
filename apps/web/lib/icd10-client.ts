import { apiFetch } from './api';

// Wire shape — aligned with apps/api/src/modules/icd10/icd10.dto.ts.

export interface Icd10ResultDto {
  code: string;
  latinDescription: string;
  chapter: string;
  useCount: number;
  frequentlyUsed: boolean;
}

export const icd10Client = {
  search: (q: string, limit?: number) => {
    const params = new URLSearchParams();
    if (q.length > 0) params.set('q', q);
    if (limit != null) params.set('limit', String(limit));
    const qs = params.toString();
    return apiFetch<{ results: Icd10ResultDto[] }>(
      `/api/icd10/search${qs.length > 0 ? `?${qs}` : ''}`,
    );
  },
};
