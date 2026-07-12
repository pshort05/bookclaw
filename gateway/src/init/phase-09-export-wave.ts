import { join } from 'path';
import { KDPExporter } from '../services/kdp-exporter.js';
import { BetaReaderService } from '../services/beta-reader.js';
import { DialogueAuditor } from '../services/dialogue-auditor.js';
import { RevisionOrchestrator } from '../services/revision-orchestrator.js';
import { ManuscriptHubService } from '../services/manuscript-hub.js';
import { CoverTypographyService } from '../services/cover-typography.js';
import { ExternalToolsService } from '../services/external-tools.js';
import { TrackChangesService } from '../services/track-changes.js';
import { GoalsService } from '../services/goals.js';
import { SeriesBibleService } from '../services/series-bible.js';
import { CraftCriticService } from '../services/craft-critic.js';
import { AudiobookPrepService } from '../services/audiobook-prep.js';
import { StyleCloneService } from '../services/style-clone.js';
import { ConfirmationGateService } from '../services/confirmation-gate.js';
import { DisclosuresService } from '../services/disclosures.js';
import { LaunchOrchestratorService } from '../services/launch-orchestrator.js';
import { AMSAdsService } from '../services/ams-ads.js';
import { BookBubSubmitterService } from '../services/bookbub-submitter.js';
import { ReleaseCalendarService } from '../services/release-calendar.js';
import { ReaderIntelService } from '../services/reader-intel.js';
import { TranslationPipelineService } from '../services/translation-pipeline.js';
import { WebsiteBuilderService } from '../services/website-builder.js';
import { BookTransferService } from '../services/book-transfer.js';
import { LibraryTransferService } from '../services/library-transfer.js';
import { ROOT_DIR } from '../paths.js';
import type { BookClawGateway } from '../index.js';

/**
 * Phase 6i: author-facing export & feedback services.
 * Phase 6j: Wave 2 — career/craft/series/audiobook/voice (constructs styleClone).
 * Phase 6k: Wave 3 — autonomous career agent (gated by the confirmation gate).
 */
