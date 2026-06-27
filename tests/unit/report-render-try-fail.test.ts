import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderTryFailReport } from '../../gateway/src/services/reports/render-try-fail.js';

test('renders ladder table, verdicts, crucible, and findings', () => {
  const report: any = {
    bookSlug: 'the-long-climb',
    protagonists: [{
      protagonist: 'Mara',
      attempts: [
        { protagonist: 'Mara', chapter: 1, goal: 'Cross the river', conflict: 'flood', outcome: 'failure', cost: 'high', personalStakes: 2, peopleAffected: 1 },
        { protagonist: 'Mara', chapter: 5, goal: 'Take the bridge', conflict: 'guards', outcome: 'partial', cost: 'high', personalStakes: 4, peopleAffected: 6 },
      ],
      deepens: true,
      broadens: true,
      firstAttemptOutcome: 'failure',
      findings: [],
    }],
    crucible: {
      present: true,
      strongest: 'strong',
      signals: [{ kind: 'duty', description: 'sworn oath to the village', strength: 'strong', chapter: 1 }],
    },
    findings: [
      { severity: 'high', category: 'early_easy_win', protagonist: 'Mara', chapter: 1, detail: 'First win came too cheap.' },
      { severity: 'medium', category: 'flat_escalation', protagonist: 'Mara', detail: 'Stakes plateau in the middle.' },
    ],
    summary: 'ignored',
    condensed: false,
    generatedAt: '2026-06-27T00:00:00.000Z',
  };

  const out = renderTryFailReport(report);
  assert.equal(out.title, 'Try-Fail & Escalation report');
  assert.match(out.markdown, /# Try-Fail & Escalation report/);
  assert.match(out.markdown, /### Mara/);
  assert.match(out.markdown, /Cross the river/);
  assert.match(out.markdown, /\| Chapter \| Goal \| Outcome \| Cost \| Stakes \| Affected \|/);
  assert.match(out.markdown, /Deepens \(stakes rise\): yes/);
  assert.match(out.markdown, /Broadens \(affects more people\): yes/);
  assert.match(out.markdown, /Crucible check/);
  assert.match(out.markdown, /sworn oath to the village/);
  assert.match(out.markdown, /early_easy_win/);
  assert.match(out.markdown, /First win came too cheap\./);
  assert.equal(out.summary, '1 protagonist, 2 findings (1 high)');
});

test('handles an empty report (no protagonists, no findings)', () => {
  const report: any = {
    bookSlug: 'empty',
    protagonists: [],
    crucible: { present: false, strongest: 'none', signals: [] },
    findings: [],
    summary: '',
    condensed: false,
    generatedAt: '2026-06-27T00:00:00.000Z',
  };
  const out = renderTryFailReport(report);
  assert.match(out.markdown, /# Try-Fail & Escalation report/);
  assert.match(out.markdown, /No protagonists were identified\./);
  assert.match(out.markdown, /No findings/);
  assert.equal(out.summary, '0 protagonists, 0 findings (0 high)');
});
