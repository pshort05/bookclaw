// tests/unit/revision-orchestrator.test.ts
//
// RevisionOrchestrator aggregates findings from the existing craft/dialogue/
// mechanical/voice-drift/continuity detectors into one prioritized report.
// Every detector is faked here (structural — see *Like interfaces in the
// service file) so these tests exercise only the orchestrator's own
// aggregation logic: severity synthesis, dedupe, sort, and per-pass
// skip/throw isolation. No AI call is made anywhere in this file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RevisionOrchestrator,
  type CraftCriticLike,
  type DialogueAuditorLike,
  type WritingJudgeLike,
  type CharacterVoicesLike,
} from '../../gateway/src/services/revision-orchestrator.js';
import type { ContinuityFlag } from '../../gateway/src/services/consistency/continuity-check.js';

function chapter(overrides: Partial<{ id: string; number: number; title: string; text: string; continuityFlags: ContinuityFlag[] }> = {}) {
  return {
    id: overrides.id ?? 'ch1',
    number: overrides.number ?? 1,
    title: overrides.title ?? 'Chapter One',
    text: overrides.text ?? 'Some chapter text.',
    continuityFlags: overrides.continuityFlags,
  };
}

test('findingsBySeverity and findingsByPass counts match the faked detector output', async () => {
  const craftCritic: CraftCriticLike = {
    analyze: () => ({
      generatedAt: '', projectId: 'p1', overall: {} as any, chapters: [], beats: [], saveTheCatAdherence: 0,
      flags: [
        { chapterId: 'ch1', chapterNumber: 1, title: 'Chapter One', category: 'adverbs', severity: 'info', description: '12 adverbs', suggestion: 'trim' },
        { chapterId: 'ch1', chapterNumber: 1, title: 'Chapter One', category: 'sag', severity: 'warning', description: 'sags here', suggestion: 'add stakes' },
      ],
    }),
  };
  const dialogueAuditor: DialogueAuditorLike = {
    audit: () => ({
      totalLines: 1, attributed: 1, unattributed: 0, fingerprints: [],
      flags: [
        { chapterId: 'ch1', paragraphIndex: 0, speaker: 'Alice', line: 'hi', reason: 'unusually casual', severity: 'warning' },
      ],
    }),
  };
  const writingJudge: WritingJudgeLike = {
    mechanicalScreen: () => ({
      wordCount: 100, score: 90,
      issues: [
        { category: 'cliche', severity: 'error', description: 'cliche found', examples: ['dark and stormy'], count: 1 },
      ],
    }),
  };

  const orch = new RevisionOrchestrator({ craftCritic, dialogueAuditor, writingJudge });
  const report = await orch.buildReport({ projectId: 'p1', chapters: [chapter()] });

  assert.equal(report.totalFindings, 4);
  assert.equal(report.findingsBySeverity.error, 1);
  assert.equal(report.findingsBySeverity.warning, 2);
  assert.equal(report.findingsBySeverity.info, 1);
  assert.equal(report.findingsByPass.craft, 2);
  assert.equal(report.findingsByPass.dialogue, 1);
  assert.equal(report.findingsByPass.mechanical, 1);
  assert.deepEqual(new Set(report.passesRun), new Set(['craft', 'dialogue', 'mechanical']));
});

test('continuity pass synthesizes severity: contradiction=error, timeline/knowledge/red_herring=warning', async () => {
  const flags: ContinuityFlag[] = [
    { kind: 'contradiction', detail: 'eye color changed' },
    { kind: 'timeline', detail: 'two Tuesdays in a row' },
    { kind: 'knowledge', detail: 'knows a secret too early' },
    { kind: 'red_herring', detail: 'clue revealed prematurely' },
  ];
  const orch = new RevisionOrchestrator({});
  const report = await orch.buildReport({ chapters: [chapter({ continuityFlags: flags })] });

  const byKind = new Map(report.findings.map(f => [f.category, f.severity]));
  assert.equal(byKind.get('contradiction'), 'error');
  assert.equal(byKind.get('timeline'), 'warning');
  assert.equal(byKind.get('knowledge'), 'warning');
  assert.equal(byKind.get('red_herring'), 'warning');
  assert.ok(report.passesRun.includes('continuity'));
  // No new AI call is made — the pass only reads chapter.continuityFlags, so no
  // detector dependency was even wired in for this test.
});

test('continuity pass with no continuityFlags on the chapter is skipped, not an empty run', async () => {
  const orch = new RevisionOrchestrator({});
  const report = await orch.buildReport({ chapters: [chapter()] });
  assert.ok(report.passesSkipped.includes('continuity'));
  assert.ok(!report.passesRun.includes('continuity'));
});

test('voice pass hardcodes severity to warning and only keeps z>2 flags as Findings', async () => {
  const characterVoices: CharacterVoicesLike = {
    detectDrift: async () => ({
      projectId: 'p1', chapterNumber: 1,
      characters: [
        {
          name: 'Alice', linesInChapter: 5, wordsInChapter: 50, driftScore: 40,
          flags: [
            { characterName: 'Alice', chapterNumber: 1, excerpt: '"hi"', marker: 'contraction use', expected: 0.1, actual: 0.9, zScore: 3.2, note: 'much more casual' },
            { characterName: 'Alice', chapterNumber: 1, excerpt: '"ok"', marker: 'question rate', expected: 0.1, actual: 0.15, zScore: 1.1, note: 'negligible' },
          ],
        },
      ],
      overallDriftScore: 40, summary: 'drift detected',
    }),
  };
  const orch = new RevisionOrchestrator({ characterVoices });
  const report = await orch.buildReport({ projectId: 'p1', chapters: [chapter()] });

  assert.equal(report.findings.length, 1);
  assert.equal(report.findings[0].pass, 'voice');
  assert.equal(report.findings[0].severity, 'warning');
  assert.equal(report.findings[0].location, 'Alice');
  assert.ok(report.passesRun.includes('voice'));
});

