import { Application, Request, Response } from 'express';
import { readBackupCfg, SNAPSHOT_RE } from '../../services/backup.js';
import { requireApprovedConfirmation } from './_shared.js';

/**
 * Backup & recovery API (book-container Phase 11). List/run snapshots, restore
 * (whole-workspace or per-book), read/update backup config. Adding a cloud
 * destination or hook is an outbound side effect → ConfirmationGate at setup;
 * approved scheduled pushes then run under that approval. Behind bearer auth
 * + IP allowlist like all /api/*.
 */

// Validated cloud blocks awaiting gate approval, keyed by confirmation id.
// In-memory on purpose: a restart (or replay of a consumed id) → 404, the
// client re-submits. The gate payload itself is display-only (sanitizePayload
// may redact it) — config is never persisted from it.
const pendingCloud = new Map<string, { enabled: boolean; destinations: string[]; hook: string | null }>();

export function mountBackups(app: Application, gateway: any, _baseDir: string): void {
  const services = gateway.getServices();
  const unavailable = (res: Response) => res.status(503).json({ error: 'Backup service unavailable (see startup log)' });

  const readCfg = () => {
    const cfg = readBackupCfg(services.config);
    return {
      enabled: cfg.enabled,
      scope: cfg.scope,
      local: { keep: cfg.keep },
      cloud: cfg.cloud,
      intervalHours: cfg.intervalHours,
      onCompletion: cfg.onCompletion,
      localPath: services.config.get('backup.localPath', '~/bookclaw-backups'),
    };
  };

  function validate(body: any): { ok: true; cfg: any } | { ok: false; error: string } {
    const cur = readCfg();
    const b = body && typeof body === 'object' ? body : {};
    const pick = (v: any, dflt: any) => (v === undefined ? dflt : v);
    // Known fields only — unknown client keys never ride through to persist.
    const cfg = {
      enabled: pick(b.enabled, cur.enabled),
      scope: pick(b.scope, cur.scope),
      local: { keep: pick(b.local?.keep, cur.local.keep) },
      cloud: {
        enabled: pick(b.cloud?.enabled, cur.cloud.enabled),
        destinations: pick(b.cloud?.destinations, cur.cloud.destinations),
        hook: pick(b.cloud?.hook, cur.cloud.hook),
      },
      intervalHours: pick(b.intervalHours, cur.intervalHours),
      onCompletion: pick(b.onCompletion, cur.onCompletion),
      localPath: typeof b.localPath === 'string' ? b.localPath : cur.localPath,
    };
    if (typeof cfg.enabled !== 'boolean') return { ok: false, error: 'enabled must be boolean' };
    if (!['standard', 'full'].includes(cfg.scope)) return { ok: false, error: 'scope must be standard|full' };
    if (!Number.isInteger(cfg.local.keep) || cfg.local.keep < 1 || cfg.local.keep > 1000) return { ok: false, error: 'local.keep must be 1..1000' };
    if (!Number.isFinite(cfg.intervalHours) || cfg.intervalHours < 1) return { ok: false, error: 'intervalHours must be >= 1' };
    if (!Array.isArray(cfg.cloud.destinations) || cfg.cloud.destinations.some((d: any) => typeof d !== 'string' || !d.trim())) {
      return { ok: false, error: 'cloud.destinations must be non-empty strings' };
    }
    if (cfg.cloud.hook !== null && typeof cfg.cloud.hook !== 'string') return { ok: false, error: 'cloud.hook must be a path or null' };
    if (cfg.cloud.enabled && cfg.cloud.destinations.length === 0 && !cfg.cloud.hook) {
      return { ok: false, error: 'cloud.enabled requires at least one destination or a hook' };
    }
    return { ok: true, cfg };
  }

  async function persist(cfg: any): Promise<void> {
    await services.config.setAndPersist('backup', {
      enabled: cfg.enabled, localPath: cfg.localPath, scope: cfg.scope,
      local: { keep: cfg.local.keep },
      cloud: { enabled: cfg.cloud.enabled, destinations: cfg.cloud.destinations, hook: cfg.cloud.hook },
      intervalHours: cfg.intervalHours, onCompletion: cfg.onCompletion,
    });
  }

  // Snapshot list + status.
  app.get('/api/backups', (_req: Request, res: Response) => {
    if (!services.backup) return unavailable(res);
    res.json({ ...services.backup.getStatus(), snapshots: services.backup.list().reverse() });
  });

  // Back up now. Allowed even when backup.enabled=false (explicit user action).
  app.post('/api/backups', async (_req: Request, res: Response) => {
    if (!services.backup) return unavailable(res);
    try { res.json({ ok: true, snapshot: await services.backup.snapshot('manual') }); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // Restore (optional { book } for per-book revert). Pre-snapshots automatically.
  app.post('/api/backups/:id/restore', async (req: Request, res: Response) => {
    if (!services.backup) return unavailable(res);
    const id = String(req.params.id);
    if (!SNAPSHOT_RE.test(id)) return res.status(400).json({ error: 'Invalid snapshot id' });
    const book = req.body?.book !== undefined ? String(req.body.book) : undefined;
    try {
      const result = await services.backup.restore(id, { book });
      // The restored templates may belong to the ACTIVE book — recompose the soul.
      await services.soul?.reload?.();
      res.json({ ok: true, ...result });
    }
    catch (e: any) { res.status(/Unknown snapshot|no book|Invalid slug/.test(e.message) ? 404 : 500).json({ error: e.message }); }
  });

  app.get('/api/backups/config', (_req: Request, res: Response) => res.json(readCfg()));

  // Update config. NEW cloud destinations / hook are confirmation-gated.
  app.put('/api/backups/config', async (req: Request, res: Response) => {
    const v = validate(req.body ?? {});
    if (!v.ok) return res.status(400).json({ error: v.error });
    try {
      const cur = readCfg();
      const newDests = v.cfg.cloud.destinations.filter((d: string) => !cur.cloud.destinations.includes(d));
      const newHook = v.cfg.cloud.hook && v.cfg.cloud.hook !== cur.cloud.hook ? v.cfg.cloud.hook : null;
      if (newDests.length || newHook) {
        const conf = await services.confirmationGate.createRequest({
          service: 'backup', action: 'enable_backup_destination', platform: 'cloud-backup',
          description: `Enable cloud backup upload to: ${[...newDests, ...(newHook ? [`hook ${newHook}`] : [])].join(', ')}. Future backups (books, library, config) will be copied there automatically until removed.`,
          // Display-only — the confirm endpoint persists from pendingCloud, never from this payload.
          payload: { destinations: newDests, hook: newHook }, riskLevel: 'high', isReversible: true,
        });
        pendingCloud.set(conf.id, v.cfg.cloud);
        return res.status(202).json({ pendingConfirmation: conf.id });
      }
      await persist(v.cfg);
      services.backup?.restart();
      res.json({ ok: true, config: readCfg() });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Finalize a gated config change AFTER dashboard approval (books.routes.ts pattern).
  // One-shot: the pending cloud block is merged over the CURRENT config (interim
  // PUTs survive) and consumed, so a replayed id can't re-apply stale config.
  app.post('/api/backups/config/confirm/:id', async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const cloud = pendingCloud.get(id);
    if (!cloud) return res.status(404).json({ error: 'Unknown or expired pending change (re-submit the config change)' });
    const gate = requireApprovedConfirmation(services.confirmationGate, { id, expectedService: 'backup' });
    if (!gate.ok) return res.status(gate.status).json({ error: gate.error });
    try {
      await persist({ ...readCfg(), cloud });
      pendingCloud.delete(id);
      // Transition the confirmation off 'approved' so a replay is rejected at the gate.
      await services.confirmationGate.recordOutcome(id, { success: true, message: 'Cloud backup destination enabled', executedAt: new Date().toISOString() });
      services.backup?.restart();
      res.json({ ok: true, config: readCfg() });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });
}
