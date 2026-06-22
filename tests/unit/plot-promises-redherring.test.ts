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
