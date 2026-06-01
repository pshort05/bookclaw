import { Application, Request, Response } from 'express';
import path from 'path';
import { addWaveDisclaimer } from './_shared.js';

/** Memory search, user model, cron scheduler, auto-skill drafts, writing judge, character voices, research lookup (+runMarketingPreset), video research, story structures, plot promises. */
export function mountKnowledge(app: Application, gateway: any, baseDir: string): void {
  const services = gateway.getServices();

  // ═══════════════════════════════════════════════════════════
  // Memory Search (Hermes-inspired FTS5 over conversations + step outputs)
  // ═══════════════════════════════════════════════════════════

  /**
   * GET /api/memory/search?q=<query>&persona=<id>&project=<id>&source=<src>&limit=<n>
   *   - persona=__active will use the currently-active persona; pass __all to disable filtering.
   * Returns ranked snippets with FTS5 highlighting.
   */
  app.get('/api/memory/search', (req: Request, res: Response) => {
    const search = services.memorySearch;
    if (!search) return res.status(503).json({ error: 'Memory search service not initialized' });
    if (!search.isAvailable()) {
      const stats = search.getStats();
      return res.status(503).json({ error: stats.unavailableReason || 'Search unavailable', stats });
    }
    const q = String(req.query.q || '').trim();
    if (!q) return res.json({ hits: [], totalEntries: search.getStats().totalEntries });

    const personaParam = req.query.persona as string | undefined;
    const personaId = personaParam === '__all' ? undefined
      : personaParam === '__active' ? services.memory?.getActivePersonaId() ?? undefined
      : personaParam;

    const projectParam = req.query.project as string | undefined;
    const projectId = projectParam === '__active'
      ? services.memory?.getActiveProjectId() ?? undefined
      : projectParam;

    const hits = search.search(q, {
      limit: req.query.limit ? Math.min(parseInt(String(req.query.limit), 10) || 25, 100) : 25,
      source: req.query.source as any,
      personaId: personaId ?? undefined,
      projectId,
      fromDate: req.query.fromDate as any,
      toDate: req.query.toDate as any,
    });
    res.json({ hits, query: q, count: hits.length });
  });

  app.get('/api/memory/stats', (_req: Request, res: Response) => {
    const search = services.memorySearch;
    if (!search) return res.status(503).json({ error: 'Memory search not initialized' });
    res.json(search.getStats());
  });

  /** Force a full reindex. Useful after manual edits to conversation files. */
  app.post('/api/memory/reindex', async (_req: Request, res: Response) => {
    const search = services.memorySearch;
    if (!search) return res.status(503).json({ error: 'Memory search not initialized' });
    if (!search.isAvailable()) return res.status(503).json({ error: 'Memory search unavailable' });
    try {
      const result = await search.reindexAll({ force: true });
      res.json({ ...result, stats: search.getStats() });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Reindex failed' });
    }
  });

  // ─── Active Persona (memory tagging) ───
  // Sets which persona future conversation turns get tagged with so each
  // pen name maintains its own memory boundary in the search index.
  app.get('/api/memory/active-persona', (_req: Request, res: Response) => {
    if (!services.memory) return res.status(503).json({ error: 'Memory not initialized' });
    res.json({
      personaId: services.memory.getActivePersonaId(),
      projectId: services.memory.getActiveProjectId(),
    });
  });

  app.post('/api/memory/active-persona', async (req: Request, res: Response) => {
    if (!services.memory) return res.status(503).json({ error: 'Memory not initialized' });
    const { personaId } = req.body || {};
    // null/empty string clears the active persona (= unscoped memory)
    const value = personaId && typeof personaId === 'string' ? personaId : null;
    await services.memory.setActivePersona(value);
    res.json({ personaId: services.memory.getActivePersonaId() });
  });

  // ═══════════════════════════════════════════════════════════
  // User Model (Honcho-inspired dialectic profile)
  // ═══════════════════════════════════════════════════════════

  app.get('/api/user-model', (_req: Request, res: Response) => {
    if (!services.userModel) return res.status(503).json({ error: 'User model not initialized' });
    res.json({ snapshot: services.userModel.getSnapshot() });
  });

  app.post('/api/user-model/consolidate', async (_req: Request, res: Response) => {
    if (!services.userModel) return res.status(503).json({ error: 'User model not initialized' });
    try {
      const snap = await services.userModel.maybeConsolidate(true);
      if (!snap) return res.status(503).json({ error: 'No AI provider available for consolidation' });
      res.json({ snapshot: snap });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Consolidation failed' });
    }
  });

  app.delete('/api/user-model', async (_req: Request, res: Response) => {
    if (!services.userModel) return res.status(503).json({ error: 'User model not initialized' });
    await services.userModel.reset();
    res.json({ success: true });
  });

  // ═══════════════════════════════════════════════════════════
  // Cron Scheduler
  // ═══════════════════════════════════════════════════════════

  app.get('/api/cron', (_req: Request, res: Response) => {
    if (!services.cronScheduler) return res.status(503).json({ error: 'Cron not initialized' });
    res.json({
      jobs: services.cronScheduler.list(),
      handlers: services.cronScheduler.listHandlers(),
    });
  });

  app.post('/api/cron', async (req: Request, res: Response) => {
    if (!services.cronScheduler) return res.status(503).json({ error: 'Cron not initialized' });
    const { name, schedule, handler, payload, enabled } = req.body || {};
    if (!name || !schedule || !handler) {
      return res.status(400).json({ error: 'name, schedule, handler required' });
    }
    try {
      const job = await services.cronScheduler.createJob({ name, schedule, handler, payload, enabled });
      res.json({ job });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Job creation failed' });
    }
  });

  app.patch('/api/cron/:id', async (req: Request, res: Response) => {
    if (!services.cronScheduler) return res.status(503).json({ error: 'Cron not initialized' });
    try {
      const job = await services.cronScheduler.updateJob(req.params.id, req.body || {});
      if (!job) return res.status(404).json({ error: 'Job not found' });
      res.json({ job });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Update failed' });
    }
  });

  app.delete('/api/cron/:id', async (req: Request, res: Response) => {
    if (!services.cronScheduler) return res.status(503).json({ error: 'Cron not initialized' });
    const removed = await services.cronScheduler.deleteJob(req.params.id);
    res.json({ success: removed });
  });

  app.post('/api/cron/:id/run-now', async (req: Request, res: Response) => {
    if (!services.cronScheduler) return res.status(503).json({ error: 'Cron not initialized' });
    const result = await services.cronScheduler.runNow(req.params.id);
    res.json(result);
  });

  app.post('/api/cron/validate', async (req: Request, res: Response) => {
    const { validateCronExpression } = await import('../../services/cron-scheduler.js');
    const { schedule } = req.body || {};
    if (!schedule) return res.status(400).json({ error: 'schedule required' });
    res.json(validateCronExpression(schedule));
  });

  // ═══════════════════════════════════════════════════════════
  // Auto-Skill Drafts (review before promotion to skills/ops/)
  // ═══════════════════════════════════════════════════════════

  app.get('/api/skill-drafts', (req: Request, res: Response) => {
    if (!services.autoSkill) return res.status(503).json({ error: 'Auto-skill not initialized' });
    const status = req.query.status as any;
    res.json({ drafts: services.autoSkill.list(status ? { status } : undefined) });
  });

  app.get('/api/skill-drafts/:id', (req: Request, res: Response) => {
    if (!services.autoSkill) return res.status(503).json({ error: 'Auto-skill not initialized' });
    const draft = services.autoSkill.get(req.params.id);
    if (!draft) return res.status(404).json({ error: 'Draft not found' });
    res.json({ draft });
  });

  app.post('/api/skill-drafts/:id/accept', async (req: Request, res: Response) => {
    if (!services.autoSkill) return res.status(503).json({ error: 'Auto-skill not initialized' });
    const category = req.body?.category;
    const result = await services.autoSkill.accept(req.params.id, category ? { category } : {});
    if (!result.success) return res.status(400).json(result);
    res.json(result);
  });

  app.post('/api/skill-drafts/:id/reject', async (req: Request, res: Response) => {
    if (!services.autoSkill) return res.status(503).json({ error: 'Auto-skill not initialized' });
    const result = await services.autoSkill.reject(req.params.id);
    if (!result.success) return res.status(400).json(result);
    res.json(result);
  });

  /** Manually request a draft from any completed project. */
  app.post('/api/projects/:id/draft-skill', async (req: Request, res: Response) => {
    if (!services.autoSkill) return res.status(503).json({ error: 'Auto-skill not initialized' });
    const engine = gateway.getProjectEngine?.();
    const project = engine?.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    try {
      const draft = await services.autoSkill.draftFromProject({
        id: project.id, type: project.type, title: project.title,
        description: project.description, steps: project.steps,
      }, 'user-request');
      if (!draft) return res.status(400).json({ error: 'Draft generation failed (AI provider issue or no completed steps)' });
      res.json({ draft });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Draft failed' });
    }
  });

  // ═══════════════════════════════════════════════════════════
  // Writing Judge — manual evaluation endpoint
  // ═══════════════════════════════════════════════════════════

  /**
   * POST /api/judge { text, runLLMJudge?, threshold?, mechanicalWeight? }
   *   Score arbitrary prose. The judge runs automatically inside the project
   *   pipeline; this endpoint lets the user (or scripts) score loose text.
   */
  app.post('/api/judge', async (req: Request, res: Response) => {
    if (!services.writingJudge) return res.status(503).json({ error: 'Writing judge not initialized' });
    const { text, runLLMJudge, threshold, mechanicalWeight, dualJudge } = req.body || {};
    if (!text || typeof text !== 'string') return res.status(400).json({ error: 'text (string) required' });
    try {
      const verdict = await services.writingJudge.evaluate(text, {
        aiComplete: runLLMJudge !== false ? (r: any) => services.aiRouter.complete(r) : undefined,
        aiSelectProvider: runLLMJudge !== false ? (taskType: string) => services.aiRouter.selectProvider(taskType) : undefined,
        threshold,
        mechanicalWeight,
        runLLMJudge: runLLMJudge !== false,
        dualJudge: dualJudge === true,
      });
      res.json(verdict);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Evaluation failed' });
    }
  });

  // ═══════════════════════════════════════════════════════════
  // Per-character voice fingerprinting + drift detection
  // ═══════════════════════════════════════════════════════════

  app.get('/api/projects/:id/character-voices', async (req: Request, res: Response) => {
    if (!services.characterVoices) return res.status(503).json({ error: 'Not initialized' });
    res.json(await services.characterVoices.getProjectVoices(req.params.id));
  });

  /** Ingest a chapter's dialogue into the per-character corpus, refresh
   *  fingerprints if any character crossed the threshold. */
  app.post('/api/projects/:id/character-voices/ingest', async (req: Request, res: Response) => {
    if (!services.characterVoices) return res.status(503).json({ error: 'Not initialized' });
    const { chapterNumber, chapterText, characterNames, characterAliases } = req.body || {};
    if (!chapterText || typeof chapterText !== 'string') {
      return res.status(400).json({ error: 'chapterText (string) required' });
    }
    if (!Array.isArray(characterNames)) {
      return res.status(400).json({ error: 'characterNames (array) required' });
    }
    try {
      const result = await services.characterVoices.ingestChapter({
        projectId: req.params.id,
        chapterNumber: Number(chapterNumber) || 1,
        chapterText,
        characterNames,
        characterAliases: characterAliases || {},
      });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Ingestion failed' });
    }
  });

  /** Score a single chapter for character-voice drift against built fingerprints. */
  app.post('/api/projects/:id/character-voices/detect-drift', async (req: Request, res: Response) => {
    if (!services.characterVoices) return res.status(503).json({ error: 'Not initialized' });
    const { chapterNumber, chapterText, characterNames, characterAliases } = req.body || {};
    if (!chapterText || typeof chapterText !== 'string') {
      return res.status(400).json({ error: 'chapterText (string) required' });
    }
    if (!Array.isArray(characterNames)) {
      return res.status(400).json({ error: 'characterNames (array) required' });
    }
    try {
      const report = await services.characterVoices.detectDrift({
        projectId: req.params.id,
        chapterNumber: Number(chapterNumber) || 1,
        chapterText,
        characterNames,
        characterAliases: characterAliases || {},
      });
      res.json(report);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Drift detection failed' });
    }
  });

  /** GET /api/judge/screen?text=... — mechanical screen only (no AI cost). */
  app.get('/api/judge/screen', (req: Request, res: Response) => {
    if (!services.writingJudge) return res.status(503).json({ error: 'Writing judge not initialized' });
    const text = String(req.query.text || '');
    if (!text) return res.status(400).json({ error: 'text query param required' });
    res.json(services.writingJudge.mechanicalScreen(text));
  });

  // ═══════════════════════════════════════════════════════════
  // Research Lookup — sourced research via Perplexity
  // ═══════════════════════════════════════════════════════════

  app.post('/api/research/lookup', async (req: Request, res: Response) => {
    if (!services.researchLookup) return res.status(503).json({ error: 'Research lookup not initialized' });
    const { query, maxWords } = req.body || {};
    if (!query || typeof query !== 'string') return res.status(400).json({ error: 'query (string) required' });
    try {
      const result = await services.researchLookup.lookup(query, { maxWords });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Research lookup failed' });
    }
  });

  /**
   * Marketing-research presets. Each route maps to a structured preset
   * on ResearchLookupService that builds a tightly-scoped Perplexity
   * query + the safety guardrails (no fake contact info, prefer recent
   * sources, no fabricated names). Result is also persisted to
   * workspace/research/marketing/<topic>-<date>.md so the author can
   * come back to it.
   */
  async function runMarketingPreset(
    topic: string,
    fn: () => Promise<any>,
    res: Response,
  ): Promise<void> {
    try {
      const result = await fn();
      // Persist a markdown copy.
      try {
        const { writeFile, mkdir } = await import('fs/promises');
        const date = new Date().toISOString().split('T')[0];
        const dir = path.join(baseDir, 'workspace', 'research', 'marketing');
        await mkdir(dir, { recursive: true });
        const slug = topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60);
        const md = `# ${topic}\n\n` +
          `_Generated ${date} via ${result.provider}. ` +
          (result.hasVerifiedSources ? 'Sources verified via live web.' : '⚠️ No live web access — citations may be unreliable.') + '_\n\n' +
          result.answer + '\n';
        await writeFile(path.join(dir, `${slug}-${date}.md`), md, 'utf-8');
      } catch { /* persistence is non-fatal */ }
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Research failed' });
    }
  }

  app.post('/api/research/agents', async (req: Request, res: Response) => {
    if (!services.researchLookup) return res.status(503).json({ error: 'Research lookup not initialized' });
    const { genre, subgenre, titleAgePositioning } = req.body || {};
    if (!genre) return res.status(400).json({ error: 'genre (string) required' });
    return runMarketingPreset(`Literary agents — ${genre}${subgenre ? ' / ' + subgenre : ''}`,
      () => services.researchLookup.findAgents({ genre, subgenre, titleAgePositioning }), res);
  });

  app.post('/api/research/podcasts', async (req: Request, res: Response) => {
    if (!services.researchLookup) return res.status(503).json({ error: 'Research lookup not initialized' });
    const { genre, subgenre } = req.body || {};
    if (!genre) return res.status(400).json({ error: 'genre (string) required' });
    return runMarketingPreset(`Author podcasts — ${genre}${subgenre ? ' / ' + subgenre : ''}`,
      () => services.researchLookup.findAuthorPodcasts({ genre, subgenre }), res);
  });

  app.post('/api/research/reviewers', async (req: Request, res: Response) => {
    if (!services.researchLookup) return res.status(503).json({ error: 'Research lookup not initialized' });
    const { genre, subgenre, indieFriendly } = req.body || {};
    if (!genre) return res.status(400).json({ error: 'genre (string) required' });
    return runMarketingPreset(`Book reviewers — ${genre}${subgenre ? ' / ' + subgenre : ''}`,
      () => services.researchLookup.findReviewers({ genre, subgenre, indieFriendly }), res);
  });

  app.post('/api/research/newsletters', async (req: Request, res: Response) => {
    if (!services.researchLookup) return res.status(503).json({ error: 'Research lookup not initialized' });
    const { genre, subgenre } = req.body || {};
    if (!genre) return res.status(400).json({ error: 'genre (string) required' });
    return runMarketingPreset(`Newsletters — ${genre}${subgenre ? ' / ' + subgenre : ''}`,
      () => services.researchLookup.findNewsletters({ genre, subgenre }), res);
  });

  app.post('/api/research/comp-authors', async (req: Request, res: Response) => {
    if (!services.researchLookup) return res.status(503).json({ error: 'Research lookup not initialized' });
    const { genre, subgenre, tone } = req.body || {};
    if (!genre) return res.status(400).json({ error: 'genre (string) required' });
    return runMarketingPreset(`Comp authors — ${genre}${subgenre ? ' / ' + subgenre : ''}`,
      () => services.researchLookup.findCompAuthors({ genre, subgenre, tone }), res);
  });

  // ═══════════════════════════════════════════════════════════
  // Video Research — yt-dlp + transcript + AI notes
  // ═══════════════════════════════════════════════════════════

  app.get('/api/video/doctor', async (_req: Request, res: Response) => {
    if (!services.videoResearch) return res.status(503).json({ error: 'Video research not initialized' });
    res.json(await services.videoResearch.doctor());
  });

  app.post('/api/video/extract', async (req: Request, res: Response) => {
    if (!services.videoResearch) return res.status(503).json({ error: 'Video research not initialized' });
    const { url, topic } = req.body || {};
    if (!url || typeof url !== 'string') return res.status(400).json({ error: 'url (string) required' });
    if (!topic || typeof topic !== 'string') return res.status(400).json({ error: 'topic (string) required — what you\'re researching' });
    try {
      const result = await services.videoResearch.extract(url, topic);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Video extraction failed' });
    }
  });

  // ═══════════════════════════════════════════════════════════
  // Story Structures (smart-recommend, not forced)
  // ═══════════════════════════════════════════════════════════

  app.get('/api/structures', (_req: Request, res: Response) => {
    if (!services.storyStructures) return res.status(503).json({ error: 'Not initialized' });
    res.json({ structures: services.storyStructures.list() });
  });

  app.post('/api/structures/recommend', (req: Request, res: Response) => {
    if (!services.storyStructures) return res.status(503).json({ error: 'Not initialized' });
    const { genre, subgenre, description } = req.body || {};
    if (!genre) return res.status(400).json({ error: 'genre required' });
    res.json(services.storyStructures.recommend({ genre, subgenre, description }));
  });

  app.post('/api/structures/check-outline', (req: Request, res: Response) => {
    if (!services.storyStructures) return res.status(503).json({ error: 'Not initialized' });
    const { outline, structureId } = req.body || {};
    if (!Array.isArray(outline) || outline.some((c: any) => typeof c !== 'string')) {
      return res.status(400).json({ error: 'outline must be array of chapter summary strings' });
    }
    if (!structureId) return res.status(400).json({ error: 'structureId required' });
    const report = services.storyStructures.checkOutline(outline, structureId);
    if (!report) return res.status(404).json({ error: 'Unknown structureId' });
    res.json(report);
  });

  /**
   * Combined endpoint: from a project's outline, get recommendations AND
   * (optionally) run an outline check against the project's chosen structure.
   */
  app.post('/api/projects/:id/structure-check', async (req: Request, res: Response) => {
    if (!services.storyStructures) return res.status(503).json({ error: 'Not initialized' });
    const engine = gateway.getProjectEngine?.();
    const project = engine?.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    // Pull outline summaries from the project's completed outline-phase steps.
    const outlineSteps = project.steps.filter((s: any) =>
      (s.phase === 'outline' || s.skill === 'outline') && s.status === 'completed' && s.result);
    const outline: string[] = outlineSteps.length > 0
      ? outlineSteps.flatMap((s: any) => {
          // Try to split by chapter-N headings — fall back to one entry per step.
          const chunks = String(s.result).split(/\n##\s+(?:Chapter\s+)?\d+/i);
          return chunks.length > 1 ? chunks.slice(1).map(c => c.trim()) : [String(s.result)];
        })
      : (req.body?.outline || []);

    const genre = (project.context?.genre as string) || req.body?.genre || 'fiction';
    const subgenre = (project.context?.subgenre as string) || req.body?.subgenre;
    const description = project.description || '';

    const recommendation = services.storyStructures.recommend({ genre, subgenre, description });
    const chosenId = req.body?.structureId
      || (project.context?.structureId as string)
      || recommendation.recommended[0]?.structureId;

    let outlineCheck = null;
    if (chosenId && outline.length > 0) {
      outlineCheck = services.storyStructures.checkOutline(outline, chosenId);
    }

    res.json({ recommendation, chosenStructureId: chosenId, outlineCheck, outlineUsed: outline.length });
  });

  // ═══════════════════════════════════════════════════════════
  // Plot Promises (Sanderson-style promises + payoffs)
  // ═══════════════════════════════════════════════════════════

  app.get('/api/projects/:id/plot-promises', async (req: Request, res: Response) => {
    if (!services.plotPromises) return res.status(503).json({ error: 'Not initialized' });
    res.json(await services.plotPromises.getPromises(req.params.id));
  });

  app.post('/api/projects/:id/plot-promises/extract', async (req: Request, res: Response) => {
    if (!services.plotPromises) return res.status(503).json({ error: 'Not initialized' });
    const engine = gateway.getProjectEngine?.();
    const project = engine?.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    // Default: extract from chapters 1-3 if completed; allow override via body.openingText
    let openingText = req.body?.openingText as string | undefined;
    if (!openingText) {
      const writingSteps = project.steps
        .filter((s: any) => s.skill === 'write' && s.status === 'completed' && s.result)
        .slice(0, 3);
      openingText = writingSteps.map((s: any) => String(s.result)).join('\n\n---\n\n');
    }
    if (!openingText || openingText.length < 500) {
      return res.status(400).json({
        error: 'No opening chapter content found. Complete the first 1-3 chapters first, OR pass `openingText` in the body.',
      });
    }

    try {
      const result = await services.plotPromises.extractFromOpening({
        projectId: req.params.id,
        openingChapterText: openingText,
        aiComplete: (r: any) => services.aiRouter.complete(r),
        aiSelectProvider: (taskType: string) => services.aiRouter.selectProvider(taskType),
        merge: req.body?.merge !== false,
      });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Extraction failed' });
    }
  });

  app.patch('/api/projects/:id/plot-promises/:promiseId', async (req: Request, res: Response) => {
    if (!services.plotPromises) return res.status(503).json({ error: 'Not initialized' });
    const updated = await services.plotPromises.updatePromise(req.params.id, req.params.promiseId, req.body || {});
    if (!updated) return res.status(404).json({ error: 'Promise not found' });
    res.json(updated);
  });

  app.delete('/api/projects/:id/plot-promises/:promiseId', async (req: Request, res: Response) => {
    if (!services.plotPromises) return res.status(503).json({ error: 'Not initialized' });
    const removed = await services.plotPromises.deletePromise(req.params.id, req.params.promiseId);
    res.json({ success: removed });
  });

  app.post('/api/projects/:id/plot-promises', async (req: Request, res: Response) => {
    if (!services.plotPromises) return res.status(503).json({ error: 'Not initialized' });
    try {
      const promise = await services.plotPromises.addPromise(req.params.id, {
        title: req.body.title,
        description: req.body.description,
        category: req.body.category || 'other',
        introducedAtChapter: req.body.introducedAtChapter || 1,
        confidence: req.body.confidence ?? 1,
        status: req.body.status || 'open',
        authorNotes: req.body.authorNotes || '',
        authorConfirmed: true,
      });
      res.json(promise);
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Add failed' });
    }
  });

  app.get('/api/projects/:id/plot-promises/audit', async (req: Request, res: Response) => {
    if (!services.plotPromises) return res.status(503).json({ error: 'Not initialized' });
    const engine = gateway.getProjectEngine?.();
    const project = engine?.getProject(req.params.id);
    const progressPct = project?.progress ?? Number(req.query.progress) ?? 100;
    const riskThreshold = Number(req.query.riskThreshold) || 80;
    res.json(await services.plotPromises.audit(req.params.id, progressPct, riskThreshold));
  });

  // ─── Browser Doctor ───
  // Read-only probe inspired by OpenClaw's `browser doctor` command. Reports
  // whether BookClaw can plan browser actions for each major author platform.
  // Does NOT navigate or click anything — purely descriptive.
  app.get('/api/browser/doctor', (_req: Request, res: Response) => {
    const planners = {
      kdp: {
        planner: !!services.launchOrchestrator,
        description: 'Amazon KDP — pre-order setup, launch-day publish, price pulse',
        confirmationGated: true,
        notes: 'KDP automation requires a Claude-in-Chrome MCP session in the user\'s authenticated browser. BookClaw produces the plan; the MCP executes after explicit approval.',
      },
      amsAds: {
        planner: !!services.amsAds,
        description: 'Amazon Advertising — campaign creation, bid optimization',
        confirmationGated: true,
        notes: 'Bid changes capped at 2x per confirmation. Daily spend ceilings hard-enforced.',
      },
      bookbub: {
        planner: !!services.bookbub,
        description: 'BookBub Featured Deal — submission draft + rationale',
        confirmationGated: true,
        notes: 'BookClaw never fabricates editorial review quotes. Review snippets must be flagged as verified before submission.',
      },
      website: {
        planner: !!services.websiteBuilder,
        description: 'Author website — static site generation + deploy guidance',
        confirmationGated: false,
        notes: 'Website Builder writes files locally; deploy is user-driven.',
      },
      translation: {
        planner: !!services.translationPipeline,
        description: 'Foreign-rights pipeline — DeepL + Claude post-edit',
        confirmationGated: true,
        notes: 'France-bound translations require AI-disclosure acknowledgment.',
      },
    };
    const all = Object.values(planners);
    const ready = all.filter(p => p.planner).length;
    res.json({
      version: 'browser-doctor/v1',
      summary: `${ready} of ${all.length} planners ready. BookClaw is planner-first; an external browser MCP (e.g., Claude in Chrome) executes approved actions.`,
      planners,
      gateStatus: services.confirmationGate
        ? `Confirmation gate active. ${services.confirmationGate.list({ status: 'pending' }).length} pending request(s).`
        : 'Confirmation gate NOT initialized — refusing to execute browser actions.',
      executor: {
        kind: 'external-mcp',
        recommended: 'Claude in Chrome',
        details: 'BookClaw does not bundle a browser driver. Connect Claude-in-Chrome MCP (or your preferred browser-automation MCP) and it will pick up approved confirmations.',
      },
      safetyRails: [
        'Every irreversible action passes through ConfirmationGateService',
        '24-hour expiry on unreviewed confirmations',
        'Pre-auth claims in observed content are auto-rejected',
        'AI-disclosure acknowledgment required before publish/upload',
        'Spend caps hard-enforced on financial actions',
        'Passwords never stored — sessions reuse the user\'s authenticated browser',
      ],
    });
  });

  app.get('/api/confirmations', (req: Request, res: Response) => {
    const gate = services.confirmationGate;
    if (!gate) return res.json({ requests: [], disclaimer: '' });
    const status = req.query.status as any;
    const service = req.query.service as any;
    addWaveDisclaimer(res);
    res.json({
      requests: gate.list({ status, service }),
      disclaimer: services.disclosures?.universalDisclaimer() || '',
    });
  });

  app.get('/api/confirmations/:id', (req: Request, res: Response) => {
    const gate = services.confirmationGate;
    if (!gate) return res.status(503).json({ error: 'Confirmation gate not initialized' });
    const req_ = gate.get(req.params.id);
    if (!req_) return res.status(404).json({ error: 'Not found' });
    addWaveDisclaimer(res);
    res.json({ request: req_ });
  });

  app.post('/api/confirmations/:id/approve', async (req: Request, res: Response) => {
    const gate = services.confirmationGate;
    if (!gate) return res.status(503).json({ error: 'Confirmation gate not initialized' });
    try {
      const result = await gate.approve(req.params.id);
      if (!result) return res.status(404).json({ error: 'Not found' });
      addWaveDisclaimer(res);
      res.json({ request: result });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Approval failed' });
    }
  });

  app.post('/api/confirmations/:id/reject', async (req: Request, res: Response) => {
    const gate = services.confirmationGate;
    if (!gate) return res.status(503).json({ error: 'Confirmation gate not initialized' });
    try {
      const result = await gate.reject(req.params.id, 'user', req.body?.reason);
      if (!result) return res.status(404).json({ error: 'Not found' });
      res.json({ request: result });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Rejection failed' });
    }
  });

  app.post('/api/confirmations/:id/outcome', async (req: Request, res: Response) => {
    const gate = services.confirmationGate;
    if (!gate) return res.status(503).json({ error: 'Confirmation gate not initialized' });
    const { success, message, externalId, metadata } = req.body || {};
    if (typeof success !== 'boolean' || !message) {
      return res.status(400).json({ error: 'success (boolean) and message (string) required' });
    }
    try {
      const result = await gate.recordOutcome(req.params.id, {
        success, message, externalId, executedAt: new Date().toISOString(), metadata,
      });
      if (!result) return res.status(404).json({ error: 'Not found' });
      res.json({ request: result });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Outcome recording failed' });
    }
  });

  // ── Disclosures ──

  app.get('/api/disclosures/universal', (_req: Request, res: Response) => {
    const d = services.disclosures;
    if (!d) return res.status(503).json({ error: 'Disclosures not initialized' });
    res.json({ text: d.universalDisclaimer() });
  });

  app.post('/api/disclosures/check', (req: Request, res: Response) => {
    const d = services.disclosures;
    if (!d) return res.status(503).json({ error: 'Disclosures not initialized' });
    const { platform, scopes, acknowledgedScopes } = req.body || {};
    if (!platform || !Array.isArray(scopes)) {
      return res.status(400).json({ error: 'platform and scopes (array) required' });
    }
    const result = d.checkCompliance({
      platform, scopes,
      acknowledgedScopes: Array.isArray(acknowledgedScopes) ? acknowledgedScopes : [],
    });
    res.json(result);
  });

  // ── Launch Orchestrator ──

  app.get('/api/launches', (_req: Request, res: Response) => {
    const l = services.launchOrchestrator;
    if (!l) return res.json({ launches: [] });
    addWaveDisclaimer(res);
    res.json({ launches: l.listLaunches() });
  });

  app.post('/api/launches', async (req: Request, res: Response) => {
    const l = services.launchOrchestrator;
    if (!l) return res.status(503).json({ error: 'Launch orchestrator not initialized' });
    const { projectId, bookTitle, authorName, targetReleaseDate, metadata } = req.body || {};
    if (!projectId || !bookTitle || !authorName || !targetReleaseDate) {
      return res.status(400).json({ error: 'projectId, bookTitle, authorName, targetReleaseDate required' });
    }
    const launch = await l.createLaunch({ projectId, bookTitle, authorName, targetReleaseDate, metadata });
    addWaveDisclaimer(res);
    res.json({ launch });
  });

  app.get('/api/launches/:id', (req: Request, res: Response) => {
    const l = services.launchOrchestrator;
    if (!l) return res.status(503).json({ error: 'Launch orchestrator not initialized' });
    const launch = l.getLaunch(req.params.id);
    if (!launch) return res.status(404).json({ error: 'Not found' });
    res.json({ launch, plan: l.buildPlan(launch) });
  });

  app.patch('/api/launches/:id', async (req: Request, res: Response) => {
    const l = services.launchOrchestrator;
    if (!l) return res.status(503).json({ error: 'Launch orchestrator not initialized' });
    const result = await l.updateMetadata(req.params.id, req.body?.metadata || {});
    if (!result) return res.status(404).json({ error: 'Not found' });
    res.json({ launch: result });
  });

  app.post('/api/launches/:id/acknowledge-disclosures', async (req: Request, res: Response) => {
    const l = services.launchOrchestrator;
    if (!l) return res.status(503).json({ error: 'Launch orchestrator not initialized' });
    const { scopes } = req.body || {};
    if (!Array.isArray(scopes)) return res.status(400).json({ error: 'scopes (array) required' });
    const result = await l.acknowledgeDisclosures(req.params.id, scopes);
    if (!result) return res.status(404).json({ error: 'Not found' });
    res.json({ launch: result });
  });

  app.post('/api/launches/:id/propose-step', async (req: Request, res: Response) => {
    const l = services.launchOrchestrator;
    if (!l) return res.status(503).json({ error: 'Launch orchestrator not initialized' });
    const { phase } = req.body || {};
    if (!phase) return res.status(400).json({ error: 'phase required' });
    try {
      const result = await l.proposeStep(req.params.id, phase);
      addWaveDisclaimer(res);
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Proposal failed' });
    }
  });

  app.delete('/api/launches/:id', async (req: Request, res: Response) => {
    const l = services.launchOrchestrator;
    if (!l) return res.status(503).json({ error: 'Launch orchestrator not initialized' });
    const removed = await l.deleteLaunch(req.params.id);
    res.json({ success: removed });
  });

  // ── AMS Ads ──

  app.post('/api/ams/propose-campaigns', (req: Request, res: Response) => {
    const ams = services.amsAds;
    if (!ams) return res.status(503).json({ error: 'AMS service not initialized' });
    const { bookTitle, genre, keywords, dailyBudgetCeilingUSD } = req.body || {};
    if (!bookTitle || !genre || !Array.isArray(keywords) || typeof dailyBudgetCeilingUSD !== 'number') {
      return res.status(400).json({ error: 'bookTitle, genre, keywords (array), dailyBudgetCeilingUSD (number) required' });
    }
    addWaveDisclaimer(res);
    res.json({ campaigns: ams.proposeCampaigns({ bookTitle, genre, keywords, dailyBudgetCeilingUSD }) });
  });

  app.post('/api/ams/optimize', (req: Request, res: Response) => {
    const ams = services.amsAds;
    if (!ams) return res.status(503).json({ error: 'AMS service not initialized' });
    const { performance, acosTargetPct, dailyBudgetCeilingUSD, currentDailySpendUSD } = req.body || {};
    if (!Array.isArray(performance) || typeof acosTargetPct !== 'number'
        || typeof dailyBudgetCeilingUSD !== 'number' || typeof currentDailySpendUSD !== 'number') {
      return res.status(400).json({ error: 'performance (array), acosTargetPct, dailyBudgetCeilingUSD, currentDailySpendUSD required' });
    }
    addWaveDisclaimer(res);
    res.json(ams.optimize({ performance, acosTargetPct, dailyBudgetCeilingUSD, currentDailySpendUSD }));
  });

  // ── BookBub ──

  app.post('/api/bookbub/draft', (req: Request, res: Response) => {
    const bb = services.bookbub;
    if (!bb) return res.status(503).json({ error: 'BookBub service not initialized' });
    const { title, authorName, genre, amazonBlurb } = req.body || {};
    if (!title || !authorName || !genre || !amazonBlurb) {
      return res.status(400).json({ error: 'title, authorName, genre, amazonBlurb required' });
    }
    addWaveDisclaimer(res);
    res.json({ draft: bb.buildDraft(req.body) });
  });

  // ── Release Calendar ──

  app.get('/api/calendar', (req: Request, res: Response) => {
    const c = services.releaseCalendar;
    if (!c) return res.json({ events: [] });
    res.json({
      events: c.list({
        projectId: req.query.projectId as any,
        category: req.query.category as any,
        from: req.query.from as any,
        to: req.query.to as any,
      }),
      atRisk: c.atRisk(),
    });
  });

  app.post('/api/calendar', async (req: Request, res: Response) => {
    const c = services.releaseCalendar;
    if (!c) return res.status(503).json({ error: 'Calendar not initialized' });
    try {
      const event = await c.createEvent(req.body);
      res.json({ event });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Create failed' });
    }
  });

  app.post('/api/calendar/price-pulse-plan', async (req: Request, res: Response) => {
    const c = services.releaseCalendar;
    if (!c) return res.status(503).json({ error: 'Calendar not initialized' });
    const { projectId, bookTitle, releaseDate, launchPrice, tailPrice } = req.body || {};
    if (!projectId || !bookTitle || !releaseDate) {
      return res.status(400).json({ error: 'projectId, bookTitle, releaseDate required' });
    }
    const events = c.buildPricePulsePlan({ projectId, bookTitle, releaseDate, launchPrice, tailPrice });
    for (const ev of events) await c.createEvent(ev);
    res.json({ events });
  });

  app.patch('/api/calendar/:id', async (req: Request, res: Response) => {
    const c = services.releaseCalendar;
    if (!c) return res.status(503).json({ error: 'Calendar not initialized' });
    const result = await c.updateEvent(req.params.id, req.body || {});
    if (!result) return res.status(404).json({ error: 'Not found' });
    res.json({ event: result });
  });

  app.delete('/api/calendar/:id', async (req: Request, res: Response) => {
    const c = services.releaseCalendar;
    if (!c) return res.status(503).json({ error: 'Calendar not initialized' });
    const removed = await c.removeEvent(req.params.id);
    res.json({ success: removed });
  });

  app.get('/api/calendar/export.ics', (req: Request, res: Response) => {
    const c = services.releaseCalendar;
    if (!c) return res.status(503).json({ error: 'Calendar not initialized' });
    const ics = c.exportICS({
      projectId: req.query.projectId as any,
      from: req.query.from as any,
      to: req.query.to as any,
    });
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="bookclaw-calendar.ics"');
    res.send(ics);
  });

  // ── Reader Intel ──

  app.post('/api/reader-intel/analyze', async (req: Request, res: Response) => {
    const ri = services.readerIntel;
    if (!ri) return res.status(503).json({ error: 'Reader intel not initialized' });
    const { reviews } = req.body || {};
    if (!Array.isArray(reviews)) return res.status(400).json({ error: 'reviews (array) required' });
    try {
      const sanitized = await ri.sanitize(reviews);
      const report = ri.analyze(sanitized);
      res.json({ report, sanitizedCount: sanitized.length });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Analysis failed' });
    }
  });

  // ── Translation Pipeline ──

  app.post('/api/translation/plan', (req: Request, res: Response) => {
    const tp = services.translationPipeline;
    if (!tp) return res.status(503).json({ error: 'Translation pipeline not initialized' });
    const { projectId, bookTitle, targetLangs, estimatedWordCount, sourceLang } = req.body || {};
    if (!projectId || !bookTitle || !Array.isArray(targetLangs) || typeof estimatedWordCount !== 'number') {
      return res.status(400).json({ error: 'projectId, bookTitle, targetLangs (array), estimatedWordCount (number) required' });
    }
    addWaveDisclaimer(res);
    res.json(tp.plan({ projectId, bookTitle, targetLangs, estimatedWordCount, sourceLang }));
  });

  app.post('/api/translation/propose', async (req: Request, res: Response) => {
    const tp = services.translationPipeline;
    if (!tp) return res.status(503).json({ error: 'Translation pipeline not initialized' });
    const { projectId, bookTitle, targetLang, estimatedWordCount, sampleText } = req.body || {};
    if (!projectId || !bookTitle || !targetLang || typeof estimatedWordCount !== 'number') {
      return res.status(400).json({ error: 'projectId, bookTitle, targetLang, estimatedWordCount required' });
    }
    try {
      const result = await tp.proposeTranslation({ projectId, bookTitle, targetLang, estimatedWordCount, sampleText });
      addWaveDisclaimer(res);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Proposal failed' });
    }
  });

  app.post('/api/translation/rights-pitch', (req: Request, res: Response) => {
    const tp = services.translationPipeline;
    if (!tp) return res.status(503).json({ error: 'Translation pipeline not initialized' });
    const { targetLang, bookTitle, authorName, genre, wordCountApprox, comps, marketingAngle } = req.body || {};
    if (!targetLang || !bookTitle || !authorName || !genre || typeof wordCountApprox !== 'number') {
      return res.status(400).json({ error: 'targetLang, bookTitle, authorName, genre, wordCountApprox required' });
    }
    res.json(tp.generateRightsPitch({ targetLang, bookTitle, authorName, genre, wordCountApprox, comps, marketingAngle }));
  });

  // ── Website Builder ──

  app.get('/api/websites', async (_req: Request, res: Response) => {
    const w = services.websiteBuilder;
    if (!w) return res.json({ sites: [] });
    const sites = await w.listSites();
    res.json({ sites });
  });

  app.post('/api/websites/build', async (req: Request, res: Response) => {
    const w = services.websiteBuilder;
    if (!w) return res.status(503).json({ error: 'Website builder not initialized' });
    const { config, books, blogPosts, aboutHTML, contactHTML } = req.body || {};
    if (!config || !config.slug || !config.siteName || !config.authorName || !config.baseUrl) {
      return res.status(400).json({ error: 'config with slug, siteName, authorName, baseUrl required' });
    }
    try {
      const result = await w.build({
        config,
        books: Array.isArray(books) ? books : [],
        blogPosts: Array.isArray(blogPosts) ? blogPosts : [],
        aboutHTML, contactHTML,
      });
      addWaveDisclaimer(res);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Build failed' });
    }
  });

}
