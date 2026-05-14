import type { AppRole } from '../decorators/roles.decorator';

/**
 * Receptionist privacy boundary (CLAUDE.md §1.2, ADR-004 Multi-role
 * update). A user gets the redacted patient view ONLY when they
 * carry the `receptionist` role AND lack both `doctor` and
 * `clinic_admin`. Anyone with doctor or clinic_admin sees the full
 * record — the wider role wins.
 *
 * Returns false for null / empty / platform_admin (platform admins
 * never touch the clinic patient surface anyway).
 */
export function isReceptionistOnly(roles: AppRole[] | null | undefined): boolean {
  if (!roles || roles.length === 0) return false;
  if (roles.includes('doctor') || roles.includes('clinic_admin')) return false;
  return roles.includes('receptionist');
}

/**
 * True iff the user has clinical-data access — doctor OR clinic_admin.
 * Replaces the `ctx.role === 'doctor' || ctx.role === 'clinic_admin'`
 * pair that appeared at every service-layer privacy gate before the
 * multi-role refactor.
 */
export function hasClinicalAccess(roles: AppRole[] | null | undefined): boolean {
  if (!roles) return false;
  return roles.includes('doctor') || roles.includes('clinic_admin');
}

/**
 * Collapse a multi-role array down to the single role that wire
 * formats / display names should use — the audit-log "userRole"
 * column, the doctor-vs-other display-name choice in visit history,
 * and similar single-label contexts.
 *
 * Priority: doctor > clinic_admin > receptionist. (doctor wins
 * because formatting prepends "Dr." and that's the most informative
 * label; clinic_admin beats receptionist because admin actions are
 * usually what the operator is auditing.) Returns 'doctor' as the
 * sentinel fallback when the array is empty — callers that pass
 * empty arrays are bugs and the fallback keeps the wire shape
 * valid until the real fix lands.
 */
export function primaryRoleForDisplay(
  roles: AppRole[] | null | undefined,
): 'doctor' | 'receptionist' | 'clinic_admin' {
  if (roles?.includes('doctor')) return 'doctor';
  if (roles?.includes('clinic_admin')) return 'clinic_admin';
  if (roles?.includes('receptionist')) return 'receptionist';
  return 'doctor';
}
