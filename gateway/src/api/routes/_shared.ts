/**
 * Shared utilities for the split route mounters.
 *
 * safePath, the multer upload instance, the Wave-3 disclaimer header, and a
 * baseDir-factory for gatherChapters — all hoisted out of routes.ts so the
 * per-feature mounters can share them (one-way dep: routes.ts -> mounters).
 */
import path from 'path';
import multer from 'multer';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { castStep } from '../../services/casting/cast-step.js';
import { loadCastingSheet } from '../../services/casting/casting-sheet.js';
import { isStepRole } from '../../services/casting/roles.js';
import { intimacyDecision, type IntimacyDecision } from '../../services/casting/heat.js';
import { classifyScene } from '../../services/casting/heat-classify.js';
import { profanityInjection } from '../../services/casting/profanity.js';
import { runGroundingResearch } from '../../services/pipeline/grounding-research.js';
import {
  runIdeationEnsemble, selectPitch, resolvePanelMemberProvider, resolveEnsemblePanel, loadIdeationAngles,
  type EnsemblePitch, type SelectPitchResult,
} from '../../services/pipeline/ideation-ensemble.js';
import { analyzeChapter, describeFindings } from '../../services/pipeline/analyze-apply.js';
import { renderBetaReaderReport } from '../../services/reports/render-beta-reader.js';

/**
 * Wrap an async Express handler so a rejected promise is routed to next(err)
 * (and thence the error middleware) instead of becoming an unhandled rejection.
 * Express 4 does NOT await/await-catch async handlers itself, and Node 22
 * terminates the process on an unhandled rejection — so any unguarded `await`
 * that rejects inside a route would otherwise crash the whole gateway. Apply
 * this to mutating async handlers that don't already have a try/catch.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>,
): RequestHandler {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

/**
 * Shared preamble for confirmation-gated "finalize" handlers. Looks up the
 * confirmation by id, verifies it belongs to the expected service, and requires
 * it to be in the `approved` state. Returns a discriminated result so callers
 * keep their own finalize action while sharing the (previously hand-rolled,
 * drifted) lookup/validation logic and consistent 404/409 mappings.
 *
 *   const gate = requireApprovedConfirmation(services.confirmationGate, { id, expectedService: 'book-transfer' });
 *   if (!gate.ok) return res.status(gate.status).json({ error: gate.error });
 *   // ... finalize using gate.request.payload ...
 */
export function requireApprovedConfirmation(
  confirmationGate: any,
  opts: { id: string; expectedService: string },
):
  | { ok: true; request: any }
  | { ok: false; status: number; error: string } {
  const { id, expectedService } = opts;
  if (!id) return { ok: false, status: 400, error: 'confirmationId required' };
  const { status, request } = confirmationGate.checkDecision(id);
  if (!request || request.service !== expectedService) {
    return { ok: false, status: 404, error: 'no such confirmation' };
  }
  if (status !== 'approved') {
    return { ok: false, status: 409, error: `confirmation is ${status} (must be approved)` };
  }
  return { ok: true, request };
}

/** Verify resolved path stays within the allowed base directory. */
export function safePath(base: string, userInput: string): string | null {
  const resolved = path.resolve(base, userInput);
  const resolvedBase = path.resolve(base);
  if (!resolved.startsWith(resolvedBase + path.sep) && resolved !== resolvedBase) return null;
  return resolved;
}

/**
 * Stream a stored file to the client with XSS-safe headers (file-explorer read
 * endpoints). A user-supplied file is NEVER served with an active MIME type on
 * the app origin: inert previewable text (md/txt/json/…) goes out as
 * `text/plain; charset=utf-8` inline; everything else (and any `download`) is
 * forced to `application/octet-stream` + `Content-Disposition: attachment`.
 * `X-Content-Type-Options: nosniff` is always set so the browser can't sniff a
 * payload up to an active type. Caller must validate the path first (safePath).
 */
