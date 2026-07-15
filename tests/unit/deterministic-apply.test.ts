import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAuditEdits, applyDeAiEdits, runDeterministicApply, type DeAiEdit } from '../../gateway/src/services/deterministic-apply.js';

const DRAFT = `Chapter 4.\n\nShe utilized the old coal oven. The rain fell on flour, sugar, and salt. Gia was furious. The night held on.`;

test('parseAuditEdits pulls a JSON array out of surrounding prose/fences', () => {
  const raw = 'Here are the edits:\n```json\n[{"op":"swap","find":"utilized","replace":"used"},{"op":"rewrite","find":"Gia was furious.","instruction":"show it"}]\n```\ndone';
  const edits = parseAuditEdits(raw);
  assert.equal(edits.length, 2);
  assert.deepEqual(edits[0], { op: 'swap', find: 'utilized', replace: 'used', reason: undefined });
  assert.equal(edits[1].op, 'rewrite');
});

test('parseAuditEdits returns [] on garbage (→ apply nothing, chapter = draft)', () => {
  assert.deepEqual(parseAuditEdits('not json at all'), []);
  assert.deepEqual(parseAuditEdits(''), []);
  assert.deepEqual(parseAuditEdits('{"not":"an array"}'), []);
});

test('parseAuditEdits picks the richest array when the model emits several (self-correction)', () => {
  // Observed on Neptune: the audit model emitted a throwaway array, corrected
  // itself in prose, then emitted the real edit list. Grabbing the FIRST array
  // silently applied nothing. The real (richer) list must win.
  const raw =
    '[{"op":"swap","find":"a beat that isn\'t earned","replace":"","reason":"placeholder not in draft"}]\n\n' +
    'Wait, let me actually scan the draft properly.\n\n' +
    '[{"op":"swap","find":"It wasn\'t hope exactly","replace":"It wasn\'t quite hope","reason":"hedge"},' +
    '{"op":"rewrite","find":"My whole body had set like a bad custard.","instruction":"tighten","reason":"metaphor"}]';
  const edits = parseAuditEdits(raw);
  assert.equal(edits.length, 2);
  assert.equal(edits[0].find, "It wasn't hope exactly");
  assert.equal(edits[1].op, 'rewrite');
});

test('parseAuditEdits ignores trailing prose brackets (real list stays, "[3]" is not an edit)', () => {
  const raw = '[{"op":"swap","find":"utilized","replace":"used"}]\nSee the note in chapter [3] for context.';
  const edits = parseAuditEdits(raw);
  assert.equal(edits.length, 1);
  assert.equal(edits[0].find, 'utilized');
});

test('applyDeAiEdits: swaps are literal find-and-replace, length/content preserved elsewhere', async () => {
  const edits: DeAiEdit[] = [
    { op: 'swap', find: 'utilized', replace: 'used' },
    { op: 'swap', find: 'flour, sugar, and salt', replace: 'flour, sugar and salt' },
  ];
  const r = await applyDeAiEdits(DRAFT, edits);
  assert.match(r.text, /She used the old coal oven/);
  assert.match(r.text, /flour, sugar and salt/);   // Oxford comma removed
  assert.match(r.text, /The night held on\./);      // untouched tail preserved verbatim
  assert.equal(r.appliedSwaps, 2);
  assert.equal(r.skipped, 0);
});

test('applyDeAiEdits: a find span not present is SKIPPED, never invented', async () => {
  const edits: DeAiEdit[] = [{ op: 'swap', find: 'a wedding reception that is not in the draft', replace: 'X' }];
  const r = await applyDeAiEdits(DRAFT, edits);
  assert.equal(r.text, DRAFT);       // unchanged — no drift possible
  assert.equal(r.appliedSwaps, 0);
  assert.equal(r.skipped, 1);
});

test('applyDeAiEdits: rewrite calls the scoped fn only for that span', async () => {
  const calls: Array<[string, string]> = [];
  const rewriteFn = async (span: string, instruction: string) => { calls.push([span, instruction]); return 'Her jaw tightened.'; };
  const edits: DeAiEdit[] = [{ op: 'rewrite', find: 'Gia was furious.', instruction: 'show, don\'t tell' }];
  const r = await applyDeAiEdits(DRAFT, edits, rewriteFn);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], ['Gia was furious.', 'show, don\'t tell']);
  assert.match(r.text, /Her jaw tightened\./);
  assert.ok(!r.text.includes('Gia was furious.'));
  assert.equal(r.appliedRewrites, 1);
});

