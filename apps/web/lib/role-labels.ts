/**
 * Canonical Albanian labels for the three clinic roles plus the
 * platform-admin role. Single source of truth — the chip component,
 * the user-menu dropdown, the Përdoruesit table, the audit log
 * renderer, and the profile page all import from here. CLAUDE.md §5.8
 * and ADR-004 (Multi-role update) both fix these strings.
 *
 * The labels differ slightly from the email-template phrasing
 * (`apps/api/src/modules/email/templates/user-invite.ts`) where the
 * sentence "ju ka shtuar si …" demands a lowercase indefinite form
 * ("mjek", "recepsioniste", "administrator i klinikës"). The labels
 * here are the user-facing chip / table / dropdown text — capitalised
 * and standalone.
 */

export type ClinicRole = 'doctor' | 'receptionist' | 'clinic_admin';
export type AnyRole = ClinicRole | 'platform_admin';

export const ROLE_LABELS: Record<AnyRole, string> = {
  doctor: 'Mjeku',
  receptionist: 'Recepsioniste',
  clinic_admin: 'Administrator i klinikës',
  platform_admin: 'Administrator i platformës',
};

/**
 * Canonical display order for chip lists, table cells, and the
 * audit-log diff. Doctor first because doctor wins on every overlap
 * (e.g. the receptionist privacy boundary defers to doctor); admin
 * last because it's the meta-role.
 */
export const ROLE_DISPLAY_ORDER: ClinicRole[] = ['doctor', 'receptionist', 'clinic_admin'];

export function roleLabel(role: AnyRole): string {
  return ROLE_LABELS[role];
}

/** Render an array of roles in the canonical chip order, dropping
 *  unknown values defensively. */
export function orderRoles(roles: readonly AnyRole[]): AnyRole[] {
  const set = new Set(roles);
  const ordered: AnyRole[] = ROLE_DISPLAY_ORDER.filter((r) => set.has(r));
  if (set.has('platform_admin')) ordered.push('platform_admin');
  return ordered;
}
