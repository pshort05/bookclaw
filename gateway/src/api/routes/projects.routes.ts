import { Application, Request, Response } from 'express';
import { generateDocxBuffer } from '../../services/docx-export.js';
import { stepRouting, applyBookModelConfig, resolveIntimacyRouting, resolveGroundingBlock, resolveAnalyzeApplyBlock, resolveEnsemblePremise, runBetaReaderGate, makeGatherChapters } from './_shared.js';
import { generationMeta } from '../../services/activity-meta.js';
import { isHumanReviewStep, openReviewGate, maybeOpenCadenceGate } from '../../services/human-review.js';
import { maybeRunCouncilStep } from '../../services/council-gate.js';
import { buildCouncilService } from '../../services/council.js';
import { checkBudgetPause, applyBudgetPause } from '../../services/pipeline/budget-gate.js';
import { acquireDrive, releaseDrive, tryAcquireDriveNow } from '../../services/pipeline/scheduler.js';
import { stripMetaCommentary } from '../../services/strip-meta.js';
import { buildBookCanonBlock } from '../../services/book-canon.js';
import { applyStructureRail } from '../../services/format-guide.js';
import { countWords } from '../../util/wordcount.js';
import { classifyStepResponse, runWordTargetContinuation, continuationAnchor } from '../../util/generation-step.js';
import { runExecutableSkillStep, passiveSkillBlock } from '../../services/skill-runner.js';
import { isValidModelId } from '../../ai/model-id.js';
import { chapterSummaryTarget } from '../../util/chapter-summary.js';
import { runChapterContextExtraction } from '../../util/chapter-context-extraction.js';
import { bannedContentCheck, operationalDetailGuard } from '../../services/casting/safety-floor.js';
import { isStepRole, isProseStep } from '../../services/casting/roles.js';
import { looksLikeRefusal } from '../../services/casting/heat.js';
import { buildCanonBlock } from '../../services/consistency/canon-inject.js';
import { checkChapter } from '../../services/consistency/continuity-check.js';

/**
 * Safety floor (Flagship Plan 2, Task 4/7 — H1 fix): true for the generative
 * prose steps the safety floor must cover on EVERY draft, independent of the
 * book's contentCeiling. Intimacy ROUTING (spiceRoute/template/escalation)
 * stays gated behind `intimacy.active`; the floor itself is not.
 */
function isSafetyFloorStep(step: any): boolean {
  const role = isStepRole(step?.role) ? step.role : undefined;
  return role === 'draft' || role === 'intimacy';
}

/**
 * Bug #26: select ONLY a project's own output files from a directory that may be
 * shared with other projects — a per-book `data/` dir, or the legacy
 * `workspace/projects/<title-slug>` dir that two same-titled no-book projects
 * collide on. Step files are named `${step.id}-<label>.md` and step ids are
 * `${project.id}-step-N`, so every file this project wrote starts with
 * `${project.id}-`. Filtering by that prefix means a `files=true` delete removes
 * only this project's files and never a co-located project's.
 */
export function projectOwnedFiles(entries: string[], projectId: string): string[] {
  return entries.filter((f) => f.startsWith(`${projectId}-`));
}

/**
 * Project Engine endpoints: templates, project + pipeline creation, start/
 * auto-execute (with the step-message + manuscript helpers), retry/restart/
 * resume/pause, files listing/download, DOCX export, compile, provider override.
 */
