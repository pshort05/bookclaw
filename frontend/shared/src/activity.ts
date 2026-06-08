import type { ActivityEntry } from './types.js';
import { authToken, apiBase } from './api.js';

/**
 * Subscribe to the live activity stream (GET /api/activity/stream, text/event-stream).
 * EventSource cannot set Authorization headers, so the bearer token is passed via the
 * server's ?token= query fallback. Returns an unsubscribe function (closes the stream).
 * The server sends an initial {"type":"connected"} handshake frame — it is filtered out.
 * On reconnect (browser auto-reconnects on error), onReconnect is called so the caller
 * can refetch the backlog to fill any gap while the stream was down.
 */
export function streamActivity(onEntry: (e: ActivityEntry) => void, onReconnect?: () => void): () => void {
  const t = authToken();
  const url = `${apiBase()}/api/activity/stream${t ? `?token=${encodeURIComponent(t)}` : ''}`;
  const es = new EventSource(url);
  let opened = false;
  es.onopen = () => { if (opened && onReconnect) onReconnect(); opened = true; };
  es.onmessage = (ev: MessageEvent) => {
    try {
      const data = JSON.parse(ev.data);
      if (data && data.type === 'connected') return; // handshake, not an entry
      onEntry(data as ActivityEntry);
    } catch {
      /* ignore malformed frame */
    }
  };
  // The browser auto-reconnects on error; the onopen handler above resyncs the backlog
  // (filling any gap) via onReconnect. Keep an explicit (no-op) handler for clarity.
  es.onerror = () => { /* transient; EventSource will reconnect, then onopen → onReconnect */ };
  return () => es.close();
}