export async function serveFile(res: Response, filePath: string, filename: string, download = false): Promise<void> {
  const { createReadStream } = await import('fs');
  const { isPreviewableText } = await import('../../services/file-preview.js');
  const safeName = filename.replace(/[\r\n"]/g, '');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (!download && isPreviewableText(filename)) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  } else {
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
  }
  createReadStream(filePath)
    .on('error', () => { try { res.destroy(); } catch {} })
    .pipe(res);
}

/** Shared multer instance: 50MB limit, .txt/.md/.docx only, in-memory storage. */
export const upload = multer({
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max (up from 10MB for novel uploads)
  fileFilter: (_req, file, cb) => {
    const allowed = ['.txt', '.md', '.docx'];
    const ext = '.' + (file.originalname.split('.').pop() || '').toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`File type "${ext}" not supported. Use .txt, .md, or .docx`));
    }
  },
  storage: multer.memoryStorage(),
});

/** Multer for .zip book imports — 200MB, .zip only, in-memory. */
export const uploadZip = multer({
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = file.originalname.toLowerCase().endsWith('.zip')
      || file.mimetype === 'application/zip' || file.mimetype === 'application/x-zip-compressed';
    if (ok) cb(null, true); else cb(new Error('Only .zip files are supported'));
  },
  storage: multer.memoryStorage(),
});

/**
 * Resolve the effective AI provider + model + temperature for executing a
 * project step, for passing to handleMessage(..., preferredProvider,
 * overrideModel, bookSlug, overrideTemperature).
 * Precedence: a spiceRoute (a flagged intimate/violent scene re-routed to an
 * uncensored provider — Flagship Plan 2) beats everything; otherwise the
 * step's own modelOverride wins; otherwise the project-level preferredProvider
 * applies; model and temperature are pinned only when the step sets them.
 * Returns undefined fields when nothing is pinned (→ tier routing, today's
 * default behavior).
 */
export function stepRouting(
  project: any,
  step: any,
  spiceRoute?: { provider: string; model?: string } | null,
): { provider: string | undefined; model: string | undefined; temperature: number | undefined } {
  const role = isStepRole(step?.role) ? step.role : undefined;

  // Backward compatibility: an untagged step keeps today's behavior exactly —
  // manual pin, then the project-level preference applied to the whole step.
  // spiceRoute only applies to tagged (role-aware) steps.
  if (!role) {
    return {
      provider: step?.modelOverride?.provider || project?.preferredProvider || undefined,
      model: step?.modelOverride?.model || project?.preferredModel || undefined,
      temperature: typeof step?.modelOverride?.temperature === 'number' ? step.modelOverride.temperature : undefined,
    };
  }

  // Tagged step: resolve via the casting sheet + castStep. The project preference
  // is treated as the author's prose-model pick (applies to prose roles only).
  const genre = project?.genre ?? project?.context?.genre;
  const sheet = genre ? loadCastingSheet(String(genre)) : null;
  const proseModel = project?.preferredProvider
    ? { provider: project.preferredProvider, model: project.preferredModel }
    : undefined;
  const r = castStep({ step: { role, modelOverride: step?.modelOverride }, sheet, proseModel, spiceRoute: spiceRoute ?? null });
  return { provider: r.provider, model: r.model, temperature: r.temperature };
}

export interface IntimacyRoutingResult {
  /** True when this step is under intimacy routing (draft/intimacy role + book.contentCeiling set). */
  active: boolean;
  spiceRoute: { provider: string; model?: string } | null;
  /** Intimacy-template + profanity-injection text to append to the step's prompt/context. Empty when inactive or on-page below the template threshold isn't reached. */
  promptAddition: string;
  decision: IntimacyDecision | null;
  /** Recompute the decision with refusalEscalated:true (reusing the same score/ceiling/ladder/genre) — call when the on-page attempt comes back empty/refused. */
  recomputeOnRefusal: () => IntimacyDecision | null;
}