export async function initExportAndWaves(gw: BookClawGateway): Promise<void> {
  // ── Phase 6i: Author-facing export & feedback services ──
  gw.kdpExporter = new KDPExporter();
  gw.betaReader = new BetaReaderService();
  gw.dialogueAuditor = new DialogueAuditor();
  gw.manuscriptHub = new ManuscriptHubService();
  gw.coverTypography = new CoverTypographyService();
  gw.externalTools = new ExternalToolsService(ROOT_DIR);
  gw.trackChanges = new TrackChangesService();
  console.log('  ✓ KDP exporter, beta reader, dialogue auditor, hub, cover typography, external tools, track-changes ready');

  // ── Phase 6j: Wave 2 — career/craft/series/audiobook/voice ──
  gw.goalsService = new GoalsService(join(ROOT_DIR, 'workspace'));
  await gw.goalsService.initialize();
  console.log(`  ✓ Author goals: ${gw.goalsService.listGoals().length} tracked`);

  gw.seriesBible = new SeriesBibleService(join(ROOT_DIR, 'workspace'));
  await gw.seriesBible.initialize();
  console.log(`  ✓ Series bible: ${gw.seriesBible.listSeries().length} series`);

  gw.craftCritic = new CraftCriticService();
  gw.audiobookPrep = new AudiobookPrepService();
  gw.styleClone = new StyleCloneService();
  // Deferred wiring from Phase 6g9: characterVoices needs styleClone, which only
  // exists now. setStyleClone just stores the reference for its runtime methods.
  gw.characterVoices.setStyleClone(gw.styleClone);
  console.log('  ✓ Craft critic, audiobook prep, style clone ready');

  // ── Phase 6k: Wave 3 — autonomous career agent (gated) ──
  gw.confirmationGate = new ConfirmationGateService(join(ROOT_DIR, 'workspace'));
  gw.confirmationGate.setAuditLogger((category, action, meta) => gw.audit.log(category, action, meta));
  await gw.confirmationGate.initialize();
  console.log(`  ✓ Confirmation gate: ${gw.confirmationGate.list({ status: 'pending' }).length} pending`);

  gw.bookTransfer = new BookTransferService(
    join(ROOT_DIR, 'workspace', 'books'),
    gw.books,
    gw.injectionDetector,
    join(ROOT_DIR, 'workspace', '.import-staging'),
  );
  // Phase 12: library entry share/import — same staging root, so its pending
  // stagingIds must be protected by the (shared) orphan-purge sweep below.
  gw.libraryTransfer = new LibraryTransferService(
    gw.library,
    gw.injectionDetector,
    join(ROOT_DIR, 'workspace', '.import-staging'),
    join(ROOT_DIR, 'workspace', 'library', 'skills'),
    () => gw.skills.reload(),
  );
  // Purge orphan import-staging dirs (expired/denied/crashed imports). Keep dirs
  // referenced by a still-pending book-transfer OR library-transfer confirmation
  // (both services stage under the same root).
  const TRANSFER_SERVICES = new Set(['book-transfer', 'library-transfer']);
  // Protect both non-terminal statuses: 'pending' (awaiting review) AND
  // 'approved' (user OK'd but hasn't hit the two-step finalize yet) — otherwise
  // the sweep would delete an approved import's staging before finalize.
  const collectPendingStagingIds = (): Set<string> => new Set(
    [...gw.confirmationGate.list({ status: 'pending' }), ...gw.confirmationGate.list({ status: 'approved' })]
      .filter(r => TRANSFER_SERVICES.has(r.service))
      .map(r => String(r.payload?.stagingId))
      .filter(Boolean),
  );
  gw.bookTransfer.sweepStaging(collectPendingStagingIds());
  // Re-sweep periodically so denied/expired imports don't accumulate between
  // restarts. unref() so this timer never keeps the process alive.
  const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h
  const sweepTimer = setInterval(() => {
    try {
      gw.bookTransfer.sweepStaging(collectPendingStagingIds());
    } catch { /* sweep is best-effort */ }
  }, SWEEP_INTERVAL_MS);
  sweepTimer.unref?.();
  console.log('  ✓ Book transfer + library transfer (share/import) ready');

  gw.disclosures = new DisclosuresService();

  gw.launchOrchestrator = new LaunchOrchestratorService(join(ROOT_DIR, 'workspace'));
  gw.launchOrchestrator.setDependencies(gw.confirmationGate, gw.disclosures);
  await gw.launchOrchestrator.initialize();
  console.log(`  ✓ Launch orchestrator: ${gw.launchOrchestrator.listLaunches().length} launch(es) tracked`);

  gw.amsAds = new AMSAdsService();
  gw.bookbub = new BookBubSubmitterService();

  gw.releaseCalendar = new ReleaseCalendarService(join(ROOT_DIR, 'workspace'));
  await gw.releaseCalendar.initialize();
  console.log(`  ✓ Release calendar: ${gw.releaseCalendar.list().length} event(s)`);

  gw.readerIntel = new ReaderIntelService();

  gw.translationPipeline = new TranslationPipelineService();
  gw.translationPipeline.setGate(gw.confirmationGate);
  // AuthorAgent #13: wire the AI router so executeTranslation can run. Record
  // spend per chunk (translation can be the single most expensive operation) so
  // it counts against the daily/monthly budget — model-aware via #14 pricing.
  gw.translationPipeline.setAI(
    async (req) => {
      const resp = await gw.aiRouter.complete(req);
      try { gw.costs.record(resp.provider, resp.tokensUsed, resp.estimatedCost, undefined, resp.model, resp.promptTokens, resp.completionTokens); } catch { /* non-fatal */ }
      return resp;
    },
    (taskType: string) => gw.aiRouter.selectProvider(taskType),
  );

  // Revision orchestrator (AuthorAgent #17): unified severity-ranked report over
  // craft/dialogue/continuity/voice/mechanical detectors (all built by now).
  gw.revisionOrchestrator = new RevisionOrchestrator({
    craftCritic: gw.craftCritic,
    dialogueAuditor: gw.dialogueAuditor,
    writingJudge: gw.writingJudge,
    characterVoices: gw.characterVoices,
  });

  gw.websiteBuilder = new WebsiteBuilderService(join(ROOT_DIR, 'workspace'));
  console.log('  ✓ AMS, BookBub, Reader Intel, Translation, Website Builder ready');
  console.log('  ⚠ Wave 3 actions are gated — review SECURITY.md and confirm every external action.');
}
