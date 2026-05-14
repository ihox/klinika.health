// Vërtetim DTOs.
//
// A vërtetim is a Kosovo school-absence certificate. It is issued
// against an existing visit and freezes the visit's primary diagnosis
// text at issue time so subsequent visit edits don't change the
// printed document.
//
// Endpoints:
//   POST /api/vertetim          — issue (doctor only)
//   GET  /api/vertetim/:id      — fetch one (doctor only)
//
// Reprints route through `/api/print/vertetim/:id` (print module)
// and reuse the snapshot. No PATCH / DELETE — vërtetime are legal
// records.

import { z } from 'zod';

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data e pavlefshme')
  .refine(
    (s) => {
      const d = new Date(`${s}T00:00:00Z`);
      return !Number.isNaN(d.getTime());
    },
    { message: 'Data e pavlefshme' },
  );

export const IssueVertetimSchema = z
  .object({
    visitId: z.string().uuid('ID e vizitës e pavlefshme'),
    absenceFrom: isoDate,
    absenceTo: isoDate,
  })
  .strict()
  .superRefine((data, ctx) => {
    const f = new Date(`${data.absenceFrom}T00:00:00Z`).getTime();
    const t = new Date(`${data.absenceTo}T00:00:00Z`).getTime();
    if (t < f) {
      ctx.addIssue({
        code: 'custom',
        path: ['absenceTo'],
        message: 'Data "Deri" duhet të jetë e barabartë ose pas datës "Nga".',
      });
    }
  });

export type IssueVertetimInput = z.infer<typeof IssueVertetimSchema>;

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