const INACTIVE_INTIMACY_ROUTING: IntimacyRoutingResult = {
  active: false, spiceRoute: null, promptAddition: '', decision: null, recomputeOnRefusal: () => null,
};

/**
 * Heat-check + intimacy-branch routing for a draft/intimacy-role chapter step
 * (Flagship Plan 2, Task 7). Runs `classifyScene` against the step's already-
 * assembled scene-brief text, combines the score with the book's contentCeiling
 * + the genre casting sheet's heatLadder via intimacyDecision(), and resolves
 * the intimacy template + any per-character profanity injections.
 *
 * Entirely a no-op (± the fixed INACTIVE result, no AI call) for any step that
 * isn't role draft/intimacy, isn't bound to a book, or whose book has no
 * contentCeiling — a fade-to-black book is byte-for-byte unaffected.
 */
export async function resolveIntimacyRouting(opts: {
  services: any;
  project: any;
  step: any;
  sceneBriefText: string;
}): Promise<IntimacyRoutingResult> {
  const { services, project, step, sceneBriefText } = opts;
  const role = isStepRole(step?.role) ? step.role : undefined;
  if (role !== 'draft' && role !== 'intimacy') return INACTIVE_INTIMACY_ROUTING;
  if (!project?.bookSlug || !services?.books?.open) return INACTIVE_INTIMACY_ROUTING;

  let manifest: any;
  try { manifest = (await services.books.open(project.bookSlug))?.manifest; } catch { return INACTIVE_INTIMACY_ROUTING; }
  const ceiling = manifest?.contentCeiling ?? null;
  if (!ceiling) return INACTIVE_INTIMACY_ROUTING; // no ceiling declared → fade-to-black, untouched

  const genre = String(project?.context?.genre ?? manifest?.pulledFrom?.genre?.name ?? 'romance');
  const sheet = loadCastingSheet(genre);
  const ladder = sheet?.heatLadder ?? null;
  const complete = (req: any) => services.aiRouter.complete(req);
  // classifyScene requires a concrete provider (C1 fix): resolve one via the
  // cheap 'general' tier rather than leaving request.provider undefined,
  // which made AIRouter.complete throw and the whole feature go inert.
  const classifierProvider = services.aiRouter.selectProvider('general');
  const score = await classifyScene(sceneBriefText, complete, { provider: classifierProvider.id });
  const decision = intimacyDecision({ score, ceiling, ladder, genre });

  let promptAddition = '';
  if (decision.template) {
    try {
      const { readFileSync, existsSync } = await import('fs');
      const { join } = await import('path');
      const templatePath = join(process.cwd(), decision.template);
      if (existsSync(templatePath)) promptAddition += `\n\n${readFileSync(templatePath, 'utf-8')}`;
    } catch { /* fail-soft: template unreadable — the draft still routes correctly */ }
    // M1: the ceiling clamp (effectiveSpice/violence) was computed but never
    // told to the model — spell out the hard cap so a scene that would score
    // higher than the ceiling is actually written to the ceiling, not just
    // routed as if it were.
    promptAddition += `\n\n[Content ceiling: write intimacy at heat level ${decision.effectiveSpice}/10 and violence at ${ceiling.violence}/10 MAX — do not exceed this; if the scene would go further, keep it at the ceiling.]`;
  }
  // M2: per-character profanity injections are independent of heat — apply to
  // every draft/intimacy step for a book with a declared ceiling, whether or
  // not THIS scene is itself heat-flagged (i.e. even in fade mode, where
  // decision.template is null).
  try {
    const store = await services.characterVoices?.getProjectVoices?.(project.id);
    if (store?.characters) {
      for (const c of Object.values(store.characters) as any[]) {
        const block = profanityInjection({ name: c.characterName, profanity: c.profanity });
        if (block) promptAddition += `\n\n${block}`;
      }
    }
  } catch { /* fail-soft */ }

  return {
    active: true,
    spiceRoute: decision.spiceRoute,
    promptAddition,
    decision,
    recomputeOnRefusal: () => intimacyDecision({ score, ceiling, ladder, refusalEscalated: true, genre }),
  };
}