export function mountProjects(app: Application, gateway: any, baseDir: string): void {
  const services = gateway.getServices();
  // Flagship Plan 4 (Task 3): shared chapter-gathering helper for the
  // beta-reader pre-format gate (mirrors export.routes.ts's manual endpoint).
  const gatherChapters = makeGatherChapters(baseDir, (p) => services.books?.dataDirOf?.(p?.bookSlug) ?? services.books?.activeDataDir?.() ?? null);

  // ═══════════════════════════════════════════════════════════
  // Project Engine (autonomous project-based task planning)
  // ═══════════════════════════════════════════════════════════

  app.get('/api/projects/templates', async (_req: Request, res: Response) => {
    const engine = gateway.getProjectEngine?.();
    if (!engine) {
      return res.status(503).json({ error: 'Project engine not initialized' });
    }
    // Merge built-in templates with custom templates
    const builtIn = engine.getTemplates();
    const { join: j } = await import('path');
    const { readFile: rf } = await import('fs/promises');
    const { existsSync: ex } = await import('fs');
    const customPath = j(baseDir, 'workspace', '.config', 'custom-project-templates.json');
    let custom: any[] = [];
    if (ex(customPath)) {
      try { custom = JSON.parse(await rf(customPath, 'utf-8')); } catch { /* ok */ }
    }
    const customMapped = custom.map((t: any) => ({
      ...t, label: t.title, stepCount: 0, custom: true,
    }));
    res.json({ templates: [...builtIn, ...customMapped] });
  });

  // Save a custom project template
  app.post('/api/projects/templates', async (req: Request, res: Response) => {
    const { title, description, type } = req.body;
    if (!title || !description) {
      return res.status(400).json({ error: 'title and description required' });
    }
    const { join: j } = await import('path');
    const { readFile: rf, writeFile: wf, mkdir: mkd } = await import('fs/promises');
    const { existsSync: ex } = await import('fs');
    const { randomBytes } = await import('crypto');
    const configDir = j(baseDir, 'workspace', '.config');
    await mkd(configDir, { recursive: true });
    const customPath = j(configDir, 'custom-project-templates.json');
    let custom: any[] = [];
    if (ex(customPath)) {
      try { custom = JSON.parse(await rf(customPath, 'utf-8')); } catch { /* ok */ }
    }
    custom.push({ id: randomBytes(6).toString('hex'), title, description, type: type || 'general', createdAt: new Date().toISOString() });
    // Bug #25: guard the write — an FS error here was an unhandled rejection that
    // never responded, hanging the client. Respond 500 instead.
    try {
      await wf(customPath, JSON.stringify(custom, null, 2));
    } catch (err: any) {
      return res.status(500).json({ error: 'Failed to save template: ' + (err?.message || String(err)) });
    }
    res.json({ success: true });
  });

  // Delete a custom project template
  app.delete('/api/projects/templates/:id', async (req: Request, res: Response) => {
    const { join: j } = await import('path');
    const { readFile: rf, writeFile: wf } = await import('fs/promises');
    const { existsSync: ex } = await import('fs');
    const customPath = j(baseDir, 'workspace', '.config', 'custom-project-templates.json');
    if (!ex(customPath)) {
      return res.json({ success: false, error: 'No custom templates' });
    }
    let custom: any[] = [];
    try { custom = JSON.parse(await rf(customPath, 'utf-8')); } catch { /* ok */ }
    custom = custom.filter((t: any) => t.id !== req.params.id);
    // Bug #25: guard the write (see POST handler) so an FS error responds 500
    // instead of hanging the client on an unhandled rejection.
    try {
      await wf(customPath, JSON.stringify(custom, null, 2));
    } catch (err: any) {
      return res.status(500).json({ error: 'Failed to delete template: ' + (err?.message || String(err)) });
    }
    res.json({ success: true });
  });

  // Create a new project — supports dynamic AI planning
  app.post('/api/projects/create', async (req: Request, res: Response) => {
    const engine = gateway.getProjectEngine?.();
    if (!engine) {
      return res.status(503).json({ error: 'Project engine not initialized' });
    }
    const { type, title, description, context, planning, config, personaId, preferredProvider, preferredModel } = req.body;
    if (!title || !description) {
      return res.status(400).json({ error: 'title and description required' });
    }

    // Effective provider/model: an explicit request value wins; otherwise inherited
    // from the bound book's manifest below (Easy Start's LLM choice persists as the
    // book default, so later phases reuse it without re-specifying).
    let effectivePreferredProvider: string | undefined = preferredProvider || undefined;
    let effectivePreferredModel: string | undefined = preferredModel || undefined;

    // Helper to set optional fields on newly created projects
    const applyProjectOptions = (project: any) => {
      if (personaId) project.personaId = personaId;
      if (effectivePreferredProvider) project.preferredProvider = effectivePreferredProvider;
      if (effectivePreferredModel) project.preferredModel = effectivePreferredModel;
    };

    try {
      // ── Chapter-count + words-per-chapter field aliasing ──
      // Bug fix (2026-04): the dashboard sends `chapters` and `wordsPerChapter`
      // at the top level, but createBookProduction / createNovelPipeline expect
      // `config.targetChapters` and `config.targetWordsPerChapter`. Without this
      // translation, projects silently default to 25 chapters / 3000 words
      // regardless of what the user typed in the modal.
      const resolvedConfig: any = { ...(config || context || {}) };
      if (req.body.chapters !== undefined && resolvedConfig.targetChapters === undefined) {
        const n = Number(req.body.chapters);
        if (Number.isFinite(n) && n > 0) resolvedConfig.targetChapters = n;
      }
      if (req.body.wordsPerChapter !== undefined && resolvedConfig.targetWordsPerChapter === undefined) {
        const n = Number(req.body.wordsPerChapter);
        if (Number.isFinite(n) && n > 0) resolvedConfig.targetWordsPerChapter = n;
      }

      // Phase 8: capture the active book at creation time so the project
      // remains bound to it even if the active book changes later.
      const activeBook = services.books?.getActiveBook() ?? undefined;
      const contextWithSlug = { ...(context || {}), bookSlug: activeBook };

      // Inherit the book's default provider/model when the request didn't pin them.
      if ((!effectivePreferredProvider || !effectivePreferredModel) && activeBook) {
        const ob = await services.books.open(activeBook).catch(() => null);
        if (!effectivePreferredProvider && ob?.manifest?.preferredProvider) effectivePreferredProvider = ob.manifest.preferredProvider;
        if (!effectivePreferredModel && ob?.manifest?.preferredModel) effectivePreferredModel = ob.manifest.preferredModel;
      }

      // Book Format & Structure: when the active book declares a format, use its
      // chapter count + per-chapter target as generation defaults (user-supplied
      // values still win) and carry the structure rail for the outline step.
      const fmtGuide = activeBook ? services.books.formatGuideFor(activeBook) : null;
      if (fmtGuide) {
        if (resolvedConfig.targetChapters === undefined) resolvedConfig.targetChapters = fmtGuide.chapterCount;
        if (resolvedConfig.targetWordsPerChapter === undefined) resolvedConfig.targetWordsPerChapter = fmtGuide.wordsPerChapter;
      }

      // Config-not-code pipelines (Task 10): when the active book has a non-empty
      // pipelineSequence, chain one Project per sequence entry from the book's own
      // snapshots. Takes precedence over the legacy single-pipeline / template
      // branches below, which stay as the no-sequence fallback (no active book, or
      // a legacy v1 book not yet migrated).
      if (activeBook) {
        const opened = await services.books.open(activeBook);
        const pipelineSequence: string[] = Array.isArray(opened?.manifest?.pipelineSequence)
          ? opened!.manifest.pipelineSequence
          : [];
        if (pipelineSequence.length > 0) {
          const s = (opened?.manifest?.seeds ?? {}) as { storyArc?: string; characters?: string; setting?: string; blueprint?: string; councilSelection?: 'auto' | 'propose' };
          // councilSelection: 'propose' → the romance council pause-resume gate;
          // default 'auto' (straight-through). heat is NOT a seed — it selects the
          // pipeline id — so infer it here from the resolved sequence so the
          // council-gate can tone the prompt (spicy vs. sweet).
          const heat = pipelineSequence.some((n) => /spicy/i.test(n)) ? 'spicy' : 'sweet';
          const manifestSeeds = { storyArc: s.storyArc ?? '', characters: s.characters ?? '', setting: s.setting ?? '', blueprint: s.blueprint ?? '', councilSelection: s.councilSelection ?? 'auto', heat };
          const seqContext = { ...manifestSeeds, ...(context || {}), ...resolvedConfig, ...(fmtGuide?.structureRail ? { structureRail: fmtGuide.structureRail } : {}) };
          const { pipelineId, projects } = engine.createBookSequence(
            { slug: activeBook, pipelineSequence },
            title,
            description,
            seqContext,
            (n: string) => services.books.snapshotPipelineOf(activeBook, n),
          );
          if (projects.length === 0) {
            return res.status(400).json({ error: 'Book sequence resolved no runnable pipelines' });
          }
          projects.forEach(applyProjectOptions);
          return res.json({ pipelineId, project: projects[0], projects, planning: 'book-sequence' });
        }
      }

      // Novel pipeline: use dedicated pipeline builder
      // Trust the explicitly-sent type; only infer from description if no type provided
      const inferredType = type || engine.inferProjectType(description);
      if (inferredType === 'novel-pipeline') {
        const project = engine.createNovelPipeline(title, description, resolvedConfig);
        // createNovelPipeline takes no context; stamp bookSlug directly.
        if (activeBook) project.bookSlug = activeBook;
        if (fmtGuide?.structureRail) applyStructureRail(project.steps as Array<{ prompt: string; phase?: string; skill?: string }>, fmtGuide.structureRail);
        applyProjectOptions(project);
        return res.json({ project, planning: 'novel-pipeline' });
      }

      // Book Production: uses dynamic chapter generation
      if (inferredType === 'book-production') {
        const project = engine.createBookProduction(title, description, resolvedConfig);
        // createBookProduction takes no context; stamp bookSlug directly.
        if (activeBook) project.bookSlug = activeBook;
        if (fmtGuide?.structureRail) applyStructureRail(project.steps as Array<{ prompt: string; phase?: string; skill?: string }>, fmtGuide.structureRail);
        applyProjectOptions(project);
        return res.json({ project, planning: 'book-production' });
      }

      // Dynamic planning: ask the AI to figure out the steps
      if (planning === 'dynamic') {
        const skillCatalog = services.skills.getSkillCatalog();
        const authorOSTools = services.authorOS?.getAvailableTools() || [];
        const project = await engine.planProject(title, description, skillCatalog, authorOSTools, contextWithSlug);
        applyProjectOptions(project);
        return res.json({ project, planning: 'dynamic' });
      }

      // Pipeline-based path: source Steps from the ACTIVE BOOK's pipeline.json
      // (book-container Phase 3c). Falls back to the legacy single-step custom
      // create only if no active book / pipeline is resolvable.
      const activePipeline = services.books?.activePipeline?.();
      if (activePipeline) {
        const project = engine.createProjectFromPipeline(activePipeline, title, description, contextWithSlug);
        applyProjectOptions(project);
        return res.json({ project, planning: 'book-pipeline', pipeline: activePipeline.name });
      }
      const project = engine.createProject(inferredType, title, description, contextWithSlug);
      applyProjectOptions(project);
      return res.json({ project, planning: 'template' });
    } catch (err) {
      // A corrupted active pipeline.json (or any creation/validation failure)
      // throws here; respond 400 rather than leaving the async handler to reject
      // unhandled and hang the request.
      return res.status(400).json({ error: 'Failed to create project: ' + String(err) });
    }
  });

  // ── Pipeline Creation (chains all 6 phases) ──
  app.post('/api/pipeline/create', async (req: Request, res: Response) => {
    const engine = gateway.getProjectEngine?.();
    if (!engine) {
      return res.status(503).json({ error: 'Project engine not initialized' });
    }
    const { title, description, personaId, config } = req.body;
    if (!title || !description) {
      return res.status(400).json({ error: 'title and description required' });
    }
    try {
      // NOTE (Phase 3c): the 6-phase macro-chain composes the built-in phase
      // sequence; per-book single-pipeline creation goes through /api/projects/create.
      // Phase 8: bind all child phase projects to the currently active book.
      const pipelineActiveBook = services.books?.getActiveBook() ?? undefined;
      const result = engine.createPipeline(title, description, personaId, config, pipelineActiveBook);
      res.json({
        pipelineId: result.pipelineId,
        phases: result.projects.map((p: any) => ({
          id: p.id,
          type: p.type,
          title: p.title,
          phase: p.pipelinePhase,
          steps: p.steps.length,
          status: p.status,
        })),
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to create pipeline: ' + String(err) });
    }
  });

  // ── Pipeline Status ──
  app.get('/api/pipeline/:pipelineId', (req: Request, res: Response) => {
    const engine = gateway.getProjectEngine?.();
    if (!engine) {
      return res.status(503).json({ error: 'Project engine not initialized' });
    }
    const projects = engine.getPipelineProjects(req.params.pipelineId);
    if (projects.length === 0) {
      return res.status(404).json({ error: 'Pipeline not found' });
    }
    res.json({
      pipelineId: req.params.pipelineId,
      phases: projects.map((p: any) => ({
        id: p.id,
        type: p.type,
        title: p.title,
        phase: p.pipelinePhase,
        steps: p.steps.length,
        completedSteps: p.steps.filter((s: any) => s.status === 'completed' || s.status === 'skipped').length,
        status: p.status,
        progress: p.progress,
      })),
    });
  });

  // F1 (config-not-code pipelines): explicitly advance a book sequence to its
  // next phase. Starts the next pending phase project IFF the prior phase has
  // completed (no AI execution — the started project still needs execute/auto-run).
  // The onProjectCompleted hook advances automatically; this is the manual/UI lever.
  app.post('/api/pipeline/:pipelineId/advance', (req: Request, res: Response) => {
    const engine = gateway.getProjectEngine?.();
    if (!engine) {
      return res.status(503).json({ error: 'Project engine not initialized' });
    }
    const pipelineProjects = engine.getPipelineProjects(req.params.pipelineId);
    if (pipelineProjects.length === 0) {
      return res.status(404).json({ error: 'Pipeline not found' });
    }
    const started = engine.advancePipeline(req.params.pipelineId);
    // Flagship Plan 4 (Task 3): fire-and-forget beta-reader pre-format gate —
    // advisory only, never blocks the advance response (fail-soft).
    if (started) {
      runBetaReaderGate({ services, pipelineProjects, startedProject: started, gatherChapters })
        .catch((err) => console.warn('  [beta-reader-gate] hook failed (non-fatal):', (err as Error)?.message || err));
    }
    res.json({ advanced: !!started, project: started ?? null });
  });

  // LLM Council (sub-project 3, Task 5): surface the pause-resume gate to
  // clients without a new project status — `awaitingSelection` mirrors
  // `!!project.selection` so the Board/PipelineRail can badge it directly.
  const withAwaitingSelection = (p: any) => ({ ...p, awaitingSelection: !!p.selection });

  app.get('/api/projects/list', (req: Request, res: Response) => {
    const engine = gateway.getProjectEngine?.();
    if (!engine) {
      return res.status(503).json({ error: 'Project engine not initialized' });
    }
    const status = (req.query as any).status;
    res.json({ projects: engine.listProjects(status).map(withAwaitingSelection) });
  });

  app.get('/api/projects/:id', (req: Request, res: Response) => {
    const engine = gateway.getProjectEngine?.();
    if (!engine) {
      return res.status(503).json({ error: 'Project engine not initialized' });
    }
    const project = engine.getProject(req.params.id);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    res.json({ project: withAwaitingSelection(project) });
  });

  app.post('/api/projects/:id/start', (req: Request, res: Response) => {
    const engine = gateway.getProjectEngine?.();
    if (!engine) {
      return res.status(503).json({ error: 'Project engine not initialized' });
    }
    const step = engine.startProject(req.params.id);
    if (!step) {
      return res.status(404).json({ error: 'Project not found or no pending steps' });
    }
    res.json({ step, project: engine.getProject(req.params.id) });
  });

  /**
   * Smart excerpt builder for large manuscripts.
   * Reads the full document from disk and extracts a relevant excerpt
   * that fits within AI context limits while preserving the most useful content.
   *
   * Strategy: first 20K chars + last 5K chars (with truncation marker)
   * This gives the AI the beginning (setup, style, voice) and ending (current state)
   * which is ideal for revision, editing, and analysis tasks.
   */
  async function getSmartExcerpt(filePath: string, wordCount: number, maxChars = 25000): Promise<string> {
    const { readFile: rf } = await import('fs/promises');
    const { existsSync: ex } = await import('fs');

    if (!ex(filePath)) {
      return `[Document not found at ${filePath} — it may have been moved or deleted]`;
    }

    const fullText = await rf(filePath, 'utf-8');

    if (fullText.length <= maxChars) {
      return fullText; // Small enough to include everything
    }

    // Smart split: 80% head + 20% tail
    const headSize = Math.floor(maxChars * 0.8);
    const tailSize = maxChars - headSize;
    const head = fullText.substring(0, headSize);
    const tail = fullText.substring(fullText.length - tailSize);

    const omittedChars = fullText.length - headSize - tailSize;
    const omittedWords = Math.round(omittedChars / 5); // rough estimate

    return `${head}\n\n` +
      `[... ⚠️ MIDDLE SECTION OMITTED: ~${omittedWords.toLocaleString()} words skipped to fit context. ` +
      `Full document (${wordCount.toLocaleString()} words) is saved in workspace/documents/. ...]\n\n` +
      `${tail}`;
  }

  // Returns true if the step requires the FULL manuscript in context (not a truncated excerpt).
  // Revision-apply steps must see the whole book to rewrite it correctly.
  function stepNeedsFullManuscript(step: any): boolean {
    const phase = String(step?.phase || '').toLowerCase();
    const label = String(step?.label || '').toLowerCase();
    return phase === 'revision_apply' ||
      label.includes('apply macro revision') ||
      label.includes('apply scene-level revision') ||
      label.includes('apply line-level revision') ||
      label.includes('full manuscript rewrite');
  }

  // Helper: build user message for project step execution
  // Injects uploaded manuscript DIRECTLY into the user message so the AI can't miss it
  // For large documents (15K+ words): reads from disk and applies smart truncation
  async function buildStepUserMessage(project: any, step: any): Promise<string> {
    let message = step.prompt;
    // Flagship Plan 5: a 'regenerate' gate action attaches a human steering
    // note to the step; inject it once, then clear it so a later unrelated
    // regenerate doesn't repeat a stale note.
    if (step.regenerateNote) {
      message = `${message}\n\n## Human review note — address this in your regenerated draft\n\n${step.regenerateNote}`;
      delete step.regenerateNote;
    }
    const uploads = project.context?.uploads || [];
    const fileList = uploads.map((u: any) => `${u.filename} (${u.wordCount?.toLocaleString() || '?'} words)`).join(', ');

    // Revision-apply steps need to see the full manuscript; analysis steps get a smart excerpt.
    const fullNeeded = stepNeedsFullManuscript(step);
    const charCap = fullNeeded ? 600000 : 30000;  // ~120K words when needed (fits Claude/Gemini context)

    // Large document path: read from disk with cap-aware truncation
    if (project.context?.documentLibraryFile) {
      const excerpt = await getSmartExcerpt(
        project.context.documentLibraryFile,
        project.context.documentWordCount || 0,
        charCap
      );
      const headerNote = fullNeeded
        ? `\n\n⚠️ This is a REVISION APPLY step. You MUST rewrite the ENTIRE manuscript below (or as much as fits in your response — the system will ask for continuations).\n\n`
        : '';
      message = `## Manuscript to Work With\n\nUploaded files: ${fileList}${headerNote}\n\n${excerpt}\n\n---\n\n## Your Task\n\n${message}`;
      return message;
    }

    // Small document path: use inline uploaded content
    if (project.context?.uploadedContent) {
      const uploaded = String(project.context.uploadedContent).substring(0, charCap);
      const headerNote = fullNeeded
        ? `\n\n⚠️ This is a REVISION APPLY step. You MUST rewrite the ENTIRE manuscript below (or as much as fits in your response — the system will ask for continuations).\n\n`
        : '';
      message = `## Manuscript to Work With\n\nUploaded files: ${fileList}${headerNote}\n\n${uploaded}\n\n---\n\n## Your Task\n\n${message}`;
    }

    return message;
  }

  app.post('/api/projects/:id/execute', async (req: Request, res: Response) => {
    const engine = gateway.getProjectEngine?.();
    if (!engine) {
      return res.status(503).json({ error: 'Project engine not initialized' });
    }
    const project = engine.getProject(req.params.id);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const activeStep = project.steps.find((s: any) => s.status === 'active');
    if (!activeStep) {
      return res.status(400).json({ error: 'No active step. Start the project first.' });
    }

    // LLM Council selection gate: if the project is parked awaiting a base-story
    // pick, a single-step /execute must NOT advance it (mirrors the /auto-execute
    // guard at the top of the loop) — otherwise clicking "Execute" bypasses the
    // human base-story selection.
    if (project.selection) {
      return res.status(409).json({ error: 'Awaiting council base-story selection', awaitingSelection: true, projectId: project.id });
    }

    // Human Review gate already open (bug #6): a step parked for review must not
    // be regenerated by clicking "Execute" — a later review approve would then
    // clobber the fresh result with the stale pre-gate pendingResult. Mirrors the
    // /auto-execute project.review guard.
    if (project.review) {
      return res.status(409).json({ error: 'Awaiting human review', humanReview: true, confirmationId: project.review.confirmationId });
    }

    // Claim a drive slot BEFORE the council dispatch (bug #14) — the shared
    // per-project lock (bug-review #8) PLUS the Flagship Plan 6 global concurrency
    // cap, via the scheduler when wired in. The council ensemble spends AI money
    // and can double-complete the council step, so it must run ONLY under this
    // lock: two concurrent "Execute" clicks now get the 409/429 here instead of
    // both billing the council and racing to complete its step. Everything below —
    // budget, council, human-review, generation — is inside the try/finally so
    // every early return releases the lock. Same-project reentrancy still 409s (a
    // retry against THIS project won't help until its own run finishes); a
    // separate, non-blocking check against fleet capacity 429s instead of
    // holding the HTTP connection open behind another book's full drive (M2 fix).
    if (engine.isDriving(project.id)) {
      return res.status(409).json({ error: 'Project is already running' });
    }
    if (!tryAcquireDriveNow(services.driveScheduler, engine, project.id)) {
      return res.status(429).json({ queued: true, error: 'fleet at capacity — retry' });
    }

    try {
      // Graceful cost-boundary pause (Flagship Plan 6, Task 3): a single-step
      // /execute is still a chapter boundary from the cost cap's point of view —
      // without this check a user could bypass the auto-execute loop's pause by
      // clicking "Execute" step by step. Checked BEFORE the council dispatch
      // (bug #14) so council spend is subject to the cost cap too, not just
      // non-council generation. (Releases the lock via the finally on return.)
      if (services.costs) {
        const budgetGate = checkBudgetPause(services.costs, project);
        if (budgetGate) {
          applyBudgetPause(project, budgetGate);
          return res.json({ budgetPause: true, reason: budgetGate.reason, project: engine.getProject(req.params.id) });
        }
      }

      // LLM Council gate (romance): a council-origination step is handled by the
      // council engine, not the AI router. 'auto' completes it with the judge's top
      // base story (next step becomes active); 'propose' parks the project awaiting a
      // selection. Non-council steps and non-romance projects fall straight through.
      // Runs under the drive lock (bug #14) so a concurrent Execute can't double-run it.
      const councilOutcome = await maybeRunCouncilStep(
        { engine, council: buildCouncilService(services.aiRouter) },
        project,
        activeStep,
      );
      if (councilOutcome.gated) {
        return res.status(409).json({ error: 'Awaiting council base-story selection', awaitingSelection: true, projectId: project.id, project: engine.getProject(req.params.id) });
      }
      if (councilOutcome.handled) {
        return res.json({ council: true, project: engine.getProject(req.params.id) });
      }

      // Human Review gate: a human-review step pauses the pipeline and raises a
      // Confirmations request instead of generating; the resolver resumes on approval.
      if (isHumanReviewStep(activeStep) && services.confirmationGate) {
        const conf = await openReviewGate({ gate: services.confirmationGate, engine }, project, activeStep, 'pipeline-gate');
        return res.json({ humanReview: true, confirmationId: conf?.id ?? project.review?.confirmationId, project: engine.getProject(req.params.id) });
      }

      // H1 fix: nothing stamps project.context.genre at project-create, so
      // stepRouting's `project?.genre ?? project?.context?.genre` lookup was
      // always undefined and the per-role casting sheet never loaded. Stamp
      // it from the bound book's manifest before stepRouting runs.
      if (project.bookSlug && services.books) {
        try {
          const ob = await services.books.open(project.bookSlug);
          const genreName = ob?.manifest?.pulledFrom?.genre?.name;
          if (genreName && !project.genre && !project.context?.genre) {
            project.context = project.context || {};
            project.context.genre = genreName;
          }
          applyBookModelConfig(project, ob?.manifest);
        } catch { /* fail-soft: casting sheet stays tier-default */ }
      }

      // F2: inject passive step-skill content (snapshot → global), same as the
      // bridge path — buildProjectContext alone never added it on the studio path.
      const projectContext = (await engine.buildProjectContext(project, activeStep))
        + passiveSkillBlock(services, (activeStep as any).skill, project.bookSlug);
      const userMessage = await buildStepUserMessage(project, activeStep);

      // Flagship Plan 2: heat_check + intimacy-branch routing for a draft/intimacy
      // step. A no-op (empty promptAddition, null spiceRoute) unless the bound
      // book has a contentCeiling — a fade-to-black book is untouched.
      const intimacy = await resolveIntimacyRouting({ services, project, step: activeStep, sceneBriefText: userMessage });
      const intimacyContext = projectContext + intimacy.promptAddition;
      const { provider: stepProvider, model: stepModel, temperature: stepTemp } = stepRouting(project, activeStep, intimacy.spiceRoute);
      let response = '';

      // Flagship Plan 8: opt-in ideation ensemble on the first premise-phase
      // step. A no-op unless the bound book has ensemble.enabled === true.
      const ensemble = await resolveEnsemblePremise({ services, project, step: activeStep, userMessage });

      // Multi-step skills: an executable skill's OpenRouter phase chain IS the
      // generation (skip the normal single call + short-retry). null → passive skill.
      const execOut = ensemble.active ? null : await runExecutableSkillStep(services, (activeStep as any).skill, userMessage, project.bookSlug);
      if (ensemble.active) {
        response = ensemble.premiseText!;
      } else if (execOut !== null) {
        response = execOut;
      } else {
        await gateway.handleMessage(
          userMessage,
          'projects',
          (text: string) => { response = text; },
          intimacyContext,
          activeStep.taskType || undefined,  // Use step's own taskType for routing
          stepProvider,                       // per-step override → project default → tier
          stepModel,                          // exact model id when the step pins one
          project.bookSlug,                   // Phase 8: compose soul/genre from the project's bound book
          stepTemp                            // per-step temperature pin (undefined → provider default)
        );

        // Retry once with 'general' routing if the response is too short
        if (!response || response.length < 50) {
          console.log(`  ↻ Step "${activeStep.label}" got short response — retrying with general routing...`);
          response = '';
          await gateway.handleMessage(
            userMessage,
            'projects',
            (text: string) => { response = text; },
            intimacyContext,
            'general',
            stepProvider,  // preserve the step's pinned provider on retry (parity with /auto-execute)
            stepModel,     // preserve the step's pinned model on retry
            project.bookSlug                  // Phase 8: keep the bound book on the retry path
          );
        }

        // Refusal escalation (Flagship Plan 2, Task 7): an on-page Claude scene
        // that still came back empty/refused (or read as a wordy refusal — L1)
        // after the general-routing retry escalates once to the casting
        // sheet's uncensored ladder.
        if (intimacy.active && intimacy.decision?.mode === 'onpage_claude' && (!response || response.length < 50 || looksLikeRefusal(response))) {
          const escalated = intimacy.recomputeOnRefusal();
          if (escalated?.spiceRoute) {
            console.log(`  ↻ Step "${activeStep.label}" refused on-page — escalating to uncensored route (${escalated.spiceRoute.provider})...`);
            const escalatedRouting = stepRouting(project, activeStep, escalated.spiceRoute);
            response = '';
            await gateway.handleMessage(
              userMessage,
              'projects',
              (text: string) => { response = text; },
              intimacyContext,
              activeStep.taskType || undefined,
              escalatedRouting.provider,
              escalatedRouting.model,
              project.bookSlug,
              escalatedRouting.temperature
            );
          }
        }
      }

      // Detect the [AI provider failure] sentinel from handleMessage when both
      // primary and fallback errored. Treat as failure with the real reason
      // instead of writing the error message into the manuscript file.
      const execClass = classifyStepResponse(response);
      if (execClass.providerFailure) {
        const detail = execClass.detail!;
        engine.failStep(project.id, activeStep.id, detail);
        return res.json({
          success: false,
          error: 'AI provider failure — see detail',
          detail,
          project: engine.getProject(project.id),
        });
      }
      if (!execClass.ok && execOut === null) {
        const reason = `AI returned an unusably short response (${response?.length ?? 0} chars). ` +
          `This usually means the chosen provider hit a safety filter, ran out of context, or the model is misconfigured. ` +
          `Try a different provider in Settings, shorten the project description, or split the task.`;
        engine.failStep(project.id, activeStep.id, reason);
        return res.json({
          success: false,
          error: reason,
          project: engine.getProject(project.id),
        });
      }

      // Strip leaked chatbot framing before saving/completing (parity with the
      // auto-execute runner), then WRITE the step's output file. /execute used to
      // complete the step without ever writing the `${id}-<label>.md` file that
      // the disk-based manuscript assemblers read, so a chapter run individually
      // via the "Execute" button silently vanished from the compiled novel
      // (bug-review #7). Chapter/prose steps get the aggressive prose-mode strip
      // (drops a leaked "Next Steps:" epilogue); other steps keep the safe strip.
      const prose = isProseStep(activeStep);
      response = stripMetaCommentary(response, { prose });

      // Safety floor (Flagship Plan 2, Task 4/7): non-negotiable — runs on every
      // draft/intimacy step regardless of the book's contentCeiling (H1 fix).
      let reviewFlags: string[] = [];
      if (isSafetyFloorStep(activeStep)) {
        const banned = bannedContentCheck(response);
        if (banned.hardBlock) {
          engine.failStep(project.id, activeStep.id, `Safety floor blocked this draft: ${banned.reason}`);
          return res.json({
            success: false,
            error: `Safety floor blocked this draft: ${banned.reason}`,
            project: engine.getProject(project.id),
          });
        }
        reviewFlags = banned.flags;
        if (reviewFlags.length) {
          console.log(`  ⚠ Step "${activeStep.label}" flagged for review: ${reviewFlags.join('; ')}`);
        }
        const guard = operationalDetailGuard(response);
        if (guard.flagged) {
          console.log(`  ⚠ Step "${activeStep.label}" flagged for operational detail — running one abstraction rewrite pass...`);
          let rewritten = '';
          await gateway.handleMessage(
            `Rewrite the passage below so any actionable, step-by-step, or code-level technical detail is replaced with consequence-realistic narrative summary (what happens and its fallout), not a reproducible procedure. Preserve the story, characters, and prose voice — only abstract the operational detail.\n\n${response}`,
            'projects',
            (text: string) => { rewritten = text; },
            intimacyContext,
            activeStep.taskType || undefined,
            stepProvider,
            stepModel,
            project.bookSlug,
            stepTemp
          );
          if (rewritten && rewritten.length > 50) response = stripMetaCommentary(rewritten, { prose });
        }
      }
      try {
        const { join: j } = await import('path');
        const { mkdir: mkd, writeFile: wf } = await import('fs/promises');
        const activeDataDir: string | null = services.books?.dataDirOf?.(project.bookSlug) ?? services.books?.activeDataDir?.() ?? null;
        const projectSlug = project.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const projectDir = activeDataDir ?? j(baseDir, 'workspace', 'projects', projectSlug);
        await mkd(projectDir, { recursive: true });
        const stepFileName = `${activeStep.id}-${activeStep.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.md`;
        await wf(j(projectDir, stepFileName), `# ${activeStep.label}\n\n${response}`, 'utf-8');
      } catch (writeErr) {
        console.error('[execute] Failed to write step output file:', writeErr);
      }

      // Human-Gate Cadence (bug #6, parity with /auto-execute): check AFTER the
      // content generates (so approve/edit resume with the real drafted text) and
      // BEFORE completeStep (so a per_chapter/act/pre-export boundary gates on the
      // Execute path too, not only auto-execute). The step file is already saved
      // above. A book without a review cadence falls straight through unchanged.
      if (services.confirmationGate) {
        let bookManifest: any = null;
        if (project.bookSlug && services.books) {
          const ob = await services.books.open(project.bookSlug).catch(() => null);
          bookManifest = ob?.manifest ?? null;
        }
        const cadenceGate = await maybeOpenCadenceGate(
          { gate: services.confirmationGate, engine },
          project, activeStep, response,
          { manifest: bookManifest, craftCritic: services.craftCritic, dialogueAuditor: services.dialogueAuditor },
        );
        if (cadenceGate.gated) {
          return res.json({ humanReview: true, confirmationId: cadenceGate.confirmationId, project: engine.getProject(project.id) });
        }
      }

      const nextStep = engine.completeStep(project.id, activeStep.id, response);

      res.json({
        success: true,
        completedStep: activeStep.id,
        response,
        nextStep,
        project: engine.getProject(project.id),
        ...(reviewFlags.length ? { reviewFlags } : {}),
      });
    } catch (error) {
      engine.failStep(project.id, activeStep.id, String(error));
      res.status(500).json({
        error: 'Step execution failed: ' + String(error),
        project: engine.getProject(project.id),
      });
    } finally {
      releaseDrive(services.driveScheduler, engine, project.id);
    }
  });

  // Auto-execute ALL steps of a project (fully autonomous mode)
  // ── Retry a single step (reset failed/completed → pending) ──
  // Useful when a step failed and the user wants to retry without restarting
  // the whole project. Optionally deletes the previous output file.
  app.post('/api/projects/:id/steps/:stepId/retry', async (req: Request, res: Response) => {
    const engine = gateway.getProjectEngine?.();
    if (!engine) return res.status(503).json({ error: 'Project engine not initialized' });
    const project = engine.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    // Bug #7: refuse mid-drive — mutating a project while a step is in flight
    // corrupts step state (the driver and this handler race the same step).
    if (engine.isDriving(req.params.id)) return res.status(409).json({ error: 'Project is currently running' });

    const step = engine.retryStep(req.params.id, req.params.stepId);
    if (!step) return res.status(404).json({ error: 'Step not found' });

    // Optionally delete the step's output file so the next run starts clean.
    if (req.body?.deleteOutputFile) {
      try {
        const { unlink } = await import('fs/promises');
        const { join: jp } = await import('path');
        const projectSlug = project.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const projectDir = services.books?.dataDirOf?.(project.bookSlug) ?? services.books?.activeDataDir?.() ?? jp(baseDir, 'workspace', 'projects', projectSlug);
        const filename = `${step.id}-${step.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.md`;
        await unlink(jp(projectDir, filename)).catch(() => {});
      } catch { /* non-fatal */ }
    }

    res.json({ step, project: engine.getProject(req.params.id) });
  });

  // ── Restart the whole project ──
  // Resets failed/active (and optionally completed) steps to pending so the
  // user can re-run from a clean state. Optionally deletes all output files.
  app.post('/api/projects/:id/restart', async (req: Request, res: Response) => {
    const engine = gateway.getProjectEngine?.();
    if (!engine) return res.status(503).json({ error: 'Project engine not initialized' });
    const project = engine.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    // Bug #7: refuse mid-drive — restarting while a step is in flight corrupts state.
    if (engine.isDriving(req.params.id)) return res.status(409).json({ error: 'Project is currently running' });

    const keepCompleted = !!req.body?.keepCompleted;
    const result = engine.restartProject(req.params.id, { keepCompleted });
    if (!result) return res.status(404).json({ error: 'Project not found' });

    if (req.body?.deleteOutputFiles) {
      try {
        const { rm } = await import('fs/promises');
        const { readdirSync, existsSync: ex } = await import('fs');
        const { join: jp } = await import('path');
        const projectSlug = project.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const activeDataDir = services.books?.dataDirOf?.(project.bookSlug) ?? services.books?.activeDataDir?.() ?? null;
        const projectDir = activeDataDir ?? jp(baseDir, 'workspace', 'projects', projectSlug);
        if (ex(projectDir)) {
          // Only delete .md files, preserve manuscript / compiled-output / revised files
          // unless restart is full (no keepCompleted).
          const files = readdirSync(projectDir);
          for (const f of files) {
            if (!f.endsWith('.md')) continue;
            // book data/ is shared across this book's projects — scope deletion
            // to this project's own step files, never siblings'.
            if (activeDataDir && !f.startsWith(`${project.id}-`)) continue;
            const base = activeDataDir ? f.replace(new RegExp(`^${project.id}-`), '') : f;
            if (keepCompleted && (base === 'manuscript.md' || base === 'compiled-output.md' || base === 'revised-manuscript.md' || base === 'revision-report.md')) continue;
            await rm(jp(projectDir, f)).catch(() => {});
          }
        }
      } catch { /* non-fatal */ }
    }

    res.json(result);
  });

  app.post('/api/projects/:id/auto-execute', async (req: Request, res: Response) => {
    const engine = gateway.getProjectEngine?.();
    if (!engine) {
      return res.status(503).json({ error: 'Project engine not initialized' });
    }
    const project = engine.getProject(req.params.id);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Concurrency guard: only one runner per project, shared across ALL runners
    // (this route, /execute, and the bridge autoRunProject/startAndRunProject
    // loops) via the engine's drive lock — PLUS the Flagship Plan 6 global
    // concurrency cap (maxConcurrentDrives) via the scheduler when wired in.
    // Without the per-project lock, the dashboard + Telegram (or a double-click)
    // both process the same active step → duplicated/overwritten chapter files +
    // double cost (bug-review #8). Without the scheduler, an unbounded number of
    // books could drive concurrently regardless of the configured cap.
    // M2 fix: a non-blocking claim — an HTTP handler must not hold the
    // connection open while queued behind another book's full drive (a
    // reverse-proxy/browser timeout can kill it); 429 lets the caller retry.
    // Background drivers keep the blocking acquireDrive queue. Same-project
    // reentrancy still 409s (mirrors /execute — a retry against THIS project
    // won't help until its own run finishes).
    if (engine.isDriving(project.id)) {
      return res.status(409).json({ error: 'Project is already auto-executing' });
    }
    if (!tryAcquireDriveNow(services.driveScheduler, engine, project.id)) {
      return res.status(429).json({ queued: true, error: 'fleet at capacity — retry' });
    }

    // M1 fix: everything from here on runs inside the try so a throw in any of
    // these intervening statements still releases the slot via the finally
    // below, instead of leaking it permanently.
    try {
      // A project paused awaiting Human Review must NOT be un-paused by "continue" —
      // it requires a Confirmations decision. Surface the pending review instead.
      if (project.review) {
        return res.status(409).json({ error: 'Awaiting human review', humanReview: true, confirmationId: project.review.confirmationId });
      }

      // A project parked awaiting an LLM-Council base-story selection must NOT be
      // un-paused by "continue" — it requires a POST /council/select decision.
      // Mirrors the project.review guard directly above (the gate sits in front
      // of the drive loop so a re-fired /auto-execute never re-runs the council).
      if (project.selection) {
        return res.status(409).json({ error: 'Awaiting council base-story selection', awaitingSelection: true, projectId: project.id });
      }

      if (project.status === 'pending') {
        engine.startProject(req.params.id);
      } else if (project.status === 'paused') {
        project.status = 'active';
        delete (project as any).budgetPause; // resuming clears a prior budget-boundary pause
        const firstPending = project.steps.find((s: any) => s.status === 'pending');
        if (firstPending) firstPending.status = 'active';
      }

    const results: Array<{ step: string; success: boolean; wordCount?: number; error?: string; reviewFlags?: string[] }> = [];
    let humanReviewConfId: string | undefined;
    let budgetPaused = false;
    const { join } = await import('path');
    const { mkdir, writeFile } = await import('fs/promises');
    const workspaceDir = join(baseDir, 'workspace');
    // Phase 8: outputs land under the project's bound book data/ dir; fall back to
    // the global active book, then the legacy flat projects/<slug>/ dir.
    const activeDataDir: string | null = services.books?.dataDirOf?.(project.bookSlug) ?? services.books?.activeDataDir?.() ?? null;
    const outDirFor = (slug: string) =>
      activeDataDir ? activeDataDir : join(workspaceDir, 'projects', slug);

    while (true) {
      const currentProject = engine.getProject(req.params.id);
      if (!currentProject) break;

      // Check if project was paused externally (via /stop or dashboard)
      if (currentProject.status === 'paused' || currentProject.status === 'completed') break;

      const activeStep = currentProject.steps.find((s: any) => s.status === 'active');
      if (!activeStep) break;

      // LLM Council gate (romance): a council-origination step is handled by the
      // council engine, not the AI router. In 'auto' mode it completes the step
      // with the judge's top base story and the loop continues; in 'propose' mode
      // it parks the project awaiting a selection and the loop STOPS. Non-council
      // steps and non-romance projects fall straight through ({handled:false}).
      const councilOutcome = await maybeRunCouncilStep(
        { engine, council: buildCouncilService(services.aiRouter) },
        currentProject,
        activeStep,
      );
      if (councilOutcome.gated) { results.push({ step: activeStep.label, success: false, error: 'awaiting council selection' }); break; }
      if (councilOutcome.handled) { continue; } // auto: step completed, advance to the next frontier

      // Human Review gate: a human-review step pauses the pipeline and raises a
      // Confirmations request instead of generating; the resolver resumes on approval.
      if (isHumanReviewStep(activeStep) && services.confirmationGate) {
        const conf = await openReviewGate({ gate: services.confirmationGate, engine }, currentProject, activeStep, 'pipeline-gate');
        results.push({ step: activeStep.label, success: false, error: 'awaiting human review' });
        humanReviewConfId = conf?.id ?? currentProject.review?.confirmationId;
        break;
      }

      // Graceful cost-boundary pause (Flagship Plan 6, Task 3): checked at the
      // chapter boundary — BEFORE this step starts generating, so a cap trip
      // never interrupts a chapter already in progress, only the next one from
      // starting. The prior chapter's cost is already recorded by this point.
      if (services.costs) {
        const budgetGate = checkBudgetPause(services.costs, currentProject);
        if (budgetGate) {
          applyBudgetPause(currentProject, budgetGate);
          results.push({ step: activeStep.label, success: false, error: `budget_pause: ${budgetGate.reason}` });
          budgetPaused = true;
          break;
        }
      }

      try {
        // F2: inject passive step-skill content (snapshot → global), same as the
        // bridge path — buildProjectContext alone never added it on the studio path.
        // Pin the story canon (title/author + bible name registry + outline) so a
        // step in this separate project doesn't re-invent the title/characters.
        let canonBlock = '';
        let continuityBlock = '';
        let groundingBlock = '';
        let analyzeApplyBlock = '';
        let continuityWorldName: string | null = null;
        // Flagship Plan 5: the bound book's manifest, reused below (no extra
        // I/O) to resolve its review.cadence at the gate check after this
        // step generates.
        let bookManifest: any = null;
        // Flagship Plan 3 (Task 4): a draft-role chapter step gets the ledger
        // block pre-draft and the continuity check post-draft. chapterNumber
        // is cheap/pure to compute (no I/O), so it's always resolved here and
        // reused below regardless of role.
        const isContinuityDraftStep = isStepRole(activeStep?.role) && activeStep.role === 'draft';
        const continuityChapterNum = chapterSummaryTarget(currentProject, activeStep, true).chapterNum;
        if (currentProject.bookSlug && services.books) {
          const ob = await services.books.open(currentProject.bookSlug).catch(() => null);
          bookManifest = ob?.manifest ?? null;
          canonBlock = buildBookCanonBlock(services.books.dataDirOf?.(currentProject.bookSlug), ob?.manifest);
          continuityWorldName = ob?.manifest?.pulledFrom?.world?.name ?? null;

          // H1 fix: stamp the genre from the manifest so stepRouting's per-role
          // casting sheet actually loads (mirrors the /execute stamp above).
          const genreName = bookManifest?.pulledFrom?.genre?.name;
          if (genreName && !currentProject.genre && !currentProject.context?.genre) {
            currentProject.context = currentProject.context || {};
            currentProject.context.genre = genreName;
          }
          applyBookModelConfig(currentProject, bookManifest);

          // Pre-draft continuity-ledger injection: established facts up to this
          // chapter + Character Knowledge Matrix + forbidden (not-yet-revealed)
          // moves. Fail-soft: buildCanonBlock returns '' when the store is
          // unavailable or has no facts yet for this book (book-has-bible guard).
          if (isContinuityDraftStep && services.consistencyStore?.isAvailable?.()) {
            try {
              continuityBlock = buildCanonBlock({
                slug: currentProject.bookSlug,
                chapterNumber: continuityChapterNum,
                store: services.consistencyStore,
                world: continuityWorldName,
              });
            } catch { /* fail-soft: never block drafting on ledger errors */ }
          }
        }

        // Flagship Plan 4 (Task 1): grounding research on the front of a
        // book-bible role='bible' step — sourced facts written under
        // workspace/research/<slug>.md and injected into this step's context.
        // Fail-soft: never blocks bible generation.
        if (isStepRole(activeStep?.role) && activeStep.role === 'bible') {
          try {
            const g = await resolveGroundingBlock({
              services,
              project: currentProject,
              step: activeStep,
              researchDir: join(workspaceDir, 'research'),
            });
            groundingBlock = g.groundingBlock;
          } catch (err) {
            console.warn('  [grounding-research] hook failed (non-fatal):', (err as Error)?.message || err);
          }
        }

        // Flagship Plan 4 (Task 3): analyze-then-apply polish — the deterministic
        // craft-critic + dialogue-auditor flags (zero-AI) plus Plan 3's post-draft
        // continuity flags on the matching "Write Chapter N" step, surfaced as
        // targeted findings for the "Polish Chapter N" step to fix. Fail-soft:
        // a bad/missing write step or a critic error just means an un-targeted
        // (but otherwise unchanged) polish pass, same as before this feature.
        analyzeApplyBlock = resolveAnalyzeApplyBlock({ services, project: currentProject, step: activeStep });
        const userMessage = await buildStepUserMessage(currentProject, activeStep);

        // Flagship Plan 2: heat_check + intimacy-branch routing for a draft/
        // intimacy step. A no-op (empty promptAddition, null spiceRoute) unless
        // the bound book has a contentCeiling — a fade-to-black book is untouched.
        // Folded into projectContext so every downstream handleMessage call in
        // this step (primary, retry, continuation, quality-loop) carries it.
        const intimacy = await resolveIntimacyRouting({ services, project: currentProject, step: activeStep, sceneBriefText: userMessage });
        const projectContext = (await engine.buildProjectContext(currentProject, activeStep))
          + passiveSkillBlock(services, (activeStep as any).skill, currentProject.bookSlug)
          + (canonBlock ? `\n\n${canonBlock}` : '')
          + (continuityBlock ? `\n\n${continuityBlock}` : '')
          + (groundingBlock ? `\n\n${groundingBlock}` : '')
          + (analyzeApplyBlock ? `\n\n${analyzeApplyBlock}` : '')
          + intimacy.promptAddition;
        const { provider: stepProvider, model: stepModel, temperature: stepTemp } = stepRouting(currentProject, activeStep, intimacy.spiceRoute);
        let response = '';

        // Flagship Plan 8: opt-in ideation ensemble on the first premise-phase
        // step. A no-op unless the bound book has ensemble.enabled === true.
        const ensemble = await resolveEnsemblePremise({ services, project: currentProject, step: activeStep, userMessage });

        // Multi-step skills: an executable skill's OpenRouter phase chain IS the
        // generation (skip the normal single call + short-retry). null → passive skill.
        const execOut = ensemble.active ? null : await runExecutableSkillStep(services, (activeStep as any).skill, userMessage, currentProject.bookSlug);
        if (ensemble.active) {
          response = ensemble.premiseText!;
        } else if (execOut !== null) {
          response = execOut;
        } else {
          await gateway.handleMessage(
            userMessage,
            'project-engine',
            (text: string) => { response = text; },
            projectContext,
            activeStep.taskType || undefined,  // Use step's own taskType for routing
            stepProvider,                       // per-step override → project default → tier
            stepModel,                          // exact model id when the step pins one
            currentProject.bookSlug,            // Phase 8: compose soul/genre from the project's bound book
            stepTemp                            // per-step temperature pin (undefined → provider default)
          );

          // Retry once with 'general' routing if the response is too short
          // This catches cases where a premium/mid provider fails but free providers work fine
          if (!response || response.length < 50) {
            console.log(`  ↻ Step "${activeStep.label}" got short response — retrying with general routing...`);
            response = '';
            await gateway.handleMessage(
              userMessage,
              'project-engine',
              (text: string) => { response = text; },
              projectContext,
              'general',  // Force free-tier routing (Gemini first)
              stepProvider,  // preserve the step's pinned provider on retry (if set)
              stepModel,     // preserve the step's pinned model on retry (if set)
              currentProject.bookSlug           // Phase 8: keep the bound book on the retry path
            );
          }

          // Refusal escalation (Flagship Plan 2, Task 7): an on-page Claude scene
          // that still came back empty/refused (or read as a wordy refusal —
          // L1) after the general-routing retry escalates once to the casting
          // sheet's uncensored ladder.
          if (intimacy.active && intimacy.decision?.mode === 'onpage_claude' && (!response || response.length < 50 || looksLikeRefusal(response))) {
            const escalated = intimacy.recomputeOnRefusal();
            if (escalated?.spiceRoute) {
              console.log(`  ↻ Step "${activeStep.label}" refused on-page — escalating to uncensored route (${escalated.spiceRoute.provider})...`);
              const escalatedRouting = stepRouting(currentProject, activeStep, escalated.spiceRoute);
              response = '';
              await gateway.handleMessage(
                userMessage,
                'project-engine',
                (text: string) => { response = text; },
                projectContext,
                activeStep.taskType || undefined,
                escalatedRouting.provider,
                escalatedRouting.model,
                currentProject.bookSlug,
                escalatedRouting.temperature
              );
            }
          }
        }

        const stepClass = classifyStepResponse(response);
        if (stepClass.providerFailure) {
          const detail = stepClass.detail!;
          engine.failStep(currentProject.id, activeStep.id, detail);
          if (services.confirmationGate) await openReviewGate({ gate: services.confirmationGate, engine }, currentProject, activeStep, 'pipeline-error', detail);
          results.push({ step: activeStep.label, success: false, error: detail });
          break;
        }
        if (!stepClass.ok && execOut === null) {
          const reason = `AI returned an unusably short response (${response?.length ?? 0} chars). ` +
            `Cause is usually a safety filter trip, context overflow, or misconfigured provider. ` +
            `Switch providers in Settings or shorten the project description.`;
          engine.failStep(currentProject.id, activeStep.id, reason);
          if (services.confirmationGate) await openReviewGate({ gate: services.confirmationGate, engine }, currentProject, activeStep, 'pipeline-error', reason);
          results.push({ step: activeStep.label, success: false, error: reason });
          break;
        }

        // ── Continuation logic for long-output steps (revision-apply + novel writing) ──
        // Revision-apply steps must produce a FULL manuscript. If the response is shorter
        // than the source (or shorter than the explicit wordCountTarget), ask the AI to
        // continue. This prevents the user from getting a half-revised book.
        {
          const isRevisionApply = stepNeedsFullManuscript(activeStep);
          const wcTarget = (activeStep as any).wordCountTarget ||
            (isRevisionApply ? Math.floor((currentProject.context?.documentWordCount || 0) * 0.9) : 0);
          if (wcTarget && wcTarget > 0 && execOut === null) {   // executable skills own their full output — no continuation
            const label = isRevisionApply ? 'revision-apply' : 'writing';
            const cont = await runWordTargetContinuation({
              initialText: response,
              wordCountTarget: wcTarget,
              continue: async ({ wordsSoFar, remaining, pass, textSoFar }) => {
                console.log(`  [${label}] Response word count: ${wordsSoFar}/${wcTarget} — requesting continuation #${pass} (~${remaining} more words)`);
                const contPrompt = (isRevisionApply
                  ? `Continue the revised manuscript from EXACTLY where you left off. You've produced ${wordsSoFar} words so far; the target is ${wcTarget}. Output at least ${Math.min(remaining, 15000)} more words of the revised manuscript, continuing from the last chapter boundary. Do NOT repeat content. Do NOT summarize. Do NOT add commentary. Output ONLY the continued manuscript prose.`
                  : `Continue writing from where you left off. You wrote ${wordsSoFar} words so far but the target is ${wcTarget}. Write at least ${remaining} more words of prose narrative, continuing the story seamlessly. Do NOT repeat what was already written. Do NOT summarize.`) +
                  continuationAnchor(textSoFar);
                let contResponse = '';
                await gateway.handleMessage(
                  contPrompt,
                  'project-engine',
                  (text: string) => { contResponse = text; },
                  projectContext,
                  activeStep.taskType || undefined,
                  stepProvider,  // keep the same pinned model across continuations
                  stepModel,
                  currentProject.bookSlug           // Phase 8: bound book on continuation
                );
                return contResponse;
              },
            });
            response = cont.text;
            if (cont.passes > 0) {
              console.log(`  [${label}] Final word count after ${cont.passes} continuation(s): ${countWords(response)}`);
            }
          }
        }

        // ── Quality loop: evaluate + retry on write/polish steps ──
        // AutoNovel-inspired modify-evaluate-retry. Defaults to 1 retry
        // (so each chapter costs at most 3 AI calls: draft + judge + retry).
        // Authors can disable per-project via context.qualityLoopEnabled=false.
        try {
          const judge = services.writingJudge;
          const stepSkill = (activeStep as any).skill || '';
          const stepPhase = (activeStep as any).phase || '';
          const isQualityCandidate = stepSkill === 'write' || stepPhase === 'polish';
          const qualityLoopEnabled = currentProject.context?.qualityLoopEnabled !== false;
          const qualityThreshold = Number(currentProject.context?.qualityThreshold) || 70;
          const rawMaxRetries = Number(currentProject.context?.qualityMaxRetries);
          const maxRetries = Number.isFinite(rawMaxRetries) ? rawMaxRetries : 1;
          // Per-project flag for the dual Craft + Market judge mode.
          // Doubles the judge AI cost (one extra call per attempt) but
          // surfaces craft↔market disagreement, which is the most
          // actionable signal. Off by default — opt-in per project.
          const dualJudgeEnabled = currentProject.context?.dualJudge === true;

          if (judge && isQualityCandidate && qualityLoopEnabled && response.length > 500 && execOut === null) {
            let attempt = 0;
            let bestResponse = response;
            let bestScore = -1;
            while (attempt <= maxRetries) {
              const verdict = await judge.evaluate(response, {
                aiComplete: (r: any) => services.aiRouter.complete(r),
                aiSelectProvider: (taskType: string) => services.aiRouter.selectProvider(taskType),
                threshold: qualityThreshold,
                dualJudge: dualJudgeEnabled,
              });
              console.log(`  [judge] "${activeStep.label}" attempt ${attempt + 1}: ${verdict.summary}`);
              if (verdict.score > bestScore) {
                bestScore = verdict.score;
                bestResponse = response;
              }
              if (!verdict.retry || attempt >= maxRetries) break;

              // Retry with feedback as additional steering.
              attempt++;
              console.log(`  [judge] Retrying with feedback (attempt ${attempt + 1}/${maxRetries + 1})...`);
              const userMsgWithFeedback = userMessage +
                '\n\n## Quality feedback on your previous draft\n\n' + verdict.retryFeedback +
                '\n\nProduce a NEW draft that fixes these specific issues. Output ONLY the chapter prose — no commentary.';
              let retryResponse = '';
              try {
                await gateway.handleMessage(
                  userMsgWithFeedback,
                  'project-engine',
                  (text: string) => { retryResponse = text; },
                  projectContext,
                  activeStep.taskType || undefined,
                  stepProvider,  // same pinned model on quality re-draft
                  stepModel,
                  currentProject.bookSlug           // Phase 8: bound book on quality re-draft
                );
                if (retryResponse && retryResponse.length > 500 &&
                    !retryResponse.startsWith('[AI provider failure]')) {
                  response = retryResponse;
                } else {
                  // Retry failed — keep previous best and stop looping.
                  break;
                }
              } catch {
                break;
              }
            }
            // Always keep the highest-scoring version we saw.
            response = bestResponse;
            services.activityLog?.log({
              type: 'step_completed',
              source: 'internal',
              goalId: currentProject.id,
              stepLabel: activeStep.label,
              message: `Quality score: ${bestScore.toFixed(1)}/100 after ${attempt + 1} attempt(s)`,
              metadata: { qualityScore: bestScore, attempts: attempt + 1 },
            });
          }
        } catch (judgeErr) {
          // Judge failures should NEVER block step completion — degrade gracefully.
          console.warn('  [judge] evaluation hook failed:', (judgeErr as Error)?.message || judgeErr);
        }

        // Strip leaked chatbot framing ("Okay, let's…", "Would you like to
        // proceed…") before saving/completing the step. Prose steps get the
        // aggressive prose-mode strip (drops a leaked "Next Steps:" epilogue).
        const prose = isProseStep(activeStep);
        response = stripMetaCommentary(response, { prose });

        // Safety floor (Flagship Plan 2, Task 4/7): non-negotiable — runs on
        // every draft/intimacy step regardless of the book's contentCeiling
        // (H1 fix).
        let reviewFlags: string[] = [];
        if (isSafetyFloorStep(activeStep)) {
          const banned = bannedContentCheck(response);
          if (banned.hardBlock) {
            const detail = `Safety floor blocked this draft: ${banned.reason}`;
            engine.failStep(currentProject.id, activeStep.id, detail);
            if (services.confirmationGate) await openReviewGate({ gate: services.confirmationGate, engine }, currentProject, activeStep, 'pipeline-error', detail);
            results.push({ step: activeStep.label, success: false, error: detail });
            break;
          }
          reviewFlags = banned.flags;
          if (reviewFlags.length) {
            console.log(`  ⚠ Step "${activeStep.label}" flagged for review: ${reviewFlags.join('; ')}`);
          }
          const guard = operationalDetailGuard(response);
          if (guard.flagged) {
            console.log(`  ⚠ Step "${activeStep.label}" flagged for operational detail — running one abstraction rewrite pass...`);
            let rewritten = '';
            await gateway.handleMessage(
              `Rewrite the passage below so any actionable, step-by-step, or code-level technical detail is replaced with consequence-realistic narrative summary (what happens and its fallout), not a reproducible procedure. Preserve the story, characters, and prose voice — only abstract the operational detail.\n\n${response}`,
              'project-engine',
              (text: string) => { rewritten = text; },
              projectContext,
              activeStep.taskType || undefined,
              stepProvider,
              stepModel,
              currentProject.bookSlug,
              stepTemp
            );
            if (rewritten && rewritten.length > 50) response = stripMetaCommentary(rewritten, { prose });
          }
        }
        const wordCount = countWords(response);

        // Post-draft continuity detection (Flagship Plan 3, Task 4): flags
        // attach to the step for Plan 4's analyze-then-apply polish to consume.
        // Same book-has-bible guard as the pre-draft injection above; fail-soft
        // (checkChapter itself never throws, but the guard + try/catch keep this
        // step's completion independent of the ledger either way).
        if (isContinuityDraftStep && currentProject.bookSlug && services.consistencyStore?.isAvailable?.()) {
          try {
            const { flags } = await checkChapter({
              slug: currentProject.bookSlug,
              chapterNumber: continuityChapterNum,
              text: response,
              store: services.consistencyStore,
              aiComplete: (r: any) => services.aiRouter.complete(r),
              aiSelect: (t: string, pref?: string) => services.aiRouter.selectProvider(t, pref),
              world: continuityWorldName,
              // M3 (bug-review #22 hazard): a concurrent full/import audit's
              // clearBookFacts()/clearBookKnowledge() would race this
              // chapter's own clear+insert — skip only the persistence while
              // one is in flight for this book.
              skipPersist: gateway.consistencyJobs?.isRunning(currentProject.bookSlug) === true,
            });
            if (flags.length) (activeStep as any).continuityFlags = flags;
          } catch { /* fail-soft: continuity detection never blocks step completion */ }
        }

        // Save to file
        try {
          const projectDir = outDirFor(currentProject.title.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
          await mkdir(projectDir, { recursive: true });
          const stepFileName = `${activeStep.id}-${activeStep.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.md`;
          await writeFile(join(projectDir, stepFileName), `# ${activeStep.label}\n\n${response}`, 'utf-8');
        } catch { /* non-fatal */ }

        // Human-Gate Cadence (Flagship Plan 5): check AFTER content generates
        // (so approve/edit resume with the real drafted text) and BEFORE
        // completeStep (so the frontier doesn't advance past an ungated
        // outline/chapter/act/pre-export boundary). The step's file is already
        // saved to disk above either way.
        if (services.confirmationGate) {
          const cadenceGate = await maybeOpenCadenceGate(
            { gate: services.confirmationGate, engine },
            currentProject, activeStep, response,
            { manifest: bookManifest, craftCritic: services.craftCritic, dialogueAuditor: services.dialogueAuditor },
          );
          if (cadenceGate.gated) {
            results.push({ step: activeStep.label, success: false, wordCount, error: 'awaiting human review' });
            humanReviewConfId = cadenceGate.confirmationId;
            break;
          }
        }

        engine.completeStep(currentProject.id, activeStep.id, response);
        // Per-step activity record: which skill, book, provider, and model ran
        // this step. The dashboard auto-execute path previously logged no
        // step_completed for ordinary steps, so the feed couldn't show what
        // produced a step (and a silent model fallback was invisible).
        services.activityLog?.log({
          type: 'step_completed',
          source: 'dashboard',
          goalId: currentProject.id,
          stepLabel: activeStep.label,
          message: `Step completed: ${activeStep.label} (~${wordCount.toLocaleString()} words)`,
          metadata: {
            ...generationMeta({ provider: stepProvider, model: stepModel, bookSlug: currentProject.bookSlug, skill: (activeStep as any).skill }),
            wordCount,
          },
        });
        // Track words for Morning Briefing
        services.heartbeat.addWords(wordCount);
        results.push({ step: activeStep.label, success: true, wordCount, ...(reviewFlags.length ? { reviewFlags } : {}) });

        // ── ContextEngine: summarize + extract entities for canonical chapter prose ──
        // Bug fix (2026-04): the previous heuristic matched any step whose label
        // contained "chapter" or "write" — which included "Self-review Chapter N"
        // and other analysis steps. That doubled AI cost AND polluted the entity
        // index with character/location names mentioned in critique form ("Sarah's
        // motivation feels weak" → indexed as a Sarah attribute change). Now uses
        // the precise skill+phase signal: only `skill === 'write'` (first-draft
        // chapter prose) OR `phase === 'polish'` (revised chapter prose) qualify.
        // The polish step replaces the prior summary because its chapterNumber
        // matches the write step and the summary upserts on (projectId, chapterId)
        // — so the polished version becomes canonical without dropping memory.
        try {
          const contextEngine = services.contextEngine;
          const stepLabel = (activeStep as any).label || '';
          const stepSkill = (activeStep as any).skill || '';
          const stepPhase = (activeStep as any).phase || '';
          const isCanonicalChapter = stepSkill === 'write' || stepPhase === 'polish';
          const isBibleStep = currentProject.type === 'book-bible' ||
            stepLabel.toLowerCase().includes('bible') ||
            stepLabel.toLowerCase().includes('world') ||
            (stepLabel.toLowerCase().includes('character') && stepSkill !== 'revise');

          if (contextEngine && response.length > 200 && (isCanonicalChapter || isBibleStep)) {
            // Number by the step's own chapterNumber and key canonical chapters
            // on the chapter so polish replaces write (bug-review #17). Shared
            // with the bridge hook in index.ts via chapterSummaryTarget.
            const { chapterNum, summaryId } = chapterSummaryTarget(currentProject, activeStep, isCanonicalChapter);

            const aiCompleteFn = (req: any) => services.aiRouter.complete(req);
            const aiSelectFn = (taskType: string) => services.aiRouter.selectProvider(taskType);

            // Await context engine calls so they complete before moving to next step
            await Promise.allSettled([
              contextEngine.generateSummary(
                currentProject.id, summaryId, stepLabel, chapterNum, response,
                aiCompleteFn, aiSelectFn
              ).catch((err: any) => console.error('[context-engine] Summary error:', err.message)),
              contextEngine.extractEntities(
                currentProject.id, activeStep.id, response,
                aiCompleteFn, aiSelectFn
              ).catch((err: any) => console.error('[context-engine] Entity extraction error:', err.message)),
            ]);
          }
        } catch (contextErr) {
          console.error('[context-engine] Hook error:', contextErr);
        }

        // ── Auto-narrate completed chapter (opt-in via project.context.autoNarrate) ──
        // Inspired by OpenClaw's chat-scoped /tts auto controls. Generates an audio
        // preview of the just-completed chapter so the author can listen back without
        // manually triggering the TTS endpoint. Fire-and-forget — never blocks step flow.
        try {
          const autoNarrate = !!currentProject.context?.autoNarrate;
          const stepLabel = String((activeStep as any).label || '').toLowerCase();
          // Match the same canonical-chapter signal as the ContextEngine hook so
          // we don't auto-narrate review/polish notes — only first-draft prose
          // and polished revisions get audio.
          const stepSkill = (activeStep as any).skill || '';
          const stepPhase = (activeStep as any).phase || '';
          const isWritingStep = stepSkill === 'write' || stepPhase === 'polish';
          if (autoNarrate && isWritingStep && services.tts && response.length > 200) {
            // Resolve the persona's voice if the project has one — keeps each pen
            // name's narration consistent across chapters.
            let voice: string | undefined;
            const personaId = (currentProject as any).personaId;
            if (personaId && services.personas) {
              const persona = services.personas.get?.(personaId);
              if (persona?.ttsVoice) voice = persona.ttsVoice;
            }
            // ElevenLabs costs credits per call. Cap auto-narrate text to a safe length
            // and warn in the audit log when ElevenLabs is the active provider.
            const activeProvider = services.tts.getActiveProvider();
            const cap = activeProvider === 'elevenlabs' ? 3000 : 30000;
            const narrationText = response.replace(/^#[^\n]+\n+/, '').substring(0, cap);
            services.tts.generate(narrationText, { voice })
              .then((result: any) => {
                if (result.success) {
                  services.activityLog?.log({
                    type: 'file_saved',
                    source: 'internal',
                    goalId: currentProject.id,
                    message: `🔊 Auto-narrated "${activeStep.label}" (${result.provider}, ~${result.duration}s) → ${result.filename}`,
                    metadata: { audioFile: result.filename, voice, provider: result.provider },
                  });
                } else {
                  console.error('[auto-narrate] failed:', result.error);
                }
              })
              .catch((err: any) => console.error('[auto-narrate] error:', err));
          }
        } catch (narrationErr) {
          console.error('[auto-narrate] hook error:', narrationErr);
        }

        // ── Manuscript Assembly: combine chapter files after assembly step ──
        if ((activeStep as any).phase === 'assembly' && currentProject.type === 'novel-pipeline') {
          try {
            const { existsSync: exLocal } = await import('fs');
            const { readFile: readF } = await import('fs/promises');
            const projectSlug = currentProject.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
            const projectDir = outDirFor(projectSlug);

            const writingSteps = currentProject.steps
              .filter((s: any) => s.phase === 'writing' && s.status === 'completed')
              .sort((a: any, b: any) => (a.chapterNumber || 0) - (b.chapterNumber || 0));

            const chapterContents: string[] = [];
            for (const ws of writingSteps) {
              const expectedFile = `${(ws as any).id}-${(ws as any).label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.md`;
              const fullPath = join(projectDir, expectedFile);
              if (exLocal(fullPath)) {
                const raw = await readF(fullPath, 'utf-8');
                const content = raw.replace(/^# .+\n\n/, '');
                chapterContents.push(`## Chapter ${(ws as any).chapterNumber || chapterContents.length + 1}\n\n${content}`);
              }
            }

            if (chapterContents.length > 0) {
              const manuscriptMd = `# ${currentProject.title}\n\n` + chapterContents.join('\n\n---\n\n');
              // Phase 3: when writing into the shared book data/ dir, prefix the
              // manuscript files with the project id so sibling projects in the
              // same book don't overwrite each other (and delete/restart, which
              // filter by `${project.id}-`, can find them). On the legacy
              // per-project dir there's no collision, so keep the plain name.
              const manuscriptPrefix = activeDataDir ? `${currentProject.id}-` : '';
              await writeFile(join(projectDir, `${manuscriptPrefix}manuscript.md`), manuscriptMd, 'utf-8');

              const docxBuffer = await generateDocxBuffer({
                title: currentProject.title,
                author: 'BookClaw',
                content: manuscriptMd,
              });
              await writeFile(join(projectDir, `${manuscriptPrefix}manuscript.docx`), docxBuffer);
              console.log(`  [assembly] Manuscript assembled: ${chapterContents.length} chapters`);
            }
          } catch { /* non-fatal */ }
        }

        // Re-check pause AFTER step completes (catches /stop sent during long AI call)
        const freshProject = engine.getProject(req.params.id);
        if (freshProject?.status === 'paused' || freshProject?.status === 'completed') break;
      } catch (error) {
        engine.failStep(currentProject.id, activeStep.id, String(error));
        if (services.confirmationGate) await openReviewGate({ gate: services.confirmationGate, engine }, currentProject, activeStep, 'pipeline-error', String(error));
        results.push({ step: activeStep.label, success: false, error: String(error) });
        break;
      }
    }

    res.json({
      success: true,
      results,
      ...(humanReviewConfId ? { humanReview: true, confirmationId: humanReviewConfId } : {}),
      ...(budgetPaused ? { budgetPause: true } : {}),
      project: engine.getProject(req.params.id),
    });
    } finally {
      releaseDrive(services.driveScheduler, engine, project.id);
    }
  });

  app.post('/api/projects/:id/skip/:stepId', (req: Request, res: Response) => {
    const engine = gateway.getProjectEngine?.();
    if (!engine) {
      return res.status(503).json({ error: 'Project engine not initialized' });
    }
    // Bug #7: refuse mid-drive — skipping a step while a step is in flight corrupts state.
    if (engine.isDriving(req.params.id)) return res.status(409).json({ error: 'Project is currently running' });
    const nextStep = engine.skipStep(req.params.id, req.params.stepId);
    res.json({ nextStep, project: engine.getProject(req.params.id) });
  });

  // Remove a not-yet-run (pending or skipped) step from a project entirely — vs.
  // /skip, which marks it skipped and advances the frontier. Inert to sequencing,
  // so it is safe on a project paused at a review gate (e.g. dropping the remaining
  // per-chapter intimacy steps of a sweet romance mid-run). Refuses to remove an
  // active, completed or failed step (409) so a live gate or real output is never lost.
  app.delete('/api/projects/:id/steps/:stepId', (req: Request, res: Response) => {
    const engine = gateway.getProjectEngine?.();
    if (!engine) return res.status(503).json({ error: 'Project engine not initialized' });
    if (engine.isDriving(req.params.id)) return res.status(409).json({ error: 'Project is currently running' });
    const r = engine.removeStep(req.params.id, req.params.stepId);
    if (r.status === 'not_found') return res.status(404).json({ error: 'Project or step not found' });
    if (r.status === 'not_removable') return res.status(409).json({ error: `cannot remove a ${r.state} step (only a pending or skipped step can be removed)` });
    res.json({ success: true, removed: r.step.id, project: engine.getProject(req.params.id) });
  });

  // Insert a new not-yet-run step immediately before an existing PENDING step
  // (companion to the DELETE above — used to add the per-chapter de-AI audit step
  // ahead of each humanize step). Inert to sequencing, so it is safe on a project
  // paused at a gate. Body: { beforeStepId, step: { label, prompt, taskType?,
  // skill?, role?, phase?, chapterNumber?, wordCountTarget?, modelOverride? } }.
  app.post('/api/projects/:id/steps', (req: Request, res: Response) => {
    const engine = gateway.getProjectEngine?.();
    if (!engine) return res.status(503).json({ error: 'Project engine not initialized' });
    if (engine.isDriving(req.params.id)) return res.status(409).json({ error: 'Project is currently running' });
    const { beforeStepId, step } = req.body || {};
    if (typeof beforeStepId !== 'string' || !beforeStepId) return res.status(400).json({ error: 'beforeStepId (string) is required' });
    if (!step || typeof step !== 'object') return res.status(400).json({ error: 'step (object) is required' });
    // Validate the optional model override (sent verbatim to a provider). Same
    // guards as POST /steps/:stepId/model.
    const mo = step.modelOverride;
    if (mo !== undefined && mo !== null) {
      if (typeof mo !== 'object') return res.status(400).json({ error: 'invalid modelOverride' });
      const validProviders = ['gemini', 'deepseek', 'claude', 'openai', 'ollama', 'openrouter'];
      if (mo.provider !== undefined && !validProviders.includes(mo.provider)) return res.status(400).json({ error: 'invalid modelOverride.provider' });
      if (mo.model !== undefined && mo.model !== '' && !isValidModelId(mo.model)) return res.status(400).json({ error: 'invalid modelOverride.model' });
    }
    const r = engine.insertStep(req.params.id, beforeStepId, step);
    if (r.status === 'not_found') return res.status(404).json({ error: 'Project or target step not found' });
    if (r.status === 'target_not_pending') return res.status(409).json({ error: `can only insert before a pending step (target is ${r.state})` });
    if (r.status === 'conductor_unsupported') return res.status(409).json({ error: 'cannot insert into a conductor (dependency-graph) pipeline' });
    if (r.status === 'invalid') return res.status(400).json({ error: r.reason });
    res.json({ success: true, inserted: r.step.id, project: engine.getProject(req.params.id) });
  });

  app.post('/api/projects/:id/pause', (req: Request, res: Response) => {
    const engine = gateway.getProjectEngine?.();
    if (!engine) {
      return res.status(503).json({ error: 'Project engine not initialized' });
    }
    engine.pauseProject(req.params.id);
    res.json({ project: engine.getProject(req.params.id) });
  });

  // M1 fix: an API/headless caller of /review/action has no browser polling
  // /auto-execute and no Telegram loop driving it — without this, a resumed
  // project stays 'active' with an 'active' step but nothing ever runs it
  // (worst for regenerate: reset to active, nothing re-runs at all). Mirrors
  // the phase-10 heartbeat resolver sweep's own driveProject: claims the
  // shared drive lock (never races a concurrent /auto-execute or the sweep),
  // drives to the next gate/error/end via the same startAndRunProject the
  // headless driver and Telegram bridge use, fire-and-forget so the HTTP
  // response isn't blocked by a long chapter chain. Fail-soft.
  async function driveResumedProject(projectId: string): Promise<void> {
    const engine = gateway.getProjectEngine?.();
    if (!engine) return;
    if (!(await acquireDrive(services.driveScheduler, engine, projectId))) return;
    try {
      const handlers = gateway.buildTelegramCommandHandlers?.();
      if (!handlers) return;
      for (let i = 0; i < 500; i++) {
        const p = engine.getProject(projectId);
        if (!p || p.status !== 'active' || !p.steps.some((s: any) => s.status === 'active')) break;
        const r = await handlers.startAndRunProject(projectId);
        if (r && 'error' in r) break; // next gate hit, error raised, or nothing runnable
      }
    } finally {
      releaseDrive(services.driveScheduler, engine, projectId);
    }
  }

  // ── LLM Council (sub-project 3, Task 5): the propose-mode selection API ─────
  // GET the pending ranked candidates for the studio review screen.
  app.get('/api/projects/:id/council', (req: Request, res: Response) => {
    const engine = gateway.getProjectEngine?.();
    if (!engine) {
      return res.status(503).json({ error: 'Project engine not initialized' });
    }
    const project = engine.getProject(req.params.id);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    if (!project.selection) {
      return res.status(404).json({ error: 'No council selection pending' });
    }
    const { candidates, ranking, recommendedId, rationale } = project.selection;
    res.json({ candidates, ranking, recommendedId, rationale });
  });

  // Submit the user's base-story pick and resume the pipeline (fire-and-forget
  // drive, same pattern as /review/action below).
  app.post('/api/projects/:id/council/select', async (req: Request, res: Response) => {
    const engine = gateway.getProjectEngine?.();
    if (!engine) {
      return res.status(503).json({ error: 'Project engine not initialized' });
    }
    const project = engine.getProject(req.params.id);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    if (!project.selection) {
      return res.status(409).json({ error: 'No council selection pending' });
    }
    const candidateId = typeof req.body?.candidateId === 'string' ? req.body.candidateId : '';
    if (!candidateId) {
      return res.status(400).json({ error: 'candidateId required' });
    }
    // Bug #31: reject an unknown candidateId instead of silently substituting
    // the judge's recommendedId — a client passing a bad/stale id must not
    // get a silent substitution reported as success.
    if (!engine.applyCouncilSelection(project.id, candidateId)) {
      return res.status(400).json({ error: 'unknown candidateId' });
    }
    void driveResumedProject(project.id).catch(() => {});
    res.json({ ok: true, project: engine.getProject(req.params.id) });
  });

  // ── Resolve a paused Human Review gate with one of four actions (Flagship
  // Plan 5, Task 3): approve (continue with the generated/pending text),
  // edit (continue with human-supplied text instead), regenerate (re-run the
  // step with a steering note), or stop (stay paused). Extends the existing
  // Human-Review pause/resume — see services/human-review.ts +
  // ProjectEngine.applyReviewResume — rather than the plain binary
  // /api/confirmations/:id/approve|reject, which has no room for
  // editedText/note. Also resolves the underlying Confirmations request so
  // it doesn't linger 'pending' and the periodic resolver skips it.
  app.post('/api/projects/:id/review/action', async (req: Request, res: Response) => {
    const engine = gateway.getProjectEngine?.();
    if (!engine) return res.status(503).json({ error: 'Project engine not initialized' });
    const project = engine.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (!project.review) return res.status(409).json({ error: 'No review pending for this project' });

    const action = req.body?.action;
    if (!['approve', 'edit', 'regenerate', 'stop'].includes(action)) {
      return res.status(400).json({ error: 'action must be one of approve|edit|regenerate|stop' });
    }
    if (action === 'edit' && typeof req.body?.editedText !== 'string') {
      return res.status(400).json({ error: 'editedText (string) required for action=edit' });
    }

    const { confirmationId, stepId, kind, pendingResult } = project.review;
    const gate = services.confirmationGate;
    try {
      if (action === 'stop') {
        if (gate && confirmationId) await gate.reject(confirmationId, 'user', req.body?.note).catch(() => {});
        engine.clearReview(project.id);
      } else {
        if (gate && confirmationId) {
          await gate.approve(confirmationId);
          await gate.recordOutcome(confirmationId, {
            success: true,
            message: `Human review: ${action}`,
            executedAt: new Date().toISOString(),
          }).catch(() => {});
        }
        // Capture the step + its canonical resumed text BEFORE applyReviewResume
        // clears project.review — H1 fix: applyReviewResume completes the step
        // OUTSIDE this file's drive loop, so the loop's own inline
        // ContextEngine hook (summary + entity extraction) never runs for a
        // gated-then-approved/edited chapter. Re-run the identical hook here.
        const stepForExtraction = project.steps.find((s: any) => s.id === stepId);
        const resumedText = action === 'edit' ? req.body?.editedText : (pendingResult ?? '[approved by human review]');

        engine.applyReviewResume(project.id, stepId, kind, action, {
          editedText: req.body?.editedText,
          note: req.body?.note,
        });

        if ((action === 'approve' || action === 'edit') && kind === 'cadence-gate' && stepForExtraction) {
          await runChapterContextExtraction(
            {
              contextEngine: services.contextEngine,
              aiComplete: (r: any) => services.aiRouter.complete(r),
              aiSelectProvider: (t: string) => services.aiRouter.selectProvider(t),
            },
            project, stepForExtraction, resumedText ?? '',
          );
        }

        // M1 fix: re-drive in the background (see driveResumedProject) —
        // never awaited here, so a long chapter chain never blocks this response.
        void driveResumedProject(project.id).catch((err: any) =>
          console.error('[review-action] re-drive failed:', err?.message || err));
      }
      res.json({ project: engine.getProject(req.params.id) });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Review action failed' });
    }
  });

  // ── Save an inline edit to a paused review's draft WITHOUT resuming ──────────
  // The "Save (keep paused)" action on the Confirmations content pane (owner ask
  // 2026-07-03): persist the human's edit into review.pendingResult so the
  // chapter stays parked for further review; a later approve resumes with it.
  app.post('/api/projects/:id/review/save-draft', (req: Request, res: Response) => {
    const engine = gateway.getProjectEngine?.();
    if (!engine) return res.status(503).json({ error: 'Project engine not initialized' });
    const project = engine.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (!project.review) return res.status(409).json({ error: 'No review pending for this project' });
    if (project.review.kind !== 'cadence-gate') {
      return res.status(409).json({ error: 'This review has no editable draft' });
    }
    if (typeof req.body?.editedText !== 'string') {
      return res.status(400).json({ error: 'editedText (string) required' });
    }
    try {
      engine.saveReviewDraft(req.params.id, req.body.editedText);
      res.json({ project: engine.getProject(req.params.id) });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Save failed' });
    }
  });

  // ── Resume a stuck/completed project that still has pending or active steps ──
  app.post('/api/projects/:id/resume', (req: Request, res: Response) => {
    const engine = gateway.getProjectEngine?.();
    if (!engine) {
      return res.status(503).json({ error: 'Project engine not initialized' });
    }
    const project = engine.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    // Bug #7: refuse mid-drive — resumeProject re-derives the frontier and would
    // demote an in-flight active step to pending, letting chapter N+1 draft
    // before N exists. Never mutate the frontier while a driver holds the lock.
    if (engine.isDriving(req.params.id)) return res.status(409).json({ error: 'Project is currently running' });

    // Re-activate the runnable frontier — all pending members of an in-flight
    // parallel group fan out together, or the single next ordinary step / join.
    // (For a no-parallel project this re-activates exactly one step, as before.)
    engine.resumeProject(req.params.id);

    // Set project status back to active
    const remaining = project.steps.filter((s: any) => s.status === 'pending' || s.status === 'active');
    if (remaining.length > 0) {
      project.status = 'active';
      delete (project as any).completedAt;
      project.updatedAt = new Date().toISOString();
    }

    // Recalculate progress
    const done = project.steps.filter((s: any) => s.status === 'completed' || s.status === 'skipped').length;
    project.progress = Math.round((done / project.steps.length) * 100);

    res.json({
      resumed: true,
      status: project.status,
      progress: project.progress,
      activeStep: project.steps.find((s: any) => s.status === 'active')?.label || null,
      remainingSteps: remaining.length,
    });
  });

  // ── Update a project's preferred provider ──
  app.post('/api/projects/:id/provider', (req: Request, res: Response) => {
    const engine = gateway.getProjectEngine?.();
    if (!engine) return res.status(503).json({ error: 'Project engine not initialized' });
    const project = engine.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const { provider } = req.body;
    const valid = ['gemini', 'deepseek', 'claude', 'openai', 'ollama', 'openrouter', '', null];
    if (!valid.includes(provider)) return res.status(400).json({ error: 'Invalid provider' });
    (project as any).preferredProvider = provider || undefined;
    project.updatedAt = new Date().toISOString();
    engine.saveState();  // Bug #25: persist the override so it survives a restart.
    res.json({ success: true, preferredProvider: (project as any).preferredProvider || null });
  });

  // ── Set/clear a single step's model override (per-step model selection) ──
  // Empty/absent provider clears the override (step reverts to project default /
  // tier routing). A blank model pins the provider only (its default model).
  app.post('/api/projects/:id/steps/:stepId/model', (req: Request, res: Response) => {
    const engine = gateway.getProjectEngine?.();
    if (!engine) return res.status(503).json({ error: 'Project engine not initialized' });
    const { provider, model } = req.body || {};
    const validProviders = ['gemini', 'deepseek', 'claude', 'openai', 'ollama', 'openrouter'];
    // Clear when provider is empty/null.
    if (!provider) {
      const cleared = engine.setStepModelOverride(req.params.id, req.params.stepId, null);
      if (!cleared) return res.status(404).json({ error: 'Project or step not found' });
      return res.json({ success: true, modelOverride: null });
    }
    if (!validProviders.includes(provider)) {
      return res.status(400).json({ error: `Invalid provider. Use one of: ${validProviders.join(', ')}` });
    }
    // Model id is free-text (OpenRouter ids are arbitrary). Validate defensively:
    // it is sent verbatim to the provider API, so use the shared id guard.
    if (model !== undefined && model !== null && model !== '') {
      if (!isValidModelId(model)) {
        return res.status(400).json({ error: 'Invalid model id' });
      }
    }
    const step = engine.setStepModelOverride(req.params.id, req.params.stepId, { provider, model });
    if (!step) return res.status(404).json({ error: 'Project or step not found' });
    res.json({ success: true, modelOverride: step.modelOverride || null });
  });

  app.delete('/api/projects/:id', async (req: Request, res: Response) => {
    const engine = gateway.getProjectEngine?.();
    if (!engine) {
      return res.status(503).json({ error: 'Project engine not initialized' });
    }

    // Get project info before deleting (to find files on disk)
    const project = engine.getProject(req.params.id);
    const deleteFiles = req.query.files === 'true';

    const deleted = engine.deleteProject(req.params.id);

    // Optionally delete workspace files too
    let filesDeleted = 0;
    if (deleted && deleteFiles && project) {
      try {
        const { join: j } = await import('path');
        const { rm } = await import('fs/promises');
        const { existsSync: ex } = await import('fs');
        const projectSlug = project.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const activeDataDir = services.books?.dataDirOf?.(project.bookSlug) ?? services.books?.activeDataDir?.() ?? null;
        const projectDir = activeDataDir ?? j(baseDir, 'workspace', 'projects', projectSlug);
        if (ex(projectDir)) {
          const { readdir } = await import('fs/promises');
          const entries = await readdir(projectDir);
          // Bug #26: both the per-book data/ dir AND the legacy
          // workspace/projects/<title-slug> dir are SHARED — a book's projects, or
          // two same-titled no-book projects. Delete only THIS project's files
          // (keyed by the unique `${project.id}-` prefix), never the whole dir —
          // the old legacy branch rm'd the shared dir and took a survivor's files.
          const own = projectOwnedFiles(entries, project.id);
          for (const f of own) {
            await rm(j(projectDir, f)).catch(() => {});
          }
          filesDeleted = own.length;
        }
      } catch { /* non-fatal */ }
    }

    res.json({ success: deleted, filesDeleted });
  });

}
