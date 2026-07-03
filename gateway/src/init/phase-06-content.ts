import { join, resolve } from 'path';
import { homedir } from 'os';
import { TTSService } from '../services/tts.js';
import { BackupService, readBackupCfg } from '../services/backup.js';
import { ImageGenService } from '../services/image-gen.js';
import { PersonaService } from '../services/personas.js';
import { ProjectEngine } from '../services/projects.js';
import { ContextEngine } from '../services/context-engine.js';
import { ROOT_DIR } from '../paths.js';
import { nextBookPhaseAfter } from '../services/book-types.js';
import { appVersion, WORKSPACE_SCHEMA_VERSION } from './phase-01-config.js';
import { extractChapterFacts } from '../services/consistency/extractor.js';
import { CONSISTENCY_PROVIDERS } from '../services/consistency/model-selection.js';
import type { LedgerFact } from '../services/consistency/types.js';
import { runBetaReaderGate, makeGatherChapters } from '../api/routes/_shared.js';
import type { BookClawGateway } from '../index.js';

/** Phases 6c–6f: TTS, image generation, personas, project engine, context engine. */
export async function initContentServices(gw: BookClawGateway): Promise<void> {
  // ── Phase 6c: TTS Service (Piper) — silent init, optional feature ──
  gw.tts = new TTSService(join(ROOT_DIR, 'workspace'), gw.vault);
  await gw.tts.initialize();

  // ── Phase 6c2: Image Generation Service ──
  gw.imageGen = new ImageGenService(join(ROOT_DIR, 'workspace'), gw.vault);
  await gw.imageGen.initialize();

  // ── Phase 6d: Author Personas ──
  gw.personas = new PersonaService(join(ROOT_DIR, 'workspace'));
  await gw.personas.initialize();
  console.log(`  ✓ Personas: ${gw.personas.getCount()} author persona(s) loaded`);

  // ── Phase 6e: Project Engine ──
  gw.projectEngine = new ProjectEngine(gw.authorOS, ROOT_DIR);
  // Wire AI capabilities for dynamic planning
  gw.projectEngine.setAI(
    (request) => gw.aiRouter.complete(request),
    (taskType) => gw.aiRouter.selectProvider(taskType)
  );
  // Phase 3c: the engine no longer owns PROJECT_TEMPLATES — source the dashboard
  // template catalog from the library's full pipeline entries (real labels +
  // step counts come from the parsed LibraryPipeline, not the lightweight row).
  const pipelineRows = gw.library?.list?.('pipeline') ?? [];
  gw.projectEngine.setTemplateCatalog(pipelineRows.map((r: any) => {
    const pl = gw.library?.get?.('pipeline', r.name)?.pipeline;
    const isDynamic = !!pl?.dynamic || r.name === 'novel-pipeline';
    return {
      type: r.name,
      label: pl?.label || r.name,
      description: pl?.description || r.description || '',
      stepCount: isDynamic ? 30 : (pl?.steps?.length ?? 0),
      stepCountLabel: isDynamic ? '30+ auto-generated steps' : undefined,
    };
  }));
  // Resolver lets createPipeline build static phases from their library
  // pipelines without the engine importing LibraryService directly.
  gw.projectEngine.setPipelineResolver((name: string) => gw.library?.get?.('pipeline', name)?.pipeline ?? null);
  // BUG M6: resolve a project → its bound book's data/ dir so step results that
  // were truncated for the state file can be re-hydrated from their full per-step
  // .md output (mirrors the route layer's dataDir resolution).
  gw.projectEngine.setDataDirResolver((p) => gw.books?.dataDirOf?.(p.bookSlug ?? null) ?? gw.books?.activeDataDir?.() ?? null);
  const templates = gw.projectEngine.getTemplates();
  console.log(`  ✓ Project engine: ${templates.length} pipeline templates + dynamic AI planning`);

  // F1 (config-not-code pipelines): when a sequence project completes, auto-start
  // the next pipeline phase so a multi-pipeline book progresses across its chained
  // Projects (the bridge/"continue" path only picks up active/paused projects, so
  // without this the sequence would stall). advancePipeline runs no AI itself — it
  // only marks the next project active — so in the default posture advancement is
  // free and generation stays user/poller-driven. (With autonomous mode ON, the
  // heartbeat then runs the now-active phase. Phase ordering across a sequence is
  // enforced for autonomous mode too: the heartbeat's project list is filtered
  // through ProjectEngine.sequencePredecessorsComplete — see phase-10-heartbeat-
  // bridges.ts — so a later pending phase is never run ahead of an earlier one.)
  // C1 (code-review): the beta-reader pre-format gate (runBetaReaderGate,
  // _shared.ts) was only ever invoked from the MANUAL POST /api/pipeline/:id/
  // advance route — pipelines that auto-advance through this completion hook
  // never triggered it, so the beta-reader report before formatting was never
  // generated on the normal (autonomous) path. gatherChapters mirrors the
  // route layer's helper (projects.routes.ts) so both call sites resolve
  // chapter text the same way.
  const gatherChapters = makeGatherChapters(
    ROOT_DIR,
    (p) => gw.books?.dataDirOf?.(p?.bookSlug ?? null) ?? gw.books?.activeDataDir?.() ?? null,
  );

  gw.projectEngine.onProjectCompleted(async (project: any) => {
    let startedProject: any = null;
    if (project.pipelineId) startedProject = gw.projectEngine.advancePipeline(project.pipelineId);
    // Fire the beta-reader gate ONLY when the phase the pipeline just advanced
    // INTO is format-export — advisory only, never blocks advancement. Fail-soft.
    if (startedProject?.type === 'format-export' && project.pipelineId) {
      const svc = gw.getServices?.();
      const pipelineProjects = gw.projectEngine.getPipelineProjects(project.pipelineId);
      runBetaReaderGate({ services: svc, pipelineProjects, startedProject, gatherChapters })
        .catch((err: any) => console.log(`  ℹ Beta-reader gate skipped: ${err?.message || err}`));
    }
    // Advance the bound book's manifest phase across the project boundary: when a
    // phase-project (Planning/Bible/…) completes, the book moves to the next
    // lifecycle phase. advancePipeline only marks the next PROJECT active — it
    // never touches book.json — and onStepCompleted can't bridge projects (its
    // `next` is null at a project's end), so without this the manifest phase
    // sticks at 'planning' and the board/Write view never show planning as done.
    if (gw.books && project?.bookSlug) {
      const nextPhase = nextBookPhaseAfter(project.type);
      if (nextPhase) await gw.books.setPhase(project.bookSlug, nextPhase).catch(() => {});
    }

    // Consistency checking built into the pipeline (run-review goal #3): after the
    // writing / revision phases finish, auto-run the consistency audit so continuity
    // is checked WITHOUT an explicit run. Background, fail-soft, and provider-gated
    // (the audit throws on a too-small model → caught + logged, never blocks).
    if (gw.books && project?.bookSlug && (project.type === 'book-production' || project.type === 'deep-revision')) {
      const svc = gw.getServices?.();
      const slug = project.bookSlug;
      if (svc?.consistencyAudit) {
        // Guard with the SAME job registry the manual /consistency-audit route
        // uses. runConsistencyAudit opens with clearBookFacts()+clearBookKnowledge()
        // then re-inserts across awaited AI calls; a second concurrent audit for
        // the same book (a user click, or another phase completing) would wipe the
        // in-flight run's inserts and corrupt the fact ledger. Claim the slot;
        // skip if already running; release when done (bug-review #22).
        if (!gw.consistencyJobs.start(slug)) {
          console.log(`  ℹ Auto consistency audit skipped for "${slug}": already running`);
        } else {
          void svc.consistencyAudit(slug, (msg: string) => gw.consistencyJobs.progress(slug, msg))
            .then(() => console.log(`  ✓ Auto consistency audit complete for "${slug}"`))
            .catch((err: any) => console.log(`  ℹ Auto consistency audit skipped for "${slug}": ${err?.message || err}`))
            .finally(() => gw.consistencyJobs.finish(slug));
        }
      }
    }
  });

  // ── Phase 6f: Context Engine ──
  gw.contextEngine = new ContextEngine(join(ROOT_DIR, 'workspace'));
  gw.projectEngine.setContextEngine(gw.contextEngine);
  console.log('  ✓ Context Engine: manuscript memory + continuity checking');

  // TODO #15: advance the bound book's manifest phase as its project's steps
  // complete (the frontier phase = next step's phase, or the just-completed
  // step's phase on the final step). Fail-soft; setPhase no-ops on unknown books.
  gw.projectEngine.onStepCompleted(async (project: any, completedStep: any, next: any) => {
    if (!gw.books || !project?.bookSlug) return;
    const phase = next?.phase ?? completedStep?.phase;
    if (!phase) return;
    // Only persist phases that are board segments for this book — a sub-phase
    // like book-production's 'polish' must not leave the book's phase list.
    const phases = gw.books.phasesForBook(project.bookSlug);
    if (phases.length && !phases.includes(phase)) return;
    await gw.books.setPhase(project.bookSlug, phase);
  });

  // ── Consistency ledger seeding from the bible phase (Flagship Plan 3, Task 3) ──
  // A completed bible-role step's content is fact-extracted into the consistency
  // ledger as canon, so the pre-draft canon injection (canon-inject.ts) and the
  // post-draft continuity check (continuity-check.ts) have something to check
  // against before any full audit has ever run. Fail-soft: an extraction error
  // or an unconfigured large-context provider just skips.
  //
  // M1: the pipeline runs SEVERAL consecutive bible-role steps, each firing this
  // hook. Gating on the full-audit consistencyJobs SLOT (only one holder per
  // book) meant a second bible step completing while the first's extraction was
  // still in flight would lose the slot race and have its canon silently
  // dropped. Bible seeds are additive inserts — they only need to avoid
  // interleaving with a full audit's clearBookFacts()/clearBookKnowledge(), not
  // with each other — so they serialize among themselves via a lightweight
  // per-book promise chain instead, and just SKIP (without ever touching the
  // registry) when a full audit is already running.
  const bibleSeedChains = new Map<string, Promise<void>>();
  gw.projectEngine.onStepCompleted(async (project: any, completedStep: any) => {
    if (!gw.consistencyStore?.isAvailable?.() || !project?.bookSlug || completedStep?.role !== 'bible') return;
    const result = String(completedStep?.result ?? '').trim();
    if (!result) return;
    const slug = project.bookSlug;
    // Captured outside the closure: TS narrows `gw.consistencyStore` from the
    // guard above only in this scope, not inside the nested seedOne closure.
    const store = gw.consistencyStore;

    const seedOne = async () => {
      if (gw.consistencyJobs.isRunning(slug)) {
        console.log(`  ℹ Bible-seed skipped for "${slug}": a consistency audit is already running`);
        return;
      }
      try {
        const manifest = (await gw.books?.open?.(slug).catch(() => null))?.manifest;
        const world = manifest?.pulledFrom?.world?.name ?? null;
        const extracted = await extractChapterFacts(
          {
            ai: {
              complete: async (r: any) => {
                const resp = await gw.aiRouter.complete(r);
                try { gw.costs.record(resp.provider ?? r.provider, resp.tokensUsed, resp.estimatedCost, slug); } catch { /* best-effort */ }
                return resp;
              },
              select: (t: string, pref?: string) => {
                const p = gw.aiRouter.selectProvider(t, pref);
                if (!(CONSISTENCY_PROVIDERS as readonly string[]).includes(p.id)) {
                  throw new Error(`Consistency requires a large-context model; "${p.id}" is not supported.`);
                }
                return p;
              },
            },
          },
          result, [], 0,
        );
        const facts: LedgerFact[] = extracted.facts.map(f => ({
          ...f, world, bookSlug: slug, chapter: 'CANON', source: 'canon',
          sourceLabel: `Bible: ${completedStep.label}`, canonical: f.canonical !== false, storyElapsed: 0,
        }));
        store.insertFacts(facts);
        console.log(`  ✓ Bible-seed: ${facts.length} fact(s) from "${completedStep.label}" for "${slug}"`);
      } catch (err: any) {
        console.log(`  ℹ Bible-seed skipped for "${slug}": ${err?.message ?? err}`);
      }
    };

    // Chain onto the same book's prior seed so consecutive bible steps run one
    // at a time (never dropped, never interleaved with each other's inserts).
    const prior = bibleSeedChains.get(slug) ?? Promise.resolve();
    const chained = prior.then(seedOne, seedOne);
    bibleSeedChains.set(slug, chained);
    await chained;
  });

  // ── Book-container Phase 11: Backup & recovery ──
  try {
    const rawRoot = process.env.BOOKCLAW_BACKUP_DIR || gw.config.get('backup.localPath', '~/bookclaw-backups');
    const backupRoot = rawRoot.startsWith('~') ? join(homedir(), rawRoot.slice(1)) : resolve(rawRoot);
    gw.backup = new BackupService(join(ROOT_DIR, 'workspace'), backupRoot,
      () => readBackupCfg(gw.config),
      { appVersion: await appVersion(), workspaceSchemaVersion: WORKSPACE_SCHEMA_VERSION });
    if (gw.books) gw.backup.setBooks(gw.books);
    if (gw.editors) gw.backup.setEditors(gw.editors);
    await gw.backup.initialize();
    // Hook registered unconditionally — the service checks the live enabled/onCompletion flags.
    gw.projectEngine.onProjectCompleted(async () => { await gw.backup?.onCompletionSnapshot(); });
    if (gw.backup.start()) {
      const cfg = readBackupCfg(gw.config);
      console.log(`  ✓ Backup: ON — keep ${cfg.keep}, every ${cfg.intervalHours}h, root ${backupRoot}`);
    } else {
      console.log('  ⚠ BACKUPS ARE DISABLED (backup.enabled=false) — no point-in-time recovery. Re-enable in Settings → Backups.');
    }
  } catch (e: any) {
    console.log(`  ⚠ Backup service unavailable: ${e.message}`);
    gw.backup = undefined;
  }
}
