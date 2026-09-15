const apiOrigin = process.env.NEXT_PUBLIC_API_ORIGIN;

if (!apiOrigin) {
  throw new Error('NEXT_PUBLIC_API_ORIGIN is required');
}

const parsed = new URL(apiOrigin);
if (
  !['http:', 'https:'].includes(parsed.protocol) ||
  parsed.origin !== apiOrigin
) {
  throw new Error(
    'NEXT_PUBLIC_API_ORIGIN must be an HTTP(S) origin without a path',
  );
}

export function apiUrl(path: string) {
  return `${apiOrigin}/v1/${path}`;
}

export { apiOrigin };