/**
 * Grounding-research phase seam (Flagship Plan 4, Task 1).
 *
 * Injects sourced facts (`runGroundingResearch`) into a book-bible phase's
 * step context. A no-op unless the step is role `bible`, the project is bound
 * to a book, and both research services are wired. Result is cached on
 * `project.context.groundingResearch` so the book-bible pipeline's several
 * bible-role steps share ONE lookup instead of re-hitting the research API
 * per step. Guarded by the book's `grounding.enabled` (default true — absent
 * or any value other than `false` runs it).
 */
export async function resolveGroundingBlock(opts: {
  services: any;
  project: any;
  step: any;
  researchDir: string;
  /** Injectable for tests; defaults to a real recursive fs write. */
  writeFile?: (path: string, content: string) => Promise<void>;
}): Promise<{ groundingBlock: string }> {
  const { services, project, step, researchDir } = opts;
  const NOOP = { groundingBlock: '' };
  if (!isStepRole(step?.role) || step.role !== 'bible') return NOOP;
  if (!project?.bookSlug || !services?.books?.open) return NOOP;
  if (!services.research || !services.researchLookup) return NOOP;

  const cached = project.context?.groundingResearch;
  if (cached && typeof cached.citedFacts === 'string') {
    return { groundingBlock: formatGroundingBlock(cached) };
  }

  let manifest: any;
  try { manifest = (await services.books.open(project.bookSlug))?.manifest; } catch { return NOOP; }
  if (manifest?.grounding?.enabled === false) return NOOP;

  const genre = String(manifest?.pulledFrom?.genre?.name ?? project?.context?.genre ?? 'fiction');
  const domain = project?.description ? String(project.description).slice(0, 200) : undefined;
  // L3 (code-review): `setting` is a real NovelPipelineConfig field threaded
  // into project.context by createPipeline/createProjectFromPipeline for
  // book-bible phase projects — populate it so grounding queries are
  // setting-shaped, per buildQuery's design, not just genre+domain. There is
  // no `period` field anywhere in the project/book data model today, so it's
  // left unset (buildQuery already tolerates that).
  const setting = project?.context?.setting ? String(project.context.setting) : undefined;

  const writeFile = opts.writeFile ?? (async (p: string, c: string) => {
    const { writeFile: wf, mkdir } = await import('fs/promises');
    const { dirname } = await import('path');
    await mkdir(dirname(p), { recursive: true });
    await wf(p, c, 'utf-8');
  });

  // M2 (code-review): ResearchLookupService.lookup's estimatedCost was being
  // discarded, leaving grounding-lookup spend uncosted. Wrap it so the cost is
  // recorded, mirroring the consistencyAudit cost-recording wrapper
  // (index.ts). ResearchResult exposes no token count, so tokens records as 0.
  const lookup = {
    lookup: async (query: string, lookupOpts?: { maxWords?: number }) => {
      const res = await services.researchLookup.lookup(query, lookupOpts);
      try { services.costs?.record(res.provider ?? 'research-lookup', 0, res.estimatedCost, project.bookSlug); } catch { /* best-effort */ }
      return res;
    },
  };

  let result: { citedFacts: string; sources: string[] };
  try {
    result = await runGroundingResearch({
      slug: project.bookSlug,
      signals: { genre, domain, setting },
      research: services.research,
      lookup,
      writeFile,
      researchDir,
    });
  } catch (err) {
    console.warn('  [grounding-research] hook failed (non-fatal):', (err as Error)?.message || err);
    return NOOP;
  }

  if (!project.context) project.context = {};
  project.context.groundingResearch = result;

  return { groundingBlock: formatGroundingBlock(result) };
}

