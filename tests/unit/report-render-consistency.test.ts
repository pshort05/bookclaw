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

test('handles an empty report', () => {
  const out = renderConsistencyReport({ findings: [], chaptersScanned: 0, factCount: 0, knowledgeEventCount: 0, nonCanonicalSceneCount: 0, reverseIndex: [], orphanFacts: [], generatedAt: '2026-06-25T01:00:00Z' } as any);
  assert.match(out.markdown, /# Consistency/);
  assert.match(out.summary, /0 findings/);
});
