/**
 * api/client.ts
 * Typed fetch wrapper — attaches JWT from localStorage, handles errors uniformly.
 */

const BASE = '/api';

function getToken(): string | null {
  return localStorage.getItem('aq_token');
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getToken();
  const headers = new Headers(options.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);

  if (!(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(`${BASE}${path}`, { ...options, headers });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((body as { error?: string }).error ?? 'Request failed');
  }

  return res.json() as Promise<T>;
}

export const api = {
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  upload: <T>(path: string, formData: FormData) =>
    request<T>(path, { method: 'POST', body: formData }),
  get: <T>(path: string) =>
    request<T>(path, { method: 'GET' }),
};
