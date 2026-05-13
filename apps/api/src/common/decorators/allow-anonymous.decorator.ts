import { SetMetadata } from '@nestjs/common';

import { ALLOW_ANONYMOUS_METADATA_KEY } from '../guards/auth.guard';
import { ADMIN_SCOPE_METADATA_KEY } from '../guards/clinic-scope.guard';

/** Bypasses AuthGuard. Pair with the public endpoints in the auth controller. */
export const AllowAnonymous = () => SetMetadata(ALLOW_ANONYMOUS_METADATA_KEY, true);

/**
 * Marks a handler as platform-admin-scope: ClinicScopeGuard accepts
 * requests on `admin.klinika.health` and rejects requests on tenant
 * subdomains.
 */
export const AdminScope = () => SetMetadata(ADMIN_SCOPE_METADATA_KEY, true);
