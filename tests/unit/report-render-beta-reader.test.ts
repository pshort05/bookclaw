import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderBetaReaderReport } from '../../gateway/src/services/reports/render-beta-reader.js';

test('renders aggregate + per-chapter feedback', () => {
  const report: any = {
    projectId: 'p1',
    generatedAt: '2026-06-25T01:00:00Z',
    chapterCount: 2,
    archetypeCount: 4,
    feedback: [
      {
        chapterId: 'ch1', chapterNumber: 1, title: 'The Opening', archetypeId: 'genre-fan', archetypeName: 'Devoted Genre Fan',
        tension: 7, pacing: 'good', wantToContinue: 80, confusion: ['who is the narrator'],
        favoriteMoment: 'the duel', stumblePoint: 'the prologue', emotions: ['curiosity'], overallNote: 'Strong hook.',
      },
    ],
    aggregate: {
      avgTension: 6.5, avgWantToContinue: 72,
      weakestChapter: { number: 2, title: 'The Middle', reason: 'Average tension 5.0/10 across the panel' },
      strongestChapter: { number: 1, title: 'The Opening', reason: 'Average tension 7.0/10 across the panel' },
      topEmotions: ['curiosity', 'dread'], topConfusions: ['who is the narrator'],
    },
  };
  const out = renderBetaReaderReport(report);
  assert.match(out.title, /Beta Reader/);
  assert.match(out.markdown, /Tension/);
  assert.match(out.markdown, /6\.5/);
  assert.match(out.markdown, /The Opening/);
  assert.match(out.markdown, /Devoted Genre Fan/);
  assert.match(out.markdown, /curiosity/);
  assert.equal(out.summary, '2 chapters · 4 readers');
});

test('handles empty feedback', () => {
  const report: any = {
    projectId: 'p2', generatedAt: '2026-06-25T01:00:00Z', chapterCount: 0, archetypeCount: 0,
    feedback: [],
    aggregate: { avgTension: 0, avgWantToContinue: 0, weakestChapter: null, strongestChapter: null, topEmotions: [], topConfusions: [] },
  };
  const out = renderBetaReaderReport(report);
  assert.match(out.title, /Beta Reader/);
  assert.match(out.markdown, /# Beta Reader/);
  assert.equal(out.summary, '0 chapters · 0 readers');
});
