import type { NextConfig } from 'next';

const apiUrl = process.env.API_URL ?? 'http://localhost:4000';

const config: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@dah-pango/contracts', '@dah-pango/db', '@dah-pango/domain'],
  // The browser always calls the API at /api on the same origin, so the session cookie
  // is first-party. In production Caddy answers /api before it reaches Next.js.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiUrl}/:path*` }];
  },
};

export default config;
