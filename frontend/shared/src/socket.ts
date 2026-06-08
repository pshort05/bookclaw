import { io, Socket } from 'socket.io-client';

let s: Socket | null = null;

export function socket(): Socket {
  if (s) return s;
  const base =
    (typeof window !== 'undefined' && window.__BOOKCLAW_API_BASE__) || undefined;
  const token =
    (typeof window !== 'undefined' && window.__BOOKCLAW_TOKEN__) || '';
  s = io(base, { auth: { token }, transports: ['websocket', 'polling'] });
  return s;
}
