// tests/unit/plot-promises-redherring.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PlotPromisesService } from '../../gateway/src/services/plot-promises.js';

const aiSelectProvider = () => ({ id: 'stub' });
const paidOffComplete = async () => ({ text: JSON.stringify({ status: 'paid_off', confidence: 0.9, evidence: 'resolved' }) });

test('red herring "paid off" yields a warning, not a payoff', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pp-rh-'));
  try {
    const svc = new PlotPromisesService(join(root, 'workspace'));
    await svc.addPromise('proj1', {
      title: 'The butler did it', description: 'misdirection toward the butler',
      category: 'red_herring', introducedAtChapter: 1, status: 'open',
    } as any);

    const updated = await svc.detectPayoffsInChapter({
      projectId: 'proj1', chapterNumber: 5, chapterText: 'The butler is cleared.',
      aiComplete: paidOffComplete, aiSelectProvider,
    });
    assert.equal(updated.length, 1);
    assert.notEqual(updated[0].status, 'paid_off', 'red herring must NOT auto-close as paid_off');
    assert.equal(updated[0].redHerringResolvedAtChapter, 5);

    const report = await svc.audit('proj1', 100);
    assert.equal(report.redHerringWarnings.length, 1);
    assert.equal(report.redHerringWarnings[0].chapter, 5);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('merge re-extraction preserves an author-added promise the LLM did not re-extract (M4)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pp-merge-'));
  try {
    const svc = new PlotPromisesService(join(root, 'workspace'));
    const author = await svc.addPromise('proj1', {
      title: 'The lost locket', description: 'a sentimental subplot the author tracks',
      category: 'subplot', introducedAtChapter: 1, status: 'open',
    } as any);

    // LLM re-extracts a totally different promise and never mentions the locket.
    const extractComplete = async () => ({
      text: JSON.stringify({ promises: [
        { title: 'The hidden inheritance', description: 'a new mystery', category: 'mystery', confidence: 0.8 },
      ] }),
    });

    const result = await svc.extractFromOpening({
      projectId: 'proj1', openingChapterText: 'Once upon a time...',
      aiComplete: extractComplete, aiSelectProvider, merge: true,
    });

    const titles = result.promises.map(p => p.title);
    assert.ok(titles.includes('The hidden inheritance'), 'newly extracted promise present');
    assert.ok(titles.includes('The lost locket'), 'author-added promise survived merge');
    const survivor = result.promises.find(p => p.title === 'The lost locket')!;
    assert.equal(survivor.id, author.id, 'preserves the original id/fields');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('non-red-herring "paid off" still closes (regression)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pp-norm-'));
  try {
    const svc = new PlotPromisesService(join(root, 'workspace'));
    await svc.addPromise('proj1', {
      title: 'Find the heir', description: 'mystery of the heir',
      category: 'mystery', introducedAtChapter: 1, status: 'open',
    } as any);
    const updated = await svc.detectPayoffsInChapter({
      projectId: 'proj1', chapterNumber: 5, chapterText: 'The heir is revealed.',
      aiComplete: paidOffComplete, aiSelectProvider,
    });
    assert.equal(updated[0].status, 'paid_off');
    const report = await svc.audit('proj1', 100);
    assert.equal(report.redHerringWarnings.length, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
