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
