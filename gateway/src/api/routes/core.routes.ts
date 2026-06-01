import { Application, Request, Response } from 'express';

/**
 * Core endpoints: health/liveness/readiness probes, status dashboard, chat API,
 * project listing, cost report, audit log, and the activity feed (+ SSE stream).
 */
export function mountCore(app: Application, gateway: any, baseDir: string): void {
  const services = gateway.getServices();

  // ── Health Check ──
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      version: '4.0.0',
      name: 'BookClaw',
      brand: 'Writing Secrets',
      uptime: process.uptime(),
      links: {
        website: 'https://www.getwritingsecrets.com',
        kofi: 'https://ko-fi.com/s/4e24f1dfa5',
        youtube: 'https://www.youtube.com/@WritingSecrets',
      },
    });
  });

  // ── Liveness Probe (Kubernetes / Docker HEALTHCHECK) ──
  app.get('/healthz', (_req: Request, res: Response) => {
    res.json({ status: 'alive' });
  });

  // ── Readiness Probe ──
  app.get('/readyz', (_req: Request, res: Response) => {
    try {
      const providers = services.aiRouter.getActiveProviders();
      const count = Array.isArray(providers) ? providers.length : 0;
      if (count > 0) {
        res.json({ status: 'ready', providers: count });
      } else {
        res.status(503).json({ status: 'not_ready', reason: 'no active AI providers' });
      }
    } catch (err: any) {
      res.status(503).json({ status: 'not_ready', reason: err?.message || 'provider check failed' });
    }
  });

  // ── Status Dashboard ──
  app.get('/api/status', (_req: Request, res: Response) => {
    res.json({
      soul: services.soul.getName(),
      providers: services.aiRouter.getActiveProviders().map((p: any) => ({
        id: p.id, name: p.name, model: p.model, tier: p.tier,
      })),
      costs: services.costs.getStatus(),
      skills: {
        total: services.skills.getLoadedCount(),
        author: services.skills.getAuthorSkillCount(),
        premium: services.skills.getPremiumSkillCount(),
        premiumInstalled: services.skills.getPremiumSkills(),
        catalog: services.skills.getSkillCatalog(),
        byCategory: services.skills.getSkillsByCategory(),
      },
      heartbeat: services.heartbeat.getStats(),
      autonomous: services.heartbeat.getAutonomousStatus(),
      permissions: services.permissions.preset,
      cache: services.aiRouter.getCacheStats(),
      personas: services.personas ? {
        count: services.personas.getCount(),
        list: services.personas.list().map((p: any) => ({ id: p.id, penName: p.penName, genre: p.genre })),
      } : { count: 0, list: [] },
    });
  });

  // ── Chat API (for integrations) ──
  app.post('/api/chat', async (req: Request, res: Response) => {
    const { message, skipHistory } = req.body;
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Message required' });
    }
    if (message.length > 10000) {
      return res.status(400).json({ error: 'Message too long (max 10,000 chars)' });
    }

    // Slash commands + natural language commands: route to dedicated handler
    const lower = message.toLowerCase().trim();
    const isCommand = message.startsWith('/') ||
      ['continue', 'next', 'go', 'resume'].includes(lower);
    if (isCommand) {
      try {
        const result = await gateway.handleDashboardCommand(message);
        return res.json({ response: result });
      } catch (err: any) {
        return res.json({ response: 'Command error: ' + String(err?.message || err) });
      }
    }

    // Regular chat: use AI
    const channel = skipHistory ? 'conductor' : 'api';
    let response = '';
    try {
      await gateway.handleMessage(message, channel, (text: string) => {
        response = text;
      });
    } catch (err: any) {
      const msg = String(err?.message || err);
      if (msg.includes('No AI providers')) {
        return res.status(503).json({ error: 'No AI providers configured. Add an API key in Settings → API Keys.' });
      }
      return res.status(500).json({ error: 'AI error: ' + msg });
    }

    res.json({ response });
  });

  // ── Project Management ──
  app.get('/api/projects', async (_req: Request, res: Response) => {
    const { readdir } = await import('fs/promises');
    const { existsSync } = await import('fs');
    const { join } = await import('path');

    const projectsDir = join(baseDir, 'workspace', 'projects');
    if (!existsSync(projectsDir)) {
      return res.json({ projects: [] });
    }

    const entries = await readdir(projectsDir, { withFileTypes: true });
    const projects = entries.filter(e => e.isDirectory() && e.name !== '.template').map(e => e.name);
    res.json({ projects });
  });

  // ── Cost Report ──
  app.get('/api/costs', (_req: Request, res: Response) => {
    res.json(services.costs.getStatus());
  });

  // ── Audit Log (last 50 entries) ──
  app.get('/api/audit', async (_req: Request, res: Response) => {
    const { readFile } = await import('fs/promises');
    const { existsSync } = await import('fs');
    const { join } = await import('path');

    const today = new Date().toISOString().split('T')[0];
    const logFile = join(baseDir, 'workspace', '.audit', `${today}.jsonl`);

    if (!existsSync(logFile)) {
      return res.json({ entries: [] });
    }

    const raw = await readFile(logFile, 'utf-8');
    const entries = raw.trim().split('\n').map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean).slice(-50);

    res.json({ entries });
  });

  // ═══════════════════════════════════════════════════════════
  // Activity Log (universal agent action feed)
  // ═══════════════════════════════════════════════════════════

  // Get recent activity entries
  app.get('/api/activity', async (req: Request, res: Response) => {
    const activityLog = gateway.getActivityLog?.();
    if (!activityLog) {
      return res.json({ entries: [] });
    }
    const count = Number(req.query.count) || 50;
    const goalId = req.query.goalId as string | undefined;
    const entries = await activityLog.getRecent(count, goalId);
    res.json({ entries });
  });

  // SSE stream for real-time activity updates
  app.get('/api/activity/stream', (req: Request, res: Response) => {
    const activityLog = gateway.getActivityLog?.();
    if (!activityLog) {
      return res.status(503).json({ error: 'Activity log not initialized' });
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    // Send initial heartbeat
    res.write('data: {"type":"connected"}\n\n');

    // Register this client for live updates
    const cleanup = activityLog.addSSEClient(res);

    // Periodic keepalive so proxies/browsers don't close the idle connection.
    // Comment lines (prefixed ":") are ignored by EventSource but count as traffic.
    const keepalive = setInterval(() => {
      try { res.write(': ping\n\n'); } catch { /* connection already closed */ }
    }, 15000);

    // Clean up on disconnect
    req.on('close', () => {
      clearInterval(keepalive);
      cleanup();
    });
  });
}
