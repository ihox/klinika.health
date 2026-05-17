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
  // ESLint already runs as a dedicated step in .github/workflows/ci.yml.
  // Re-running it inside `next build` makes a pre-existing lint
  // violation (unrelated to the current change) block the staging
  // production-image build — and we want staging deploys to be
  // gated by working CODE, not by linter hygiene. CI is the place
  // to surface lint regressions; the build is the place to ship.
  eslint: {
    ignoreDuringBuilds: true,
  },
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
  // Proxy /api/* and /health/* to the NestJS service so the browser
  // always talks to the same host:port as the page.
  //
  // Default to the compose-network hostname `http://api:3001`. The
  // staging stack (one Next.js process behind NPM at port 8003)
  // relies on this — NPM forwards everything to web:3000 and Next.js
  // rewrites the API/health paths internally to api:3001.
  //
  // On-prem (Caddy split): Caddy intercepts /api/* and /health/*
  // before they reach Next.js, so the baked rewrite is dormant and
  // harmless. Local dev points the env at `http://api:3001` from
  // the dev compose file; the same default value matches.
  //
  // Rewrites in App Router are resolved at BUILD time for standalone
  // output, so an env override only matters during `next build`.
  async rewrites() {
    const apiInternal = process.env.API_INTERNAL_URL ?? 'http://api:3001';
    return [
      { source: '/api/:path*', destination: `${apiInternal}/api/:path*` },
      { source: '/health/:path*', destination: `${apiInternal}/health/:path*` },
    ];
  },
};

export default nextConfig;
