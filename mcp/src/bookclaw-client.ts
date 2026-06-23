export type BookClawResult =
  | { ok: true; status: number; data: unknown }
  | { ok: false; status: number; error: string };

export interface BookClawClient {
  request(method: string, path: string, body?: unknown): Promise<BookClawResult>;
}

interface ClientOpts {
  baseUrl?: string;
  token?: string;
  timeoutMs?: number;
}

function friendlyError(status: number, baseUrl: string, raw: string): string {
  switch (status) {
    case 401:
      return 'BookClaw rejected the request (401) — check BOOKCLAW_AUTH_TOKEN.';
    case 403:
      return `BookClaw denied the request (403): ${raw || 'IP allowlist or confirmation gate.'}`;
    case 503:
      return 'BookClaw has no AI providers configured — add a key in BookClaw Settings.';
    default:
      return `BookClaw returned ${status}: ${raw || 'no body'} (${baseUrl})`;
  }
}

export function createClient(opts: ClientOpts = {}): BookClawClient {
  const baseUrl = (opts.baseUrl ?? process.env.BOOKCLAW_BASE_URL ?? 'http://127.0.0.1:3847').replace(/\/$/, '');
  const token = opts.token ?? process.env.BOOKCLAW_AUTH_TOKEN ?? '';
  const timeoutMs = opts.timeoutMs ?? 30_000;

  return {
    async request(method, path, body) {
      const url = `${baseUrl}${path}`;
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (token) headers['authorization'] = `Bearer ${token}`;

      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), timeoutMs);
      try {
        const resp = await fetch(url, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: ac.signal,
        });
        const text = await resp.text();
        let parsed: unknown = text;
        try { parsed = text ? JSON.parse(text) : null; } catch { /* keep raw text */ }

        if (!resp.ok) {
          const raw = typeof parsed === 'object' && parsed && 'error' in parsed
            ? String((parsed as Record<string, unknown>).error)
            : text;
          return { ok: false, status: resp.status, error: friendlyError(resp.status, baseUrl, raw) };
        }
        return { ok: true, status: resp.status, data: parsed };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, status: 0, error: `Could not reach BookClaw at ${baseUrl}: ${msg} (retryable).` };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
