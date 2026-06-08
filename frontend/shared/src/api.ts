declare global {
  interface Window {
    __BOOKCLAW_TOKEN__?: string;
    __BOOKCLAW_API_BASE__?: string;
  }
}

const token = (): string =>
  (typeof window !== 'undefined' && window.__BOOKCLAW_TOKEN__) || '';

const base = (): string =>
  (typeof window !== 'undefined' && window.__BOOKCLAW_API_BASE__) || '';

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const t = token();
  const res = await fetch(base() + path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(t ? { Authorization: `Bearer ${t}` } : {}),
      ...(init.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return res.status === 204 ? (undefined as T) : (res.json() as Promise<T>);
}
