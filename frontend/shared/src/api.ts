declare global {
  interface Window {
    __BOOKCLAW_TOKEN__?: string;
    __BOOKCLAW_API_BASE__?: string;
    __BOOKCLAW_CHAT_PORT__?: string;
  }
}

export const authToken = (): string =>
  (typeof window !== 'undefined' && window.__BOOKCLAW_TOKEN__) || '';

export const apiBase = (): string =>
  (typeof window !== 'undefined' && window.__BOOKCLAW_API_BASE__) || '';

/**
 * The standalone Chat app's port, injected into the studio HTML at serve time
 * from `BOOKCLAW_CHAT_PORT`. Empty when the chat app is disabled (port unset) —
 * callers should hide chat entry points in that case.
 */
export const chatPort = (): string =>
  (typeof window !== 'undefined' && window.__BOOKCLAW_CHAT_PORT__) || '';

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const t = authToken();
  const res = await fetch(apiBase() + path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(t ? { Authorization: `Bearer ${t}` } : {}),
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    // Surface the server's `error` message (the API returns { error } on 4xx/5xx)
    // so the UI shows WHY, not a bare status code. Fall back to status+path when
    // the body is empty or not JSON. The numeric status stays attached for the
    // few callers that branch on it.
    let serverMsg = '';
    try {
      const body: any = await res.json();
      if (body && typeof body.error === 'string') serverMsg = body.error;
    } catch { /* empty / non-JSON body */ }
    const err = new Error(serverMsg || `${res.status} ${path}`);
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }
  return res.status === 204 ? (undefined as T) : (res.json() as Promise<T>);
}
