export class MerchantApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function merchantRequest<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    key?: string;
    signal?: AbortSignal;
  } = {},
): Promise<T> {
  const response = await fetch(`/v1/${path}`, {
    method: options.method ?? 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    signal: options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(20000)])
      : AbortSignal.timeout(20000),
    headers: {
      ...(options.body === undefined
        ? {}
        : { 'Content-Type': 'application/json' }),
      ...(options.key ? { 'Idempotency-Key': options.key } : {}),
    },
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body) }),
  });
  const body = (await response.json().catch(() => null)) as T & {
    message?: string;
  };
  if (!response.ok)
    throw new MerchantApiError(
      response.status,
      body?.message ?? 'Request unavailable. Please try again.',
    );
  return body;
}