function formatGroundingBlock(result: { citedFacts: string; sources: string[] }): string {
  if (!result.citedFacts) return '';
  return `## Grounding Research (sourced facts for accuracy)\n\n${result.citedFacts}`;
}

/**
 * Opt-in Ideation Ensemble seam (Flagship Plan 8, Task 4).
 *
 * A no-op unless `step.phase === 'premise'`, no earlier premise-phase step on
 * this project has already completed (i.e. this is the FIRST premise
 * generation — a novel-pipeline's "Refine premise" step that follows is left
 * untouched, it refines the ensemble's already-chosen result via the normal
 * single-model path), the project is bound to a book, and that book's
 * `ensemble.enabled === true` (default OFF — this is the most expensive
 * front-end phase). Fail-soft throughout: any lookup/fan-out error degrades
 * to `{ active: false }` so the caller falls through to the normal
 * single-model premise generation instead of blocking the pipeline.
 */
export async function resolveEnsemblePremise(opts: {
  services: any;
  project: any;
  step: any;
  userMessage: string;
}): Promise<{ active: boolean; premiseText?: string; pitches?: EnsemblePitch[]; selection?: SelectPitchResult }> {
  const { services, project, step, userMessage } = opts;
  const NOOP = { active: false };
  if (step?.phase !== 'premise') return NOOP;
  const priorPremiseCompleted = Array.isArray(project?.steps) &&
    project.steps.some((s: any) => s.phase === 'premise' && s.status === 'completed');
  if (priorPremiseCompleted) return NOOP;
  if (!project?.bookSlug || !services?.books?.open) return NOOP;

  let manifest: any;
  try { manifest = (await services.books.open(project.bookSlug))?.manifest; } catch { return NOOP; }
  if (manifest?.ensemble?.enabled !== true) return NOOP;

  const genre = String(manifest?.pulledFrom?.genre?.name ?? project?.context?.genre ?? '');
  const sheet = genre ? loadCastingSheet(genre) : null;
  const panel = resolveEnsemblePanel({ manifestPanel: manifest?.ensemble?.panel, sheetPanel: sheet?.ensemblePanel });
  const angles = loadIdeationAngles();

  // Cost-record wrapper: mirrors the consistencyAudit cost-record wrapper
  // (index.ts) — every panel call + the judge call routes through
  // services.costs so an ensemble run's spend is attributed to this book.
  const complete = async (req: any) => {
    const resp = await services.aiRouter.complete(req);
    try { services.costs?.record(resp.provider ?? req.provider, resp.tokensUsed, resp.estimatedCost, project.bookSlug); } catch { /* best-effort */ }
    return resp;
  };

  let pitches: EnsemblePitch[] = [];
  try {
    pitches = await runIdeationEnsemble({
      premise: userMessage,
      genre: genre || 'fiction',
      panel,
      angles,
      complete,
      resolveModel: resolvePanelMemberProvider,
    });
  } catch (err) {
    console.warn('  [ideation-ensemble] fan-out failed (non-fatal, falling back to single-model premise):', (err as Error)?.message || err);
    return NOOP;
  }
  // Every panel member failed (e.g. no providers configured) — fall back to
  // the normal single-model premise step rather than completing with nothing.
  if (pitches.length === 0) return NOOP;

  // Judge model: resolve via the router's own tier selection (task type
  // 'final_edit', the same premium-reasoning tier the rest of the codebase
  // uses for judge-like decisions) rather than hardcoding a provider id — a
  // hardcoded provider that isn't configured on this deployment would throw
  // and take the whole ensemble inert (the exact failure class Plans 1-6 hit).
  let judgeProviderId: string;
  try { judgeProviderId = services.aiRouter.selectProvider('final_edit').id; } catch (err) {
    console.warn('  [ideation-ensemble] no provider available for the judge (non-fatal, falling back to single-model premise):', (err as Error)?.message || err);
    return NOOP;
  }
  const selection = await selectPitch({ pitches, premise: userMessage, complete, judgeModel: { provider: judgeProviderId } });
  if (!selection.chosen) return NOOP;

  return { active: true, premiseText: selection.chosen, pitches, selection };
}

