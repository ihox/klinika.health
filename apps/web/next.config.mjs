// Klinika handles PHI. Every response from apps/web is marked
// no-index, no-follow, no-archive, no-snippet, no-imageindex,
// no-translate at the HTTP layer. The policy is unconditional —
// dev, staging, on-prem, and production. Defense-in-depth is
// completed by the `robots` metadata on the root layout
// (renders meta tags) and `app/robots.ts` (serves /robots.txt).
const NO_INDEX_HEADER_VALUE =
  'noindex, nofollow, noarchive, nosnippet, noimageindex, notranslate';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Self-contained output for the production Docker image
  // (infra/docker/Dockerfile.web.prod). `next dev` and `next start`
  // ignore this flag, so local dev is unaffected.
  output: 'standalone',
  experimental: {
    typedRoutes: true,
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [{ key: 'X-Robots-Tag', value: NO_INDEX_HEADER_VALUE }],
      },
    ];
  },
  // Dev-only: proxy API + health probes to the NestJS service so the
  // browser always talks to the same host:port as the page. Avoids
  // CORS and cross-host cookie issues when developers visit the app
  // on admin.localhost / donetamed.localhost subdomains.
  //
  // In staging/prod, Caddy fronts everything and routes /api/* and
  // /health/* to the API service directly — those requests must not
  // reach the Next.js process. We gate the rewrites on
  // API_INTERNAL_URL being set so a prod image without that env var
  // is a pure SSR server with no upstream proxying.
  async rewrites() {
    const apiInternal = process.env.API_INTERNAL_URL;
    if (!apiInternal) return [];
    return [
      { source: '/api/:path*', destination: `${apiInternal}/api/:path*` },
      { source: '/health/:path*', destination: `${apiInternal}/health/:path*` },
    ];
  },
};

export default nextConfig;
