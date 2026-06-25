import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPlotPromisesReport } from '../../gateway/src/services/reports/render-plot-promises.js';

test('renders counts, at-risk promise, and red-herring warning', () => {
  const report: any = {
    projectId: 'proj-1',
    totalPromises: 2,
    paidOff: 1,
    partialPayoff: 0,
    open: 1,
    intentionallyUnpaid: 0,
    dropped: 0,
    closureRate: 0.5,
    atRiskPromises: [{
      id: 'promise-1', title: 'Will Sarah find her sister?', description: 'A mystery set up early.',
      category: 'mystery', introducedAtChapter: 1, status: 'open', touchedAtChapters: [1, 3],
    }],
    redHerringWarnings: [{ id: 'promise-2', title: 'The locked box', chapter: 7 }],
    summary: 'ignored',
  };
  const out = renderPlotPromisesReport(report);
  assert.equal(out.title, 'Plot Promises report');
  assert.match(out.markdown, /# Plot Promises/);
  assert.match(out.markdown, /Total promises.*2/);
  assert.match(out.markdown, /Paid off.*1/);
  assert.match(out.markdown, /50%/);
  assert.match(out.markdown, /At-risk promises/);
  assert.match(out.markdown, /Will Sarah find her sister\?/);
  assert.match(out.markdown, /Red-herring warnings/);
  assert.match(out.markdown, /The locked box/);
  assert.equal(out.summary, '2 promises, 50% closed');
});

test('handles an empty report (0 promises)', () => {
  const report: any = {
    projectId: 'proj-0',
    totalPromises: 0, paidOff: 0, partialPayoff: 0, open: 0,
    intentionallyUnpaid: 0, dropped: 0, closureRate: 1,
    atRiskPromises: [], redHerringWarnings: [], summary: '',
  };
  const out = renderPlotPromisesReport(report);
  assert.match(out.markdown, /# Plot Promises/);
  assert.match(out.markdown, /Total promises.*0/);
  assert.equal(out.summary, '0 promises, 100% closed');
});