/**
 * Analyze-then-apply polish seam (Flagship Plan 4, Task 3).
 *
 * A no-op unless `step` is a book-production "Polish Chapter N" step
 * (`phase: 'polish', skill: 'revise'`) — OR (L2, code-review) a per-chapter
 * rewrite/editorial step from the OTHER book-production generator, which
 * tags its chapter-level revise steps with `role: 'rewrite'|'editorial'` and
 * a `chapterNumber` under a different phase name — with a matching completed
 * "Write Chapter N" step and both deterministic critic services wired.
 * Returns a findings block naming the specific craft/dialogue/continuity
 * issues found on the WRITE step's prose, for the polish prompt to target —
 * or '' when there's nothing to fix (or anything above is missing), in which
 * case the polish step's existing fixed-checklist prompt runs unchanged.
 * Fail-soft: a critic error degrades to '' rather than blocking the polish step.
 */
export function resolveAnalyzeApplyBlock(opts: { services: any; project: any; step: any }): string {
  const { services, project, step } = opts;
  const isPolishPhaseStep = step?.phase === 'polish' && step?.skill === 'revise';
  const isChapterRewriteStep = step?.skill === 'revise' && typeof step?.chapterNumber === 'number'
    && (step?.role === 'rewrite' || step?.role === 'editorial');
  if (!isPolishPhaseStep && !isChapterRewriteStep) return '';
  if (!services?.craftCritic || !services?.dialogueAuditor) return '';

  const chNum = step.chapterNumber;
  const writeStep = (project?.steps ?? []).find((s: any) =>
    s.skill === 'write' && s.chapterNumber === chNum && s.status === 'completed' && s.result);
  if (!writeStep?.result) return '';

  try {
    const findings = analyzeChapter({
      text: writeStep.result,
      chapterNumber: chNum || 0,
      craftCritic: services.craftCritic,
      dialogueAuditor: services.dialogueAuditor,
      continuityFlags: writeStep.continuityFlags,
    });
    return findings.hasFindings ? describeFindings(findings) : '';
  } catch (err) {
    console.warn('  [analyze-apply] analysis failed (non-fatal):', (err as Error)?.message || err);
    return '';
  }
}

/**
 * Beta-reader pre-format gate (Flagship Plan 4, Task 3).
 *
 * Runs a REAL `BetaReaderService.scanManuscript` pass over the pipeline's
 * completed book-production chapters when a pipeline advances INTO its
 * format-export phase, and stores the resulting report (same path the manual
 * `/api/projects/:id/beta-reader` endpoint uses) so it's available as a gate
 * INPUT for the human before formatting — advisory only, never blocks the
 * advance. A no-op unless the started phase is `format-export`, a completed
 * `book-production` sibling exists in the pipeline, and `betaReader`/
 * `aiRouter` are wired. Fail-soft throughout.
 */
