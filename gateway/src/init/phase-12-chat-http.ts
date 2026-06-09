import express from 'express';
import { createServer } from 'http';
import { join } from 'path';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import { CHAT_DIST } from '../paths.js';
import type { BookClawGateway } from '../index.js';

/** Phase 12: optional standalone Chat SPA on BOOKCLAW_CHAT_PORT (cross-origin to the gateway). */
export async function initChatHttp(gw: BookClawGateway): Promise<void> {
  const chatPort = Number(process.env.BOOKCLAW_CHAT_PORT || 0);
  if (!chatPort) { console.log('  ℹ Chat app: disabled (set BOOKCLAW_CHAT_PORT to enable)'); return; }

  const gatewayPort = gw.config.get('server.port', 3847);
  const indexHtml = join(CHAT_DIST, 'index.html');
  if (!existsSync(indexHtml)) {
    console.log(`  ⚠ Chat app: dist not found at ${indexHtml} — run \`npm run -w frontend/chat build\`.`);
  }

  // Fix A: build an allowlist of hostnames the chat is legitimately served on.
  // A forged Host header would otherwise redirect the injected bearer token to an
  // attacker origin. Only hostnames in this set are trusted; others fall back to
  // 'localhost'. Sources: always localhost/127.0.0.1; hostnames parsed from
  // BOOKCLAW_CORS_ORIGINS (the LAN host is already listed there for LAN access);
  // and BOOKCLAW_PUBLIC_HOST if set (belt-and-suspenders for hosts not in CORS).
  const allowedChatHostnames = new Set<string>(['localhost', '127.0.0.1']);
  for (const origin of (process.env.BOOKCLAW_CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean)) {
    try { allowedChatHostnames.add(new URL(origin).hostname); } catch { /* ignore malformed */ }
  }
  if (process.env.BOOKCLAW_PUBLIC_HOST) allowedChatHostnames.add(process.env.BOOKCLAW_PUBLIC_HOST.trim());

  const chatApp = express();

  // Fix B: apply the same source-IP allowlist gate as the main app (gw.allowedIps /
  // gw.isIpAllowed). Loopback is always allowed (matching main app). BOOKCLAW_TRUST_PROXY
  // is honoured via gw.trustProxy (set at construction). This runs before serving any
  // content so BOOKCLAW_ALLOWED_IPS applies to the chat port just as it does to :3847.
  if (gw.allowedIps.length > 0) {
    chatApp.set('trust proxy', gw.trustProxy);
    chatApp.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
      const ip = req.ip || req.socket.remoteAddress || '';
      if (gw.isIpAllowed(ip)) return next();
      return res.status(403).send('Forbidden: source IP not allowed');
    });
    console.log(`  ✓ Chat app: source-IP allowlist enforced (${gw.allowedIps.length} rule(s))`);
  } else {
    console.log('  ℹ Chat app: source-IP allowlist not set (all source IPs allowed)');
  }

  // Per-request: derive the gateway origin from the Host the browser used (validated
  // against the allowlist — Fix A), set a chat-specific CSP that allows calling the
  // gateway (http + ws), and serve the SPA index with the token + API base injected.
  const serveIndex = async (req: express.Request, res: express.Response) => {
    const rawHost = String(req.headers.host || '').replace(/:\d+$/, '');
    const validatedHost = allowedChatHostnames.has(rawHost) ? rawHost : 'localhost';
    const gatewayOrigin = `http://${validatedHost}:${gatewayPort}`;
    res.setHeader('Content-Security-Policy', [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self'",
      `connect-src 'self' ${gatewayOrigin} ws://${validatedHost}:${gatewayPort}`,
    ].join('; '));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      const html = await fs.readFile(indexHtml, 'utf-8');
      res.type('html').send(
        html
          .replaceAll('__BOOKCLAW_AUTH_TOKEN__', gw.authToken ?? '')
          .replaceAll('__BOOKCLAW_API_BASE__', gatewayOrigin),
      );
    } catch { if (!res.headersSent) res.status(500).send('Chat UI not built'); }
  };

  chatApp.get('/', serveIndex);
  chatApp.use(express.static(CHAT_DIST, { index: false }));
  chatApp.get('*', (req, res) => {           // SPA fallback (no API on this server)
    if (/\.[a-zA-Z0-9]+$/.test(req.path)) return res.status(404).send('Not found');
    serveIndex(req, res);
  });

  const chatServer = createServer(chatApp);
  await new Promise<void>((resolve) => chatServer.listen(chatPort, process.env.BOOKCLAW_BIND || '0.0.0.0', resolve));
  gw.chatServer = chatServer;                 // hold a ref (field declared in the gateway class)
  console.log(`  ✓ Chat app: serving on :${chatPort} (API → :${gatewayPort})`);
}
