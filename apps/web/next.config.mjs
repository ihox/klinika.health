/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    typedRoutes: true,
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