test('voice pass is skipped without a projectId even when characterVoices is wired', async () => {
  const characterVoices: CharacterVoicesLike = {
    detectDrift: async () => { throw new Error('should not be called'); },
  };
  const orch = new RevisionOrchestrator({ characterVoices });
  const report = await orch.buildReport({ chapters: [chapter()] });
  assert.ok(report.passesSkipped.includes('voice'));
});

test('a null/undefined dependency is skipped, not run, and never throws', async () => {
  const orch = new RevisionOrchestrator({}); // every dep omitted
  const report = await orch.buildReport({ projectId: 'p1', chapters: [chapter({ continuityFlags: [] })] });

  assert.deepEqual(new Set(report.passesSkipped), new Set(['craft', 'dialogue', 'voice', 'mechanical']));
  assert.equal(report.passesRun.length, 1); // continuity ran (with zero flags → zero findings)
  assert.equal(report.totalFindings, 0);
});

test('dedup collapses near-identical cross-chapter findings (same category/location, numbers differ)', async () => {
  const dialogueAuditor: DialogueAuditorLike = {
    audit: (text, chapterId) => ({
      totalLines: 1, attributed: 1, unattributed: 0, fingerprints: [],
      flags: [
        {
          chapterId, paragraphIndex: 0, speaker: 'Bob',
          reason: chapterId === 'ch1'
            ? 'Bob is unusually casual here (contractions 80% vs their baseline 20%)'
            : 'Bob is unusually casual here (contractions 90% vs their baseline 25%)',
          severity: 'warning',
        },
      ],
    }),
  };
  const orch = new RevisionOrchestrator({ dialogueAuditor });
  const report = await orch.buildReport({
    chapters: [chapter({ id: 'ch1' }), chapter({ id: 'ch2', number: 2 })],
  });

  // Location is the speaker name (not the chapter id) for the dialogue pass,
  // so the two near-identical cross-chapter findings collapse into one.
  assert.equal(report.findings.length, 1);
  assert.equal(report.findings[0].location, 'Bob');
});

test('sort orders error before warning before info, then by canonical pass order within a severity', async () => {
  const craftCritic: CraftCriticLike = {
    analyze: () => ({
      generatedAt: '', projectId: '', overall: {} as any, chapters: [], beats: [], saveTheCatAdherence: 0,
      flags: [
        { chapterId: 'ch1', chapterNumber: 1, title: '', category: 'sag', severity: 'warning', description: 'craft warning', suggestion: '' },
      ],
    }),
  };
  const dialogueAuditor: DialogueAuditorLike = {
    audit: () => ({
      totalLines: 1, attributed: 1, unattributed: 0, fingerprints: [],
      flags: [{ chapterId: 'ch1', paragraphIndex: 0, speaker: 'X', line: '', reason: 'dialogue warning', severity: 'warning' }],
    }),
  };
  const writingJudge: WritingJudgeLike = {
    mechanicalScreen: () => ({
      wordCount: 1, score: 1,
      issues: [{ category: 'cliche', severity: 'error', description: 'mechanical error', examples: [], count: 1 }],
    }),
  };
  const orch = new RevisionOrchestrator({ craftCritic, dialogueAuditor, writingJudge });
  const report = await orch.buildReport({
    chapters: [chapter({ continuityFlags: [{ kind: 'timeline', detail: 'continuity warning' }] })],
  });

  // Expect: mechanical error first (only error), then warnings in canonical
  // REVISION_PASSES order: craft, dialogue, continuity.
  assert.equal(report.findings[0].pass, 'mechanical');
  assert.equal(report.findings[0].severity, 'error');
  const warnings = report.findings.slice(1);
  assert.deepEqual(warnings.map(f => f.pass), ['craft', 'dialogue', 'continuity']);
});

test('a throwing detector is isolated to passesSkipped; other passes still run', async () => {
  const craftCritic: CraftCriticLike = {
    analyze: () => { throw new Error('boom'); },
  };
  const writingJudge: WritingJudgeLike = {
    mechanicalScreen: () => ({
      wordCount: 1, score: 1,
      issues: [{ category: 'cliche', severity: 'error', description: 'still runs', examples: [], count: 1 }],
    }),
  };
  const orch = new RevisionOrchestrator({ craftCritic, writingJudge });
  const report = await orch.buildReport({ chapters: [chapter()] });

  assert.ok(report.passesSkipped.includes('craft'));
  assert.ok(!report.passesRun.includes('craft'));
  assert.ok(report.passesRun.includes('mechanical'));
  assert.equal(report.findingsByPass.mechanical, 1);
});

test('passes filter runs only the requested passes', async () => {
  const craftCritic: CraftCriticLike = {
    analyze: () => ({
      generatedAt: '', projectId: '', overall: {} as any, chapters: [], beats: [], saveTheCatAdherence: 0,
      flags: [{ chapterId: 'ch1', chapterNumber: 1, title: '', category: 'sag', severity: 'info', description: 'x', suggestion: '' }],
    }),
  };
  const writingJudge: WritingJudgeLike = {
    mechanicalScreen: () => ({
      wordCount: 1, score: 1,
      issues: [{ category: 'cliche', severity: 'error', description: 'y', examples: [], count: 1 }],
    }),
  };
  const orch = new RevisionOrchestrator({ craftCritic, writingJudge });
  const report = await orch.buildReport({ chapters: [chapter()], passes: ['craft'] });

  assert.deepEqual(report.passesRun, ['craft']);
  assert.equal(report.findingsByPass.mechanical, undefined);
});
