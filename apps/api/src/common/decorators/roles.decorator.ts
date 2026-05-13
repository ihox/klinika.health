import { SetMetadata } from '@nestjs/common';

export const ROLES_METADATA_KEY = 'klinika:roles';

export type AppRole = 'doctor' | 'receptionist' | 'clinic_admin' | 'platform_admin';

/**
 * Restrict a handler to one or more roles. Read by RolesGuard.
 *
 *   @Roles('doctor')                   // doctors only
 *   @Roles('doctor', 'clinic_admin')   // either
 *
 * Without @Roles, the AuthGuard still requires a valid session but
 * doesn't constrain by role — useful for endpoints any clinic user can
 * hit (e.g. profile, logout).
 */
export const Roles = (...roles: AppRole[]) => SetMetadata(ROLES_METADATA_KEY, roles);