export async function runBetaReaderGate(opts: {
  services: any;
  pipelineProjects: any[];
  startedProject: any;
  gatherChapters: (project: any) => Promise<Array<{ id: string; number: number; title: string; text: string }>>;
}): Promise<{ triggered: boolean; report?: any }> {
  const { services, pipelineProjects, startedProject, gatherChapters } = opts;
  const NOOP = { triggered: false };
  if (startedProject?.type !== 'format-export') return NOOP;
  if (!services?.betaReader || !services?.aiRouter) return NOOP;

  const prodProject = (pipelineProjects ?? []).find((p: any) => p.type === 'book-production' && p.status === 'completed');
  if (!prodProject) return NOOP;

  try {
    const chapters = await gatherChapters(prodProject);
    if (chapters.length === 0) return NOOP;

    // M1 (code-review): the panel's chapter x archetype calls were bypassing
    // the cost tracker (AIRouter.complete does not record spend itself —
    // recording only happens at the index.ts choke points). Mirrors the
    // consistencyAudit cost-recording wrapper (index.ts).
    const aiCompleteFn = async (r: any) => {
      const resp = await services.aiRouter.complete(r);
      try { services.costs?.record(resp.provider ?? r.provider, resp.tokensUsed, resp.estimatedCost, prodProject.bookSlug); } catch { /* best-effort */ }
      return resp;
    };
    const aiSelectFn = (t: string) => services.aiRouter.selectProvider(t);
    const report = await services.betaReader.scanManuscript(prodProject.id, chapters, aiCompleteFn, aiSelectFn);

    if (prodProject.bookSlug && services.reports) {
      try {
        const r = renderBetaReaderReport(report);
        services.reports.write(prodProject.bookSlug, 'beta-reader', { title: r.title, markdown: r.markdown, json: report, summary: r.summary });
      } catch { /* report emission is best-effort */ }
    }
    return { triggered: true, report };
  } catch (err) {
    console.warn('  [beta-reader-gate] scan failed (non-fatal):', (err as Error)?.message || err);
    return NOOP;
  }
}

/** Sets the Wave-3 advisory header on a response. */
export function addWaveDisclaimer(res: Response): void {
  res.setHeader('X-BookClaw-Disclaimer', 'Wave 3 actions create confirmation requests but do not execute irreversible actions autonomously. You are responsible for every approved action. See SECURITY.md.');
}

/**
 * Build a gatherChapters(project) closed over baseDir (call sites stay unchanged).
 *
 * Phase 8: chapter step files live in the project's bound book data/ dir (named
 * `${project.id}-step-N-...md`).  Pass `dataDirResolver` so the reader resolves
 * the dir from the project's bookSlug first, then falls back to the global active
 * book resolver, then to the legacy per-project `workspace/projects/<slug>/`.
 * The `${ws.id}-` file-name prefix already scopes the on-disk read to this
 * project's steps, so sibling projects sharing the book dir never leak in.
 *
 * @param dataDirResolver  Receives the project; returns the resolved data dir or
 *   null.  For Phase 8 callers, pass
 *   `(p) => services.books?.dataDirOf?.(p.bookSlug) ?? services.books?.activeDataDir?.() ?? null`.
 */
export function makeGatherChapters(baseDir: string, dataDirResolver?: (project: any) => string | null) {
  return async function gatherChapters(project: any): Promise<Array<{ id: string; number: number; title: string; text: string }>> {
    const { join: j } = await import('path');
    const { readFile: rf } = await import('fs/promises');
    const { existsSync: ex } = await import('fs');

    const projectSlug = project.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    let activeDataDir: string | null = null;
    try { activeDataDir = dataDirResolver?.(project) ?? null; } catch { activeDataDir = null; }
    const projectDir = activeDataDir ?? j(baseDir, 'workspace', 'projects', projectSlug);

    const writingSteps = project.steps
      .filter((s: any) => (s.phase === 'writing' || s.label?.toLowerCase().includes('chapter')) && s.status === 'completed')
      .sort((a: any, b: any) => (a.chapterNumber || 0) - (b.chapterNumber || 0));

    const chapters: Array<{ id: string; number: number; title: string; text: string }> = [];
    for (const ws of writingSteps) {
      let text = ws.result || '';
      // If no inline result, try reading from disk.
      if (!text && ex(projectDir)) {
        const expectedFile = `${ws.id}-${ws.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.md`;
        const fullPath = j(projectDir, expectedFile);
        if (ex(fullPath)) {
          const raw = await rf(fullPath, 'utf-8');
          text = raw.replace(/^# .+\n\n/, '');
        }
      }
      if (text && text.length > 200) {
        chapters.push({
          id: ws.id,
          number: ws.chapterNumber || chapters.length + 1,
          title: ws.label,
          text,
        });
      }
    }
    return chapters;
  };
}
