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
    draft, banned, availableProviders: ['openrouter'],
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
  const res = await runChunkedDeAiSweep({ draft, banned, availableProviders: ['openrouter'], deps: { auditWindow, applyEdits } });
  assert.equal(res.text, 'She used it. Then she used it.');
  assert.equal(res.passes, 2);
  assert.ok(calls >= 2 && calls <= 4, 'no third pass');
});

test('a thrown window audit is fail-soft (skipped, not fatal) and still runs pass 2', async () => {
  const banned = parseBannedCsv('find,replace');
  const res = await runChunkedDeAiSweep({
    draft: 'She utilized it.', banned, availableProviders: ['openrouter'],
    deps: { auditWindow: async () => { throw new Error('boom'); }, applyEdits },
  });
  assert.equal(res.text, 'She utilized it.'); // no crash, no edits
  assert.equal(res.passes, 2);                 // errored pass 1 must NOT short-circuit
});

test('clean empty pass 1 (no errors) short-circuits at passes=1', async () => {
  const banned = parseBannedCsv('find,replace');
  let calls = 0;
  const res = await runChunkedDeAiSweep({
    draft: 'A calm clean paragraph.', banned, availableProviders: ['openrouter'],
    deps: { auditWindow: async () => { calls++; return []; }, applyEdits },
  });
  assert.equal(res.passes, 1);
  assert.equal(calls, 1, 'pass 2 must not run when pass 1 was clean');
});

test('errored empty pass 1 runs pass 2 which can still fix residue', async () => {
  const banned = parseBannedCsv('find,replace');
  const auditWindow = async ({ pass }: { pass: 1 | 2 }): Promise<DeAiEdit[]> => {
    if (pass === 1) throw new Error('provider down');
    return [{ op: 'swap', find: 'utilized', replace: 'used' }];
  };
  const res = await runChunkedDeAiSweep({
    draft: 'She utilized it.', banned, availableProviders: ['openrouter'],
    deps: { auditWindow, applyEdits },
  });
  assert.equal(res.passes, 2);
  assert.equal(res.text, 'She used it.');
});

test('preflight: no available provider skips LLM passes (passes=0) but keeps deterministic stages', async () => {
  const banned = parseBannedCsv('find,replace\nphone buzzed,phone vibrated');
  let audited = false;
  const res = await runChunkedDeAiSweep({
    draft: 'The phone buzzed. She utilized it.', banned, availableProviders: [],
    deps: { auditWindow: async () => { audited = true; return []; }, applyEdits },
  });
  assert.equal(res.passes, 0);
  assert.equal(audited, false, 'no window audit runs without a provider');
  assert.equal(res.text, 'The phone vibrated. She utilized it.'); // banned stage still applied
});

test('preflight: default pass-1 gemini falls back and the resolved model reaches auditWindow', async () => {
  const banned = parseBannedCsv('find,replace');
  const seen: Array<{ provider: string; model: string; pass: 1 | 2 }> = [];
  const auditWindow = async (w: { provider: string; model: string; pass: 1 | 2 }) => {
    seen.push({ provider: w.provider, model: w.model, pass: w.pass });
    return [] as DeAiEdit[];
  };
  const res = await runChunkedDeAiSweep({
    draft: 'A clean paragraph.', banned,
    // native gemini NOT available; openrouter is -> pass 1 should route via openrouter
    availableProviders: ['openrouter'],
    stageModels: { deai_pass1: { provider: 'gemini', model: 'auto:newest-gemini' } },
    deps: { auditWindow, applyEdits },
  });
  assert.equal(res.passes, 1); // clean, short-circuit
  assert.deepEqual(seen[0], { provider: 'openrouter', model: 'google/gemini-2.5-flash', pass: 1 });
});

test('secondReaderFraming redirects to subtle residue', () => {
  assert.match(secondReaderFraming(), /residue|subtler|button|already/i);
});
