import { socket } from './socket.js';

export interface ChatHandlers {
  onReply: (text: string) => void;
  onError: (msg: string) => void;
  /** Called when the socket disconnects while waiting for a reply. */
  onDisconnect?: () => void;
  /** Transient lifecycle notices (reconnected, terminal handshake rejection). */
  onNotice?: (msg: string) => void;
  /** Lets the subscription drop a stale reply that arrives while not waiting,
   *  so a late `response` after a reconnect can't attach to the wrong turn. */
  isWaiting?: () => boolean;
}

// A handshake rejection for these reasons is terminal — retrying won't help, so we
// stop the reconnection storm and surface a final error rather than spinning.
function isTerminalHandshake(msg: string): boolean {
  const m = msg.toLowerCase();
  return m.includes('auth') || m.includes('token') || m.includes('unauthor') ||
    m.includes('forbidden') || m.includes('cors') || m.includes('not allowed') ||
    m.includes('ip');
}

/** Subscribe to chat events; returns an unsubscribe fn. */
export function subscribeChat({ onReply, onError, onDisconnect, onNotice, isWaiting }: ChatHandlers): () => void {
  const s = socket();
  const reply = (p: { content?: string }) => {
    // Ignore a reply that arrives while we're not waiting — it belongs to no live turn.
    if (isWaiting && !isWaiting()) return;
    onReply(p?.content ?? '');
  };
  const err = (p: { message?: string }) => onError(p?.message ?? 'error');
  const disc = onDisconnect ?? (() => {});
  const connErr = (e: { message?: string }) => {
    const msg = e?.message || 'connection failed';
    onError(msg);
    if (isTerminalHandshake(msg)) s.disconnect(); // stop the reconnect storm
  };
  // Only announce a (re)connect once the socket has connected at least once —
  // the very first `connect` is the normal handshake, not a recovery.
  let everConnected = s.connected;
  const onConnect = () => {
    if (everConnected && onNotice) onNotice('Reconnected.');
    everConnected = true;
  };
  s.on('response', reply);
  s.on('chat_error', err);
  s.on('disconnect', disc);
  s.on('connect_error', connErr);
  s.on('connect', onConnect);
  return () => {
    s.off('response', reply);
    s.off('chat_error', err);
    s.off('disconnect', disc);
    s.off('connect_error', connErr);
    s.off('connect', onConnect);
  };
}

/** Send a chat message (server replies via the 'response' event). */
export function sendChat(content: string): void {
  socket().emit('message', { content });
}
