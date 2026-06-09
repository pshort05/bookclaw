import { socket } from './socket.js';

export interface ChatHandlers {
  onReply: (text: string) => void;
  onError: (msg: string) => void;
  /** Called when the socket disconnects while waiting for a reply. */
  onDisconnect?: () => void;
}

/** Subscribe to chat events; returns an unsubscribe fn. */
export function subscribeChat({ onReply, onError, onDisconnect }: ChatHandlers): () => void {
  const s = socket();
  const reply = (p: { content?: string }) => onReply(p?.content ?? '');
  const err = (p: { message?: string }) => onError(p?.message ?? 'error');
  const disc = onDisconnect ?? (() => {});
  s.on('response', reply);
  s.on('error', err);
  s.on('disconnect', disc);
  return () => { s.off('response', reply); s.off('error', err); s.off('disconnect', disc); };
}

/** Send a chat message (server replies via the 'response' event). */
export function sendChat(content: string): void {
  socket().emit('message', { content });
}
