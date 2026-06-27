import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderConsistencyReport } from '../../gateway/src/services/reports/render-consistency.js';

test('renders summary + findings grouped with chapter refs', () => {
  const report: any = {
    findings: [{ category: 'contradiction', severity: 'high', entity: 'John', attribute: 'eye_color',
      a: { chapter: 'chapter-2', scene: 0, quote: 'green eyes' }, b: { chapter: 'chapter-1', scene: 0, quote: 'blue eyes' },
      explanation: "John's eye_color differs", suggestedFix: 'reconcile' }],
    chaptersScanned: 5, factCount: 20, knowledgeEventCount: 2, nonCanonicalSceneCount: 1,
    reverseIndex: [{ entity: 'John', attribute: 'eye_color', chapters: ['chapter-1', 'chapter-2'], isCanon: true }],
    orphanFacts: [{ entity: 'Sword', attribute: 'location', valueRaw: 'the vault', world: 'w1' }],
    generatedAt: '2026-06-25T01:00:00Z',
  };
  const out = renderConsistencyReport(report);
  assert.match(out.title, /Consistency/);
  assert.match(out.markdown, /# Consistency/);
  assert.match(out.markdown, /eye_color/);
  assert.match(out.markdown, /chapter-2/);
  assert.match(out.markdown, /chapter-1/);
  assert.match(out.markdown, /Sword/);
  assert.match(out.summary, /1 finding/);
});

test('flags an incomplete scan (chaptersFailed > 0) with a warning, the actual reason, and "of N" in the summary', () => {
  const report: any = {
    findings: [], chaptersScanned: 4, chaptersTotal: 23, chaptersFailed: 19,
    failureSamples: ['OpenRouter HTTP 401: Missing Authentication header'], aborted: false,
    factCount: 23, knowledgeEventCount: 0, nonCanonicalSceneCount: 0,
    reverseIndex: [], orphanFacts: [], generatedAt: '2026-06-25T01:00:00Z',
  };
  report.estimatedCost = 5.7076;
  const out = renderConsistencyReport(report);
  assert.match(out.markdown, /Incomplete scan/);
  assert.match(out.markdown, /19 of 23/);
  assert.match(out.markdown, /Estimated AI cost: ~\$5\.7076/, 'shows the run cost');
  assert.match(out.markdown, /Failure reason/);
  assert.match(out.markdown, /401: Missing Authentication header/, 'shows the real reason, not a guess');
  assert.doesNotMatch(out.markdown, /large-context model/, 'no longer assumes the cause is context size');
  assert.match(out.summary, /4\/23/);
  assert.match(out.summary, /19 failed/);
});

test('an aborted scan says "aborted" and lists the systemic reason', () => {
  const report: any = {
    findings: [], chaptersScanned: 0, chaptersTotal: 23, chaptersFailed: 3,
    failureSamples: ['OpenRouter HTTP 401: Missing Authentication header'], aborted: true,
    factCount: 0, knowledgeEventCount: 0, nonCanonicalSceneCount: 0,
    reverseIndex: [], orphanFacts: [], generatedAt: '2026-06-25T01:00:00Z',
  };
  const out = renderConsistencyReport(report);
  assert.match(out.markdown, /aborted/i);
  assert.match(out.markdown, /401/);
});

test('renders the per-chapter summary chart as a markdown table', () => {
  const report: any = {
    findings: [], chaptersScanned: 2, chaptersTotal: 2, chaptersFailed: 0,
    factCount: 5, knowledgeEventCount: 0, nonCanonicalSceneCount: 0,
    reverseIndex: [], orphanFacts: [], generatedAt: '2026-06-26T01:00:00Z',
    chapterSummary: [
      { chapter: 'chapter-1', status: 'scanned', itemsTracked: 3, high: 1, medium: 0, low: 2 },
      { chapter: 'chapter-2', status: 'failed', itemsTracked: 0, high: 0, medium: 0, low: 0 },
    ],
  };
  const out = renderConsistencyReport(report);
  assert.match(out.markdown, /## Chapter summary/);
  assert.match(out.markdown, /\| Chapter \| Scan \| High \| Medium \| Low \| Items tracked \|/);
  assert.match(out.markdown, /\| chapter-1 \| ✓ scanned \| 1 \| 0 \| 2 \| 3 \|/);
  assert.match(out.markdown, /\| chapter-2 \| ✗ failed \| 0 \| 0 \| 0 \| 0 \|/);
});

test('handles an empty report', () => {
  const out = renderConsistencyReport({ findings: [], chaptersScanned: 0, factCount: 0, knowledgeEventCount: 0, nonCanonicalSceneCount: 0, reverseIndex: [], orphanFacts: [], generatedAt: '2026-06-25T01:00:00Z' } as any);
  assert.match(out.markdown, /# Consistency/);
  assert.match(out.summary, /0 findings/);
});
