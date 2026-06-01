import express from 'express';
import { join } from 'path';
import fs from 'fs/promises';
import { createAPIRoutes } from '../api/routes.js';
import { ROOT_DIR } from '../paths.js';
import type { BookClawGateway } from '../index.js';

/**
 * Phase 9: API routes. Phase 10: WebSocket. Phase 11: static dashboard (with
 * auth-token injection), JSON 404 + SPA fallback + global error handler. Then
 * the startup activity-log entry and the ready banner.
 */
export async function initHttp(gw: BookClawGateway): Promise<void> {
  // ── Phase 9: API Routes ──
  createAPIRoutes(gw.app, gw, ROOT_DIR);
  console.log('  ✓ API routes registered');

  // ── Phase 10: WebSocket ──
  gw.setupWebSocket();
  console.log('  ✓ WebSocket ready');

  // ── Phase 11: Static Dashboard ──
  const dashboardPath = join(ROOT_DIR, 'dashboard', 'dist');
  const dashboardHtmlFile = join(dashboardPath, 'index.html');

  // Serve the dashboard HTML with the auth token injected so its fetch calls can
  // authenticate. The __BOOKCLAW_AUTH_TOKEN__ placeholder is replaced at serve
  // time (empty string when auth is disabled). index:false on express.static below
  // ensures "/" reaches this handler instead of the raw file.
  const serveDashboard = async (_req: any, res: any) => {
    try {
      const html = await fs.readFile(dashboardHtmlFile, 'utf-8');
      res.type('html').send(html.replaceAll('__BOOKCLAW_AUTH_TOKEN__', gw.authToken ?? ''));
    } catch {
      if (!res.headersSent) {
        res.status(500).json({ status: 'error', message: 'BookClaw running but dashboard HTML not found.' });
      }
    }
  };

  gw.app.get('/', serveDashboard);
  gw.app.use(express.static(dashboardPath, { index: false }));

  // JSON 404 handler for API routes — MUST run before SPA fallback
  // so unmatched /api/ requests get JSON errors instead of the dashboard HTML.
  gw.app.use((req: any, res: any, next: any) => {
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
    }
    next();
  });

  // SPA fallback — any non-API path serves the dashboard HTML
  gw.app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) return; // already handled above
    serveDashboard(req, res);
  });

  // Global JSON error handler — ensures API errors never return HTML
  gw.app.use((err: any, _req: any, res: any, _next: any) => {
    console.error('Unhandled API error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: String(err?.message || err || 'Internal server error') });
    }
  });

  // Log startup to activity log
  const providers = gw.aiRouter.getActiveProviders();
  await gw.activityLog.log({
    type: 'system',
    source: 'internal',
    message: `BookClaw started — ${providers.length} AI provider(s), ${gw.skills.getLoadedCount()} skills`,
    metadata: {
      providers: providers.map(p => p.id),
      skillCount: gw.skills.getLoadedCount(),
    },
  });

  console.log('');
  console.log('  ═══════════════════════════════════');
  console.log('  ✍️  BookClaw is ready to write');
  console.log(`  📡 Dashboard: http://localhost:${gw.config.get('server.port', 3847)}`);
  console.log('  ═══════════════════════════════════');
  console.log('');
}
