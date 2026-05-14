import { SetMetadata } from '@nestjs/common';

import { ALLOW_ANONYMOUS_METADATA_KEY } from '../guards/auth.guard';
import { PLATFORM_SCOPE_METADATA_KEY } from '../guards/clinic-scope.guard';

/** Bypasses AuthGuard. Pair with the public endpoints in the auth controller. */
export const AllowAnonymous = () => SetMetadata(ALLOW_ANONYMOUS_METADATA_KEY, true);

/**
 * Marks a handler as platform-scope: it's only valid when the request
 * comes from the apex domain (klinika.health / localhost), never from
 * a tenant subdomain. The ClinicScopeGuard enforces this — tenant
 * subdomain requests to a `@PlatformScope()` handler return the same
 * generic 401 as a wrong-password login attempt, never a 403 that
 * would reveal the boundary exists.
 */
export const PlatformScope = () => SetMetadata(PLATFORM_SCOPE_METADATA_KEY, true);