test('applyDeAiEdits: a ballooned scoped rewrite is guarded — original span kept', async () => {
  const rewriteFn = async () => 'x'.repeat(5000);  // model over-generated a whole new scene
  const edits: DeAiEdit[] = [{ op: 'rewrite', find: 'Gia was furious.', instruction: 'show it' }];
  const r = await applyDeAiEdits(DRAFT, edits, rewriteFn);
  assert.match(r.text, /Gia was furious\./);   // kept the original — drift blocked
  assert.equal(r.appliedRewrites, 0);
  assert.equal(r.skipped, 1);
});

test('applyDeAiEdits: rewrite with no rewriteFn is skipped (fully deterministic mode)', async () => {
  const edits: DeAiEdit[] = [{ op: 'rewrite', find: 'Gia was furious.', instruction: 'show it' }];
  const r = await applyDeAiEdits(DRAFT, edits);
  assert.equal(r.text, DRAFT);
  assert.equal(r.skipped, 1);
});

test('runDeterministicApply wires the draft + audit steps by chapter', async () => {
  const steps = [
    { chapterNumber: 4, role: 'draft', status: 'completed', result: DRAFT },
    { chapterNumber: 4, skill: 'romance-deai-audit', status: 'completed', result: '[{"op":"swap","find":"utilized","replace":"used"}]' },
    { chapterNumber: 4, skill: 'deterministic-apply', status: 'active', result: undefined },
  ];
  const { text, stats } = await runDeterministicApply(steps, steps[2], async (s) => s);
  assert.match(text, /She used the old coal oven/);
  assert.equal(stats.appliedSwaps, 1);
});

test('runDeterministicApply throws (does not emit an empty chapter) when the draft is missing', async () => {
  const steps = [{ chapterNumber: 4, skill: 'deterministic-apply', status: 'active' as const }];
  await assert.rejects(() => runDeterministicApply(steps, steps[0], async (s) => s), /no completed draft/);
});

test('applyDeAiEdits: a ballooned SWAP replace is guarded — original kept (drift blocked)', async () => {
  const edits: DeAiEdit[] = [{ op: 'swap', find: 'The night held on.', replace: 'X'.repeat(2000) }];
  const r = await applyDeAiEdits(DRAFT, edits);
  assert.match(r.text, /The night held on\./);   // whole-scene injection rejected
  assert.equal(r.appliedSwaps, 0);
  assert.equal(r.skipped, 1);
});

test('parseAuditEdits: balanced extraction survives trailing prose with a bracket', () => {
  const raw = '[{"op":"swap","find":"utilized","replace":"used"}]\n\nNote: also see chapter [3] for context.';
  const edits = parseAuditEdits(raw);
  assert.equal(edits.length, 1);
  assert.equal(edits[0].replace, 'used');
});

test('parseAuditEdits: brackets inside string values do not break extraction', () => {
  const raw = '[{"op":"swap","find":"the list [a, b]","replace":"the list a and b"}]';
  const edits = parseAuditEdits(raw);
  assert.equal(edits.length, 1);
  assert.equal(edits[0].find, 'the list [a, b]');
});

test('runDeterministicApply gathers edits from BOTH consistency + de-ai audits (consistency first)', async () => {
  const draft = 'His blue eyes watched the rain. She utilized the old oven.';
  const steps = [
    { chapterNumber: 4, role: 'draft', status: 'completed', result: draft },
    { chapterNumber: 4, skill: 'romance-deai-audit', status: 'completed', result: '[{"op":"swap","find":"utilized","replace":"used"}]' },
    { chapterNumber: 4, skill: 'romance-consistency-audit', status: 'completed', result: '[{"op":"swap","find":"His blue eyes","replace":"His grey eyes"}]' },
    { chapterNumber: 4, skill: 'deterministic-apply', status: 'active', result: undefined },
  ];
  const { text, stats } = await runDeterministicApply(steps, steps[3], async (s) => s);
  assert.match(text, /His grey eyes/);      // consistency fix applied
  assert.match(text, /She used the old oven/); // de-ai fix applied
  assert.equal(stats.appliedSwaps, 2);
  assert.equal(stats.auditSteps, 2);
});

test('runDeterministicApply ignores non-JSON audits (e.g. legacy markdown) safely', async () => {
  const steps = [
    { chapterNumber: 4, role: 'draft', status: 'completed', result: 'utilized' },
    { chapterNumber: 4, skill: 'romance-humanize-audit', status: 'completed', result: '## Findings\n- [forbidden] utilized -> used' }, // markdown, not JSON
    { chapterNumber: 4, skill: 'deterministic-apply', status: 'active', result: undefined },
  ];
  const { text, stats } = await runDeterministicApply(steps, steps[2], async (s) => s);
  assert.equal(text, 'utilized');  // markdown audit parses to [] → chapter = draft, no drift
  assert.equal(stats.auditSteps, 1);
  assert.equal(stats.appliedSwaps, 0);
});
