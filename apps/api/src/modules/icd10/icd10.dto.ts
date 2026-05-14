// ICD-10 search DTOs.
//
// Powers the diagnosis multi-select in the visit form (slice 13).
// Results are Latin-only — Albanian translations of clinical terms are
// explicitly not introduced (CLAUDE.md §1.5).

import { z } from 'zod';

/**
 * Search query schema.
 *
 *   q       — free-text query. Matches against code (prefix-friendly,
 *             so typing "J" returns J-chapter codes) or description
 *             (case-insensitive substring).
 *   limit   — server-capped at 50. Default 20 mirrors the dropdown's
 *             rendered cap before virtualisation kicks in.
 *
 * `doctorId` is intentionally NOT a query parameter — the server
 * derives it from the authenticated session so a client cannot trigger
 * another doctor's frequently-used list (cross-doctor data leakage).
 */
export const Icd10SearchQuerySchema = z
  .object({
    q: z
      .preprocess(
        (v) => (typeof v === 'string' ? v.trim() : v),
        z.string().max(64).optional(),
      )
      .transform((v) => v ?? ''),
    limit: z
      .preprocess(
        (v) => (typeof v === 'string' ? Number(v) : v),
        z.number().int().min(1).max(50).optional(),
      )
      .transform((v) => v ?? 20),
  })
  .strict();

export type Icd10SearchQuery = z.infer<typeof Icd10SearchQuerySchema>;

export interface Icd10ResultDto {
  code: string;
  latinDescription: string;
  chapter: string;
  /**
   * Number of times this doctor has used the code (0 if never). The UI
   * surfaces a small "12×" badge for frequently-used results — purely
   * informational; the ranking is server-side.
   */
  useCount: number;
  /** True for the doctor's top-N personal recent codes (the boost group). */
  frequentlyUsed: boolean;
}
