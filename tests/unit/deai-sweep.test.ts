import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runChunkedDeAiSweep, secondReaderFraming } from '../../gateway/src/services/deai/sweep.js';
import { parseBannedCsv } from '../../gateway/src/services/deai/banned-terms.js';
import { applyDeAiEdits } from '../../gateway/src/services/deterministic-apply.js';
import type { DeAiEdit } from '../../gateway/src/services/deterministic-apply.js';

const applyEdits = (base: string, edits: DeAiEdit[]) => applyDeAiEdits(base, edits); // real applier, no rewriteFn

test('banned-terms run first; dialogue preserved end-to-end; empty audits short-circuit', async () => {
  const banned = parseBannedCsv('find,replace\nphone buzzed,phone vibrated');
  const draft = 'The phone buzzed. "The phone buzzed," she said.';
  const res = await runChunkedDeAiSweep({
    draft, banned,
    deps: { auditWindow: async () => [], applyEdits },
  });
  assert.equal(res.text, 'The phone vibrated. "The phone buzzed," she said.');
  assert.equal(res.passes, 1);                 // empty pass-1 merge → short-circuit
  assert.equal(res.bannedCounts['phone buzzed'], 1);
});

test('two passes run when pass 1 yields edits; capped at 2', async () => {
  const banned = parseBannedCsv('find,replace');
  const draft = 'She utilized it. Then she leveraged it.';
  let calls = 0;
  const auditWindow = async ({ pass }: { pass: 1 | 2 }): Promise<DeAiEdit[]> => {
    calls++;
    if (pass === 1) return [{ op: 'swap', find: 'utilized', replace: 'used' }];
    return [{ op: 'swap', find: 'leveraged', replace: 'used' }];
  };
  const res = await runChunkedDeAiSweep({ draft, banned, deps: { auditWindow, applyEdits } });
  assert.equal(res.text, 'She used it. Then she used it.');
  assert.equal(res.passes, 2);
  assert.ok(calls >= 2 && calls <= 4, 'no third pass');
});

test('a thrown window audit is fail-soft (skipped, not fatal)', async () => {
  const banned = parseBannedCsv('find,replace');
  const res = await runChunkedDeAiSweep({
    draft: 'She utilized it.', banned,
    deps: { auditWindow: async () => { throw new Error('boom'); }, applyEdits },
  });
  assert.equal(res.text, 'She utilized it.'); // no crash, no edits
  assert.equal(res.passes, 1);
});

test('secondReaderFraming redirects to subtle residue', () => {
  assert.match(secondReaderFraming(), /residue|subtler|button|already/i);
});
