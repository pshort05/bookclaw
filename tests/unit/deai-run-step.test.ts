import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSweepBaseDraft, runDeaiSweepStep } from '../../gateway/src/services/deai/run-step.js';
import { parseBannedCsv } from '../../gateway/src/services/deai/banned-terms.js';

const draftStep = (n: number, result: string) =>
  ({ skill: 'romance-sweet-first-draft', role: 'draft', chapterNumber: n, status: 'completed', result });
const applyStep = (n: number, result: string) =>
  ({ skill: 'deterministic-apply', chapterNumber: n, status: 'completed', result });

test('resolveSweepBaseDraft prefers a completed consistency-apply over the raw draft', () => {
  const steps = [draftStep(1, 'RAW DRAFT'), applyStep(1, 'CONSISTENCY APPLIED')];
  assert.equal(resolveSweepBaseDraft(steps, 1), 'CONSISTENCY APPLIED');
});

test('resolveSweepBaseDraft falls back to the raw draft when no apply step ran', () => {
  const steps = [draftStep(2, 'RAW DRAFT 2')];
  assert.equal(resolveSweepBaseDraft(steps, 2), 'RAW DRAFT 2');
});

test('runDeaiSweepStep wires banned-terms + router audit into the sweep and returns final text', async () => {
  const steps = [draftStep(1, 'The phone buzzed. She utilized the oven.')];
  const banned = parseBannedCsv('find,replace\nphone buzzed,phone vibrated');
  // Fake router: pass 1 flags "utilized"; pass 2 clean.
  let sawPass2Framing = false;
  const aiComplete = async (req: any): Promise<{ text?: string }> => {
    const system = String(req.system ?? '');
    if (/SECOND-READER/.test(system)) { sawPass2Framing = true; return { text: '[]' }; }
    return { text: '[{"op":"swap","find":"utilized","replace":"used"}]' };
  };
  const res = await runDeaiSweepStep({
    steps, chapterNumber: 1,
    skillContent: '# De-AI Audit skill body',
    banned, aiComplete,
  });
  assert.equal(res.text, 'The phone vibrated. She used the oven.');
  assert.equal(res.bannedCounts['phone buzzed'], 1);
  assert.equal(res.passes, 2);
  assert.equal(sawPass2Framing, true, 'pass 2 used the second-reader framing');
});
