import type { NextConfig } from 'next';

// Browser and API share one HTTPS origin. Preserve /v1 so scoped Secure,
// HttpOnly, SameSite=Strict checkout cookies retain their original path.
const apiOrigin = process.env.API_INTERNAL_ORIGIN ?? 'http://127.0.0.1:3001';
const parsed = new URL(apiOrigin);
if (
  !['http:', 'https:'].includes(parsed.protocol) ||
  parsed.origin !== apiOrigin
) {
  throw new Error(
    'API_INTERNAL_ORIGIN must be an HTTP(S) origin without a path',
  );
}
const config: NextConfig = {
  async rewrites() {
    return [{ source: '/v1/:path*', destination: `${apiOrigin}/v1/:path*` }];
  },
  async headers() {
    return [
      {
        source: '/checkout/:path*',
        headers: [
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Cache-Control', value: 'no-store' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
        ],
      },
    ];
  },
};
export default config;
