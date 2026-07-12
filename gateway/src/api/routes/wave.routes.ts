import { Application, Request, Response } from 'express';
import { makeGatherChapters } from './_shared.js';

/** Wave 2 (goals, series bible, craft critic, audiobook, style clone) and Wave 3 (autonomous career agent — all actions gated). */
export function mountWave(app: Application, gateway: any, baseDir: string): void {
  const services = gateway.getServices();
  const gatherChapters = makeGatherChapters(baseDir, (p) => services.books?.dataDirOf?.(p?.bookSlug) ?? services.books?.activeDataDir?.() ?? null);

  // ═══════════════════════════════════════════════════════════
  // Wave 2: Goals, Series Bible, Craft Critic, Audiobook, Style Clone
  // ═══════════════════════════════════════════════════════════

  // ── Author Goals ──

  app.get('/api/goals', (req: Request, res: Response) => {
    const goals = services.goals;
    if (!goals) return res.json({ goals: [] });
    const status = req.query.status as any;
    const type = req.query.type as any;
    const list = goals.listGoals({ status, type });
    const withProgress = list.map((g: any) => goals.computeProgress(g.id)).filter(Boolean);
    res.json({ goals: withProgress });
  });

  app.post('/api/goals', async (req: Request, res: Response) => {
    const goals = services.goals;
    if (!goals) return res.status(503).json({ error: 'Goals service not initialized' });
    const { type, title, description, target, unit, deadline, projectIds } = req.body || {};
    if (!type || !title || typeof target !== 'number' || !unit || !deadline) {
      return res.status(400).json({ error: 'type, title, target, unit, deadline required' });
    }
    try {
      const goal = await goals.createGoal({ type, title, description, target, unit, deadline, projectIds });
      res.json({ goal });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Create failed' });
    }
  });

  app.post('/api/goals/:id/progress', async (req: Request, res: Response) => {
    const goals = services.goals;
    if (!goals) return res.status(503).json({ error: 'Goals service not initialized' });
    const { current } = req.body || {};
    if (typeof current !== 'number') return res.status(400).json({ error: 'current (number) required' });
    const result = await goals.updateProgress(req.params.id, current, 'manual');
    if (!result) return res.status(404).json({ error: 'Goal not found' });
    res.json({ goal: result, progress: goals.computeProgress(req.params.id) });
  });

  app.post('/api/goals/:id/status', async (req: Request, res: Response) => {
    const goals = services.goals;
    if (!goals) return res.status(503).json({ error: 'Goals service not initialized' });
    const { status } = req.body || {};
    if (!['active', 'paused', 'completed', 'missed'].includes(status)) {
      return res.status(400).json({ error: 'status must be active|paused|completed|missed' });
    }
    const result = await goals.setStatus(req.params.id, status);
    if (!result) return res.status(404).json({ error: 'Goal not found' });
    res.json({ goal: result });
  });

  app.delete('/api/goals/:id', async (req: Request, res: Response) => {
    const goals = services.goals;
    if (!goals) return res.status(503).json({ error: 'Goals service not initialized' });
    const removed = await goals.removeGoal(req.params.id);
    if (!removed) return res.status(404).json({ error: 'Goal not found' });
    res.json({ success: true });
  });

  // ── Series ── moved to series.routes.ts (Series Phase A, book-centric).

  // ── Craft Critic ──

  app.post('/api/projects/:id/craft-critique', async (req: Request, res: Response) => {
    const critic = services.craftCritic;
    if (!critic) return res.status(503).json({ error: 'Craft critic not initialized' });
    const engine = gateway.getProjectEngine?.();
    const project = engine?.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const chapters = await gatherChapters(project);
    if (chapters.length === 0) return res.status(400).json({ error: 'No completed chapters found.' });
    try {
      const report = critic.analyze(project.id, chapters);
      res.json(report);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Critique failed' });
    }
  });

  // Learn-from-experience (AuthorAgent #7): manually trigger the lesson-distil
  // cycle for a project (the same cycle the completion hook runs automatically).
  app.post('/api/projects/:id/learn', async (req: Request, res: Response) => {
    const learning = services.learning;
    if (!learning) return res.status(503).json({ error: 'Learning service not initialized' });
    const engine = gateway.getProjectEngine?.();
    const project = engine?.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const aiComplete = services.aiRouter ? (r: any) => services.aiRouter.complete(r) : null;
    const aiSelectProvider = services.aiRouter ? (t: string) => services.aiRouter.selectProvider(t) : null;
    try {
      const outcome = await learning.learnFromProject(
        project, gatherChapters, services.craftCritic, services.dialogueAuditor, aiComplete, aiSelectProvider,
      );
      res.json(outcome);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Learning cycle failed' });
    }
  });

  // Character motivation critique (AuthorAgent #12): flag chapter lines that
  // contradict a character's established motivation/arc.
  app.post('/api/projects/:id/motivation-critique', async (req: Request, res: Response) => {
    const agent = services.characterMotivation;
    const ctxEngine = services.contextEngine;
    if (!agent || !ctxEngine) return res.status(503).json({ error: 'Character motivation check not initialized' });
    if (!services.aiRouter) return res.status(503).json({ error: 'AI router not available — a provider is required.' });
    const engine = gateway.getProjectEngine?.();
    const project = engine?.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const chapterText = typeof req.body?.chapterText === 'string' ? req.body.chapterText : '';
    if (!chapterText.trim()) return res.status(400).json({ error: 'chapterText (string) required' });
    const chapterId = typeof req.body?.chapterId === 'string' ? req.body.chapterId : undefined;
    const characters = Array.isArray(req.body?.characters) ? req.body.characters.filter((c: any) => typeof c === 'string') : undefined;
    try {
      const ctx = await ctxEngine.loadContext(req.params.id);
      const report = await agent.critiqueMotivation(
        { projectId: req.params.id, chapterText, chapterId, characters },
        (r: any) => services.aiRouter.complete(r),
        (t: string) => services.aiRouter.selectProvider(t),
        ctx.entities ?? [],
        ctx.summaries ?? [],
      );
      res.json(report);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Motivation critique failed' });
    }
  });

  // Unified revision report (AuthorAgent #17): aggregate craft/dialogue/continuity/
  // voice/mechanical findings into one severity-ranked report. No new AI for
  // continuity (reads persisted per-step flags); voice needs the entity-DB name list.
  app.post('/api/projects/:id/revision-report', async (req: Request, res: Response) => {
    const orchestrator = services.revisionOrchestrator;
    if (!orchestrator) return res.status(503).json({ error: 'Revision orchestrator not initialized' });
    const engine = gateway.getProjectEngine?.();
    const project = engine?.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const chapters = await gatherChapters(project);
    if (chapters.length === 0) return res.status(400).json({ error: 'No completed chapters found.' });
    // Attach each chapter's already-computed continuity flags from its write step.
    const flagsByStep = new Map<string, any>((project.steps ?? []).map((s: any) => [s.id, s.continuityFlags]));
    const enriched = chapters.map((c) => ({ ...c, continuityFlags: flagsByStep.get(c.id) }));
    // Resolve the character-name allowlist for the voice-drift pass (fail-soft).
    let characterNames: string[] = [];
    try {
      const ctx = await services.contextEngine?.loadContext(req.params.id);
      characterNames = (ctx?.entities ?? []).filter((e: any) => e.type === 'character').map((e: any) => e.name);
    } catch { /* voice pass degrades to no attribution */ }
    const passes = Array.isArray(req.body?.passes) ? req.body.passes.filter((p: any) => typeof p === 'string') : undefined;
    try {
      const report = await orchestrator.buildReport({ projectId: project.id, chapters: enriched, passes, characterNames });
      res.json(report);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Revision report failed' });
    }
  });

  // ── Audiobook Prep ──

  app.post('/api/projects/:id/audiobook/cleanup', async (req: Request, res: Response) => {
    const prep = services.audiobookPrep;
    if (!prep) return res.status(503).json({ error: 'Audiobook prep not initialized' });
    const engine = gateway.getProjectEngine?.();
    const project = engine?.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const chapters = await gatherChapters(project);
    if (chapters.length === 0) return res.status(400).json({ error: 'No completed chapters found.' });

    const combined = chapters.map(c => `# Chapter ${c.number}: ${c.title}\n\n${c.text}`).join('\n\n');
    const result = prep.cleanupScript(combined);
    res.json(result);
  });

  app.post('/api/projects/:id/audiobook/pronunciation', async (req: Request, res: Response) => {
    const prep = services.audiobookPrep;
    const ctxEngine = services.contextEngine;
    if (!prep || !ctxEngine) return res.status(503).json({ error: 'Services not initialized' });
    const engine = gateway.getProjectEngine?.();
    const project = engine?.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const chapters = await gatherChapters(project);
    const combined = chapters.map(c => c.text).join('\n\n');
    try {
      const ctx = await ctxEngine.loadContext(req.params.id);
      const dict = prep.buildPronunciationDictionary(req.params.id, ctx.entities, combined);
      res.json({ dictionary: dict });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Pronunciation extraction failed' });
    }
  });

  app.post('/api/projects/:id/audiobook/ssml', async (req: Request, res: Response) => {
    const prep = services.audiobookPrep;
    const ctxEngine = services.contextEngine;
    if (!prep || !ctxEngine) return res.status(503).json({ error: 'Services not initialized' });
    const engine = gateway.getProjectEngine?.();
    const project = engine?.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const aiDisclosed = !!(project as any).aiNarrationDisclosed || !!req.body?.aiNarrationDisclosed;
    const chapters = await gatherChapters(project);
    if (chapters.length === 0) return res.status(400).json({ error: 'No completed chapters found.' });
    try {
      const ctx = await ctxEngine.loadContext(req.params.id);
      const combined = chapters.map(c => c.text).join('\n\n');
      const dict = prep.buildPronunciationDictionary(req.params.id, ctx.entities, combined);

      // Apply cleanup then build SSML.
      const cleanedChapters = chapters.map(c => {
        const { cleanedText } = prep.cleanupScript(c.text);
        return { number: c.number, title: c.title, text: cleanedText };
      });

      const result = prep.buildSSML(cleanedChapters, dict, aiDisclosed);
      res.json({ ...result, disclosureRequired: !aiDisclosed, disclosureIncluded: aiDisclosed });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'SSML build failed' });
    }
  });

  // ── Multi-voice audiobook attribution ──

  /**
   * POST /api/projects/:id/audiobook/attribute
   *   Body: { chapterNumber?, voiceMap?, customVoices? }
   *   - chapterNumber: which chapter to attribute (default = all)
   *   - voiceMap: optional explicit map { narratorVoice, characterVoices, defaultCharacterVoice }
   *   - customVoices: optional partial map merged into auto-assigned voices
   *
   * Returns per-chapter MultiVoiceScript with attributed segments. The
   * dashboard can then call /api/audio/generate per segment using the
   * resolved voiceId.
   */
  app.post('/api/projects/:id/audiobook/attribute', async (req: Request, res: Response) => {
    const prep = services.audiobookPrep;
    const ctxEngine = services.contextEngine;
    const tts = services.tts;
    if (!prep || !ctxEngine || !tts) return res.status(503).json({ error: 'Required services not initialized' });
    const engine = gateway.getProjectEngine?.();
    const project = engine?.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    try {
      const ctx = await ctxEngine.loadContext(req.params.id);
      const characterNames = ctx.entities
        .filter((e: any) => e.type === 'character')
        .map((e: any) => e.name);

      // Build voice map: caller-provided > auto-distributed defaults.
      const presetIds = tts.listPresets().map((p: any) => p.voice);
      const narratorVoice = req.body?.voiceMap?.narratorVoice || tts.getActiveVoice();
      const voiceMap = req.body?.voiceMap || prep.buildDefaultVoiceMap({
        characterNames,
        presetVoiceIds: presetIds,
        narratorVoice,
        customVoices: req.body?.customVoices || {},
      });

      const chapters = await gatherChapters(project);
      if (chapters.length === 0) return res.status(400).json({ error: 'No completed chapters found.' });

      const targetCh = req.body?.chapterNumber;
      const filtered = typeof targetCh === 'number' ? chapters.filter((c: any) => c.number === targetCh) : chapters;

      const scripts = filtered.map((c: any) =>
        prep.attributeMultiVoice({
          chapterNumber: c.number,
          title: c.title,
          text: c.text,
          characterNames,
          voiceMap,
        })
      );

      res.json({
        voiceMap,
        scripts,
        characters: characterNames,
        unmappedSpeakers: Array.from(new Set(scripts.flatMap((s: any) => s.unmappedSpeakers))).sort(),
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Attribution failed' });
    }
  });

  // ── Style Clone ──

  app.post('/api/style-clone/analyze', (req: Request, res: Response) => {
    const sc = services.styleClone;
    if (!sc) return res.status(503).json({ error: 'Style clone not initialized' });
    const { text, source } = req.body || {};
    if (!text || typeof text !== 'string') return res.status(400).json({ error: 'text (string) required' });
    try {
      const profile = sc.analyze(text, source || 'manual-paste');
      res.json({ profile });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Analysis failed' });
    }
  });

  app.post('/api/projects/:id/style-clone', async (req: Request, res: Response) => {
    const sc = services.styleClone;
    if (!sc) return res.status(503).json({ error: 'Style clone not initialized' });
    const engine = gateway.getProjectEngine?.();
    const project = engine?.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const chapters = await gatherChapters(project);
    if (chapters.length === 0) return res.status(400).json({ error: 'No completed chapters found.' });
    const combined = chapters.map(c => c.text).join('\n\n');
    try {
      const profile = sc.analyze(combined, `project:${project.id}`);
      res.json({ profile });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Analysis failed' });
    }
  });

  // ═══════════════════════════════════════════════════════════
  // Wave 3 — Autonomous Career Agent (ALL ACTIONS ARE GATED)
  // ═══════════════════════════════════════════════════════════

  // Universal disclaimer returned with every Wave 3 response header.

  // ── Confirmation Gate ──

}
