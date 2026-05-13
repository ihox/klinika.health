// Centralized API base URL. Set NEXT_PUBLIC_API_URL at build time; in
// production the API and web run on the same domain so the env var is
// usually unset and we fall back to relative URLs.
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

export function apiUrl(path: string): string {
  if (!API_BASE_URL) {
    return path;
  }
  const base = API_BASE_URL.replace(/\/$/, '');
  return path.startsWith('/') ? `${base}${path}` : `${base}/${path}`;
}

export interface ApiErrorBody {
  message?: string;
  reason?: string;
  retryAfterSeconds?: number;
  issues?: { fieldErrors?: Record<string, string[]> };
}

export class ApiError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody;

  constructor(status: number, body: ApiErrorBody, message?: string) {
    super(message ?? body.message ?? `HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

interface ApiFetchOptions extends Omit<RequestInit, 'body'> {
  json?: unknown;
}

/**
 * Tiny fetch wrapper. Always sends `credentials: 'include'` so the
 * session cookie is round-tripped. JSON bodies get the right
 * Content-Type. Non-2xx responses throw `ApiError`.
 */
export async function apiFetch<T = unknown>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const { json, headers, ...rest } = options;
  const init: RequestInit = {
    ...rest,
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(headers ?? {}),
    },
    ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
  };
  const res = await fetch(apiUrl(path), init);
  if (res.status === 204 || res.headers.get('content-length') === '0') {
    return undefined as T;
  }
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // Body wasn't JSON. Pass through as a plain object with the raw text.
    parsed = { message: text };
  }
  if (!res.ok) {
    const body = (parsed ?? {}) as ApiErrorBody;
    throw new ApiError(res.status, body);
  }
  return parsed as T;
}
