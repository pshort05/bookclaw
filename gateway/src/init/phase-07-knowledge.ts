import { join } from 'path';
import { LessonStore } from '../services/lessons.js';
import { PreferenceStore } from '../services/preferences.js';
import { UserModelService } from '../services/user-model.js';
import { CronSchedulerService } from '../services/cron-scheduler.js';
import { AutoSkillService } from '../services/auto-skill.js';
import { WritingJudgeService } from '../services/writing-judge.js';
import { ResearchLookupService } from '../services/research-lookup.js';
import { VideoResearchService } from '../services/video-research.js';
import { StoryStructureService } from '../services/story-structures.js';
import { PlotPromisesService } from '../services/plot-promises.js';
import { CharacterVoicesService } from '../services/character-voices.js';
import { ROOT_DIR } from '../paths.js';
import type { BookClawGateway } from '../index.js';

/**
 * Phases 6g–6g9: lessons/preferences, user model, cron scheduler (+built-in
 * handlers), auto-skill drafter, writing judge, research services (sourced
 * lookup + video), story structures, plot promises, character voices.
 *
 * NOTE: characterVoices needs styleClone, which isn't constructed until Phase 6j
 * — so the setStyleClone() wiring is deferred to that phase. initialize() here
 * only creates the store dir and never touches styleClone, so this ordering is
 * safe.
 */
export async function initKnowledgeServices(gw: BookClawGateway): Promise<void> {
  // ── Phase 6g: Lessons & Preferences (from Sneakers) ──
  gw.lessons = new LessonStore(join(ROOT_DIR, 'workspace', 'memory'));
  await gw.lessons.initialize();
  console.log(`  ✓ Lessons: ${gw.lessons.getAll().length} learned`);

  gw.preferences = new PreferenceStore(join(ROOT_DIR, 'workspace', 'memory'));
  await gw.preferences.initialize();
  const prefCount = Object.keys(gw.preferences.getAll()).length;
  console.log(`  ✓ Preferences: ${prefCount} tracked`);

  // ── Phase 6g2: User Model (Honcho-style dialectic, simplified) ──
  gw.userModel = new UserModelService(join(ROOT_DIR, 'workspace'));
  gw.userModel.setAI(
    (req) => gw.aiRouter.complete(req),
    (taskType: string) => gw.aiRouter.selectProvider(taskType),
  );
  await gw.userModel.initialize();
  const um = gw.userModel.getSnapshot();
  console.log(`  ✓ User model: ${um?.observationCount || 0} observations${um?.narrative.confidence ? `, narrative confidence ${(um.narrative.confidence * 100).toFixed(0)}%` : ''}`);

  // ── Phase 6g3: Cron Scheduler (Hermes-inspired) ──
  gw.cronScheduler = new CronSchedulerService(join(ROOT_DIR, 'workspace'));
  await gw.cronScheduler.initialize();
  // Register built-in handlers — user-created jobs reference these by name.
  gw.cronScheduler.registerHandler('reindex-memory-search', async () => {
    if (!gw.memorySearch?.isAvailable()) return { success: false, message: 'Search unavailable' };
    const r = await gw.memorySearch.reindexAll();
    return { success: true, message: `Indexed ${r.indexed}, skipped ${r.skipped}` };
  });
  gw.cronScheduler.registerHandler('consolidate-user-model', async () => {
    const snap = await gw.userModel.maybeConsolidate(true);
    return { success: !!snap, message: snap ? `Narrative refreshed (confidence ${(snap.narrative.confidence * 100).toFixed(0)}%)` : 'No AI provider available' };
  });
  gw.cronScheduler.registerHandler('heartbeat-broadcast', async (payload) => {
    const message = String(payload?.message || 'Scheduled check-in.');
    try { gw.io.emit('cron-broadcast', { message, at: new Date().toISOString() }); } catch {}
    return { success: true, message: `Broadcast: ${message.substring(0, 80)}` };
  });
  gw.cronScheduler.start();
  console.log(`  ✓ Cron scheduler: ${gw.cronScheduler.list().length} job(s) scheduled, ${gw.cronScheduler.listHandlers().length} handlers`);

  // ── Phase 6g4: Auto-Skill Creator ──
  gw.autoSkill = new AutoSkillService(ROOT_DIR);
  gw.autoSkill.setAI(
    (req) => gw.aiRouter.complete(req),
    (taskType: string) => gw.aiRouter.selectProvider(taskType),
  );
  gw.autoSkill.setExistingSkillsLookup(() => {
    const names = new Set<string>();
    for (const s of gw.skills?.getSkillCatalog() || []) names.add(s.name);
    return names;
  });
  await gw.autoSkill.initialize();
  const drafts = gw.autoSkill.list({ status: 'pending_review' });
  console.log(`  ✓ Auto-skill drafter: ${drafts.length} draft(s) pending review`);

  // ── Phase 6g5: Writing Judge (AutoNovel-inspired evaluate-retry loop) ──
  gw.writingJudge = new WritingJudgeService();
  console.log('  ✓ Writing judge: mechanical screen + LLM judge ready');

  // ── Phase 6g6: Research services (sourced lookup + video extraction) ──
  gw.researchLookup = new ResearchLookupService();
  gw.researchLookup.setDependencies(gw.vault, gw.aiRouter);

  gw.videoResearch = new VideoResearchService(join(ROOT_DIR, 'workspace'));
  gw.videoResearch.setDependencies(gw.vault, gw.aiRouter);
  const videoDoctor = await gw.videoResearch.doctor();
  if (videoDoctor.ready) {
    console.log(`  ✓ Research lookup ready (Perplexity via OpenRouter or fallback) | Video research ready (yt-dlp${videoDoctor.ffmpegInstalled ? ' + ffmpeg' : ''}${videoDoctor.whisperKeyConfigured ? ' + Whisper' : ''})`);
  } else {
    console.log('  ✓ Research lookup ready | Video research disabled (yt-dlp not installed — see /api/video/doctor)');
  }

  // ── Phase 6g7: Story Structures (smart-recommend, not forced) ──
  gw.storyStructures = new StoryStructureService();
  console.log(`  ✓ Story structures: ${gw.storyStructures.list().length} structures available (Save the Cat, three-act, five-act / Freytag, Seven-Point / Wells, Hero's Journey, Romancing the Beat, Story Circle, Mystery 5-Stage, Martell Thematic, none)`);

  // ── Phase 6g8: Plot Promises (Sanderson-style promises + payoffs) ──
  gw.plotPromises = new PlotPromisesService(join(ROOT_DIR, 'workspace'));
  await gw.plotPromises.initialize();
  console.log(`  ✓ Plot promises: tracker ready`);

  // ── Phase 6g9: Character voices (per-character StyleClone fingerprinting) ──
  // styleClone is wired in Phase 6j (initExportAndWaves), once it exists.
  gw.characterVoices = new CharacterVoicesService(join(ROOT_DIR, 'workspace'));
  await gw.characterVoices.initialize();
  console.log(`  ✓ Character voices: per-character voice drift tracker ready`);
}
