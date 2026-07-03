/**
 * Integration-seam test for Task 2's wiring: `ProjectEngine.buildProjectContext`
 * for a book-production "Write Chapter N" step should use `buildRollingSummary`
 * fed by a REAL `ContextEngine` (not a stub), per the plan's preference for
 * driving the real service over a fake where feasible.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ProjectEngine } from '../../gateway/src/services/projects.js';
import { ContextEngine } from '../../gateway/src/services/context-engine.js';

// A real ContextEngine.generateSummary needs an AICompleteFn — this fake
// returns the exact JSON shape SUMMARY_PROMPT asks for. It THROWS if given a
// provider id other than the one the caller was told to use, so a mis-wire
// (e.g. calling generateSummary with a hardcoded/wrong provider) surfaces
// here rather than being silently swallowed.
function makeFakeAiComplete(expectedProvider: string) {
  return async (req: any) => {
    if (req.provider !== expectedProvider) {
      throw new Error(`unexpected provider "${req.provider}", expected "${expectedProvider}"`);
    }
    const chapterMatch = String(req.messages?.[0]?.content ?? '').match(/Chapter (\d+)/);
    const ch = chapterMatch ? chapterMatch[1] : '0';
    return {
      text: JSON.stringify({
        summary: `Full detailed summary of chapter ${ch} events and revelations.`,
        characters: ['Ann'],
        locations: ['Manor'],
        timelineMarker: `Day ${ch}`,
        plotThreads: ['main plot'],
        endingState: `Chapter ${ch} ends with a cliffhanger.`,
      }),
      tokensUsed: 100,
      estimatedCost: 0,
      provider: expectedProvider,
    };
  };
}

test('buildProjectContext (book-production, write step): a real ContextEngine\'s stored summaries feed buildRollingSummary', async () => {
  const engine = new ProjectEngine(undefined, join(tmpdir(), 'bookclaw-unit-test-no-such-root'));
  const contextEngine = new ContextEngine(mkdtempSync(join(tmpdir(), 'rolling-summary-seam-')));
  engine.setContextEngine(contextEngine);

  const project = engine.createBookProduction('Test Novel', 'A test description', { targetChapters: 4, targetWordsPerChapter: 500 });

  const aiComplete = makeFakeAiComplete('gemini');
  const aiSelectProvider = (_taskType: string) => ({ id: 'gemini' });

  // Mark chapters 1 and 2's write+polish steps completed (as the auto-execute
  // loop does via engine.completeStep) and populate ContextEngine summaries
  // exactly as the routes.ts post-draft hook does (chapterSummaryTarget's
  // summaryId `${project.id}-chapter-${n}`) — buildBookProductionContext's
  // early "no completed steps" guard requires real completed/result state,
  // not just ContextEngine summaries in isolation.
  for (const ch of [1, 2]) {
    const writeStep = project.steps.find(s => s.skill === 'write' && (s as any).chapterNumber === ch)!;
    writeStep.status = 'completed';
    writeStep.result = `Chapter ${ch} full prose text.`;
    const polishStep = project.steps.find(s => s.skill === 'revise' && (s as any).chapterNumber === ch)!;
    polishStep.status = 'completed';
    polishStep.result = `Chapter ${ch} polished prose text.`;
    await contextEngine.generateSummary(
      project.id, `${project.id}-chapter-${ch}`, writeStep.label, ch,
      writeStep.result, aiComplete, aiSelectProvider,
    );
  }

  const chapter3Write = project.steps.find(s => s.skill === 'write' && (s as any).chapterNumber === 3)!;
  const context = await engine.buildProjectContext(project, chapter3Write);

  assert.ok(context.includes('Rolling Story Memory'), 'expected the rolling-summary block to be present');
  assert.ok(context.includes('Full detailed summary of chapter 2 events and revelations.'), 'expected chapter 2 (recent tier) full summary');
  assert.doesNotMatch(context, /Full detailed summary of chapter 3/, 'chapter 3 (the chapter being written) must not leak its own future summary');
});

test('buildProjectContext (book-production, write step): falls back to the raw sliding window when no summaries are stored yet', async () => {
  const engine = new ProjectEngine(undefined, join(tmpdir(), 'bookclaw-unit-test-no-such-root'));
  const contextEngine = new ContextEngine(mkdtempSync(join(tmpdir(), 'rolling-summary-seam-empty-')));
  engine.setContextEngine(contextEngine);

  const project = engine.createBookProduction('Test Novel 2', 'A test description', { targetChapters: 3, targetWordsPerChapter: 500 });
  // Manually complete chapter 1's write step with a raw result, without ever
  // calling generateSummary — mirrors an early state before the ContextEngine
  // hook has run (or a project with ContextEngine disabled).
  const write1 = project.steps.find(s => s.skill === 'write' && (s as any).chapterNumber === 1)!;
  write1.status = 'completed';
  write1.result = 'Raw chapter 1 prose, never summarized.';

  const chapter2Write = project.steps.find(s => s.skill === 'write' && (s as any).chapterNumber === 2)!;
  const context = await engine.buildProjectContext(project, chapter2Write);

  assert.doesNotMatch(context, /Rolling Story Memory/);
  assert.ok(context.includes('Raw chapter 1 prose, never summarized.'));
});
