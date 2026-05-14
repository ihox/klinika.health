import { NextResponse, type NextRequest } from 'next/server';

import {
  CLINIC_PATH_PREFIXES,
  PLATFORM_PATH_PREFIXES,
  classifyHost,
  pathStartsWithAny,
} from '@/lib/scope';

/**
 * Per-request routing for the platform/clinic boundary (ADR-005 fix).
 *
 *   - `klinika.health` / `localhost` (apex) → platform scope. Only the
 *     `/admin` surface + the shared shell (root, /login, 404 page) is
 *     allowed; clinic paths rewrite to `/not-found`.
 *   - `donetamed.klinika.health` / `donetamed.localhost` → tenant
 *     scope. The clinic surface is allowed; `/admin` rewrites to
 *     `/not-found`.
 *   - Reserved hosts (`admin.*`, `www.*`, `api.*`, …) rewrite every
 *     path to `/not-found` regardless. The API rejects them at the
 *     edge with 400; this catches the case where someone loads the
 *     Next.js bundle directly.
 *
 * The resolved scope is forwarded as `x-klinika-scope` so server
 * components (notably `/login`) can render differently for apex vs
 * subdomain without sniffing the host themselves.
 */
export function middleware(req: NextRequest) {
  const hostHeader = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? '';
  const scope = classifyHost(hostHeader);
  const pathname = req.nextUrl.pathname;

  // Reserved host (admin.*, api.*, …) — never serve a real page.
  if (scope.kind === 'reserved') {
    if (pathname.startsWith('/_next/') || pathname.startsWith('/api/')) {
      return passThrough(req, scope);
    }
    return rewriteToNotFound(req, scope);
  }

  if (scope.kind === 'platform') {
    if (pathStartsWithAny(pathname, CLINIC_PATH_PREFIXES)) {
      return rewriteToNotFound(req, scope);
    }
    return passThrough(req, scope);
  }

  // Tenant scope.
  if (pathStartsWithAny(pathname, PLATFORM_PATH_PREFIXES)) {
    return rewriteToNotFound(req, scope);
  }
  return passThrough(req, scope);
}

function passThrough(req: NextRequest, scope: ReturnType<typeof classifyHost>) {
  const res = NextResponse.next({
    request: {
      headers: scopeHeaders(req, scope),
    },
  });
  res.headers.set('x-klinika-scope', scope.kind);
  if (scope.subdomain) {
    res.headers.set('x-klinika-subdomain', scope.subdomain);
  }
  return res;
}

function rewriteToNotFound(req: NextRequest, scope: ReturnType<typeof classifyHost>) {
  // Rewrite to a private (underscore-prefixed) folder that Next.js
  // does not include in routing. With no matching route, Next.js
  // serves `app/not-found.tsx` with status 404 — the EmptyState 404
  // pattern. No body manipulation required from middleware.
  const url = req.nextUrl.clone();
  url.pathname = '/_klinika-blocked';
  const res = NextResponse.rewrite(url, {
    request: {
      headers: scopeHeaders(req, scope),
    },
  });
  res.headers.set('x-klinika-scope', scope.kind);
  if (scope.subdomain) {
    res.headers.set('x-klinika-subdomain', scope.subdomain);
  }
  return res;
}

function scopeHeaders(req: NextRequest, scope: ReturnType<typeof classifyHost>): Headers {
  const headers = new Headers(req.headers);
  headers.set('x-klinika-scope', scope.kind);
  if (scope.subdomain) {
    headers.set('x-klinika-subdomain', scope.subdomain);
  } else {
    headers.delete('x-klinika-subdomain');
  }
  return headers;
}

export const config = {
  // Run on every page request but skip Next's internals and static
  // assets to keep the middleware off the hot path for /_next/*,
  // /favicon, etc. API calls are rewritten by next.config.mjs to the
  // backend, so they also bypass this middleware.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)'],
};
