import { Application, Request, Response } from 'express';

/**
 * Dashboard management endpoints: memory reset, encrypted-vault key CRUD +
 * provider refresh, sanitized config read + whitelisted config update, and
 * Telegram bridge management.
 */
export function mountSettings(app: Application, gateway: any, baseDir: string): void {
  const services = gateway.getServices();

  // ═══════════════════════════════════════════════════════════
  // Memory Management
  // ═══════════════════════════════════════════════════════════

  app.post('/api/memory/reset', async (req: Request, res: Response) => {
    const fullReset = req.query.full === 'true' || req.body?.full === true;
    try {
      const result = await services.memory.reset(fullReset);
      await services.audit.log('memory', 'reset', { fullReset, cleared: result.cleared });
      res.json({ success: true, ...result, fullReset });
    } catch (error) {
      res.status(500).json({ error: 'Failed to reset memory: ' + String(error) });
    }
  });

  // ═══════════════════════════════════════════════════════════
  // Vault Management (for dashboard API key configuration)
  // ═══════════════════════════════════════════════════════════

  // Store a key in the encrypted vault
  app.post('/api/vault', async (req: Request, res: Response) => {
    const { key, value } = req.body;
    if (!key || !value) {
      return res.status(400).json({ error: 'key and value required' });
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(key)) {
      return res.status(400).json({ error: 'Invalid key name. Use only letters, numbers, underscores, and hyphens.' });
    }
    try {
      await services.vault.set(key, value);
      await services.audit.log('vault', 'key_stored', { key });

      // Auto-refresh AI providers when an API key is stored
      const apiKeyNames = ['gemini_api_key', 'deepseek_api_key', 'anthropic_api_key', 'openai_api_key', 'openrouter_api_key'];
      let refreshedProviders: string[] | undefined;
      if (apiKeyNames.includes(key)) {
        refreshedProviders = await services.aiRouter.reinitialize();
      }

      res.json({ success: true, key, refreshedProviders });
    } catch (error) {
      res.status(500).json({ error: 'Failed to store key' });
    }
  });

  // Manually refresh AI provider detection
  app.post('/api/providers/refresh', async (_req: Request, res: Response) => {
    try {
      const providers = await services.aiRouter.reinitialize();
      res.json({
        success: true,
        providers: services.aiRouter.getActiveProviders().map((p: any) => ({
          id: p.id, name: p.name, model: p.model, tier: p.tier,
        })),
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to refresh providers: ' + String(error) });
    }
  });

  // Load API keys from text files in the VM shared folder
  app.post('/api/vault/load-from-files', async (req: Request, res: Response) => {
    const { readFile: rf } = await import('fs/promises');
    const { existsSync: ex } = await import('fs');
    const { join: j } = await import('path');

    // Check common shared folder locations (VM, Docker, or user-set env var)
    const candidates = [
      process.env.BOOKCLAW_KEYS_DIR,
      '/media/sf_bookclaw-transfer',
      '/media/sf_vm-transfer',
      j(baseDir, '..', 'vm-transfer'),
    ].filter(Boolean) as string[];
    const sharedFolder = candidates.find(p => ex(p));
    if (!sharedFolder) {
      return res.status(404).json({ error: 'No key folder found. Add API keys manually in Settings above.' });
    }

    const keyFiles: Record<string, string> = {
      'gemini_api_key': 'gemini_api_key.txt',
      'deepseek_api_key': 'deepseek_api_key.txt',
      'anthropic_api_key': 'anthropic_api_key.txt',
      'openai_api_key': 'openai_api_key.txt',
      'telegram_bot_token': 'telegram_bot_token.txt',
    };

    const loaded: string[] = [];
    const errors: string[] = [];

    for (const [vaultKey, filename] of Object.entries(keyFiles)) {
      const filePath = j(sharedFolder, filename);
      if (ex(filePath)) {
        try {
          const value = (await rf(filePath, 'utf-8')).trim();
          if (value && value.length > 5) {
            await services.vault.set(vaultKey, value);
            await services.audit.log('vault', 'key_loaded_from_file', { key: vaultKey, file: filename });
            loaded.push(vaultKey);
          }
        } catch (e) {
          errors.push(`${filename}: ${String(e)}`);
        }
      }
    }

    // Generic key.txt fallback
    const fallbackKey = req.body?.fallbackKeyName || 'gemini_api_key';
    const genericPath = j(sharedFolder, 'key.txt');
    if (ex(genericPath) && !loaded.includes(fallbackKey)) {
      try {
        const value = (await rf(genericPath, 'utf-8')).trim();
        if (value && value.length > 5) {
          await services.vault.set(fallbackKey, value);
          await services.audit.log('vault', 'key_loaded_from_file', { key: fallbackKey, file: 'key.txt' });
          loaded.push(fallbackKey + ' (from key.txt)');
        }
      } catch (e) {
        errors.push(`key.txt: ${String(e)}`);
      }
    }

    // Re-initialize AI providers if any API keys were loaded
    const apiKeyNames = ['gemini_api_key', 'deepseek_api_key', 'anthropic_api_key', 'openai_api_key'];
    if (loaded.some(k => apiKeyNames.some(ak => k.startsWith(ak)))) {
      try {
        await services.aiRouter.reinitialize();
      } catch (e) {
        errors.push(`reinitialize: ${String(e)}`);
      }
    }

    res.json({ loaded, errors, message: loaded.length > 0 ? `Loaded ${loaded.length} key(s)` : 'No key files found in shared folder' });
  });

  // List stored key names (never values)
  app.get('/api/vault/keys', async (_req: Request, res: Response) => {
    const keys = await services.vault.list();
    res.json({ keys });
  });

  // Delete a key from the vault
  app.delete('/api/vault/:key', async (req: Request, res: Response) => {
    const key = String(req.params.key || '');
    // Same validation as POST — only allow alphanumeric + underscore/hyphen.
    if (!/^[a-zA-Z0-9_-]+$/.test(key) || key.length < 1 || key.length > 100) {
      return res.status(400).json({ error: 'Invalid key name' });
    }
    const deleted = await services.vault.delete(key);
    if (deleted) {
      await services.audit.log('vault', 'key_deleted', { key });
    }
    res.json({ success: deleted });
  });

  // ═══════════════════════════════════════════════════════════
  // Config (sanitized, read-only for dashboard)
  // ═══════════════════════════════════════════════════════════

  app.get('/api/config', (_req: Request, res: Response) => {
    res.json({
      ai: services.config.get('ai'),
      heartbeat: services.config.get('heartbeat'),
      costs: services.config.get('costs'),
      security: { permissionPreset: services.config.get('security.permissionPreset') },
    });
  });

  // Update a single config value (for dashboard settings)
  app.post('/api/config/update', async (req: Request, res: Response) => {
    const { path, value } = req.body;
    if (!path) return res.status(400).json({ error: 'path required' });
    const safePaths = [
      'costs.dailyLimit', 'costs.monthlyLimit',
      'heartbeat.intervalMinutes', 'heartbeat.dailyWordGoal',
      'heartbeat.enableReminders', 'heartbeat.quietHoursStart',
      'heartbeat.quietHoursEnd', 'heartbeat.autonomousEnabled',
      'heartbeat.autonomousIntervalMinutes', 'heartbeat.maxAutonomousStepsPerWake',
      'ai.defaultTemperature', 'ai.preferredProvider', 'ai.preferredImageProvider',
      'ai.ollama.enabled', 'ai.ollama.endpoint', 'ai.ollama.model',
      'ai.openrouter.model', 'ai.claude.model', 'ai.gemini.model',
      'bridges.telegram.enabled', 'bridges.telegram.pairingEnabled',
      'pipeline.maxConcurrentDrives', 'pipeline.providerThrottle',
    ];
    if (!safePaths.includes(path)) {
      return res.status(403).json({ error: 'Config path not allowed' });
    }
    // Trust-boundary check on per-provider default-model writes: the Settings
    // datalist is only a hint, so the value is free text. Reject anything that
    // isn't a plausible model id before it is persisted and pushed live into the
    // router (a bad id would silently break every generation routed there).
    if (/^ai\.[a-z]+\.model$/.test(path)) {
      if (typeof value !== 'string' || !/^[A-Za-z0-9._\-/:]{1,200}$/.test(value)) {
        return res.status(400).json({ error: 'Invalid model id' });
      }
    }
    // Flagship Plan 6: a bad cap could either DOS local resources (absurdly
    // high) or wedge every drive (zero/negative) — validate before persisting.
    if (path === 'pipeline.maxConcurrentDrives') {
      if (!Number.isInteger(value) || value < 1 || value > 20) {
        return res.status(400).json({ error: 'maxConcurrentDrives must be an integer between 1 and 20' });
      }
    }
    if (path === 'pipeline.providerThrottle') {
      const validThrottle = value && typeof value === 'object' && !Array.isArray(value) &&
        Object.values(value).every((v) => Number.isInteger(v) && (v as number) >= 1);
      if (!validThrottle) {
        return res.status(400).json({ error: 'providerThrottle must be an object of positive integer limits' });
      }
    }
    try {
      // Persist to disk so settings survive restart (was a bug — values were
      // updating in-memory only, then getting lost on next boot).
      await services.config.setAndPersist(path, value);
      // Sync global provider preference to router
      if (path === 'ai.preferredProvider') {
        services.aiRouter.setGlobalPreferredProvider(value || null);
      }
      // Push a changed spend limit into the live CostTracker — its limits are
      // otherwise constructor-only, so the over-budget guard (and /api/status)
      // would keep using the boot-time cap until the next restart even though the
      // value is persisted. Read both back from config so a single-field update
      // leaves the other limit intact.
      if (path === 'costs.dailyLimit' || path === 'costs.monthlyLimit') {
        services.costs?.setLimits(
          services.config.get('costs.dailyLimit'),
          services.config.get('costs.monthlyLimit'),
        );
      }
      // Rebuild providers so a changed per-provider default model takes effect
      // without a restart (the router reads config.<provider>.model at build time).
      if (/^ai\.(claude|gemini|openrouter|ollama)\.model$/.test(path)) {
        await services.aiRouter.reinitialize();
      }
      // Flagship Plan 6: push a changed concurrency cap into the live
      // DriveScheduler / a changed throttle into the live AIRouter — same
      // live-sync pattern as costs.dailyLimit above, otherwise a Settings
      // change would sit inert until the next restart.
      if (path === 'pipeline.maxConcurrentDrives') {
        services.driveScheduler?.setMaxConcurrent(value);
      }
      if (path === 'pipeline.providerThrottle') {
        services.aiRouter?.setThrottleLimits?.(value);
      }
      res.json({ success: true, path, value });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Config update failed' });
    }
  });

  // ═══════════════════════════════════════════════════════════
  // Telegram Bridge Management (dashboard integration)
  // ═══════════════════════════════════════════════════════════

  app.get('/api/telegram/status', async (_req: Request, res: Response) => {
    const enabled = services.config.get('bridges.telegram.enabled', false);
    const hasToken = (await services.vault.list()).includes('telegram_bot_token');
    const allowedUsers: string[] = services.config.get('bridges.telegram.allowedUsers', []);
    const connected = gateway.isTelegramConnected?.() || false;

    res.json({
      enabled,
      hasToken,
      connected,
      allowedUsers,
      pairingEnabled: services.config.get('bridges.telegram.pairingEnabled', true),
    });
  });

  app.post('/api/telegram/users', async (req: Request, res: Response) => {
    const { users } = req.body;
    if (!Array.isArray(users)) {
      return res.status(400).json({ error: 'users must be an array of user ID strings' });
    }
    const valid = users.every((u: any) => typeof u === 'string' && /^\d+$/.test(u));
    if (!valid) {
      return res.status(400).json({ error: 'Each user ID must be a numeric string' });
    }
    await services.config.setAndPersist('bridges.telegram.allowedUsers', users);
    gateway.updateTelegramUsers?.(users);
    res.json({ success: true, users });
  });

  app.post('/api/telegram/connect', async (req: Request, res: Response) => {
    try {
      const { token, userId } = req.body || {};

      // Save token and userId to vault before connecting
      if (token) {
        await services.vault.set('telegram_bot_token', token);
        await services.audit.log('vault', 'telegram_token_saved', {});
      }
      if (userId) {
        await services.config.setAndPersist('bridges.telegram.allowedUsers', [String(userId)]);
      }

      const result = await gateway.connectTelegram?.();
      if (result?.error) {
        return res.status(400).json({ error: result.error });
      }
      await services.config.setAndPersist('bridges.telegram.enabled', true);
      res.json({ success: true, message: 'Telegram bridge connected' });
    } catch (error) {
      res.status(500).json({ error: 'Failed to connect Telegram: ' + String(error) });
    }
  });

  app.post('/api/telegram/disconnect', async (_req: Request, res: Response) => {
    gateway.disconnectTelegram?.();
    await services.config.setAndPersist('bridges.telegram.enabled', false);
    res.json({ success: true, message: 'Telegram bridge disconnected' });
  });

  app.post('/api/telegram/test', async (req: Request, res: Response) => {
    const token = req.body.token || await services.vault.get('telegram_bot_token');
    if (!token) {
      return res.status(400).json({ error: 'No token provided or stored' });
    }
    try {
      const response = await fetch(`https://api.telegram.org/bot${token}/getMe`);
      const data = await response.json() as any;
      if (data.ok) {
        res.json({ success: true, bot: { username: data.result.username, name: data.result.first_name } });
      } else {
        res.status(400).json({ error: data.description || 'Invalid token' });
      }
    } catch (error) {
      res.status(500).json({ error: 'Failed to test token: ' + String(error) });
    }
  });
}
