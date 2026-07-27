import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseChapterVerdict,
  runRomanceArcCheck,
  runRomanceChapterCheck,
  type RomanceCheckDeps,
} from '../../gateway/src/services/pipeline/romance-checks.js';

function deps(over: Partial<RomanceCheckDeps> = {}): RomanceCheckDeps {
  return {
    complete: async () => ({ text: 'RATING: Adequate (6)\nBEAT: delivered\nISSUE: x\nFIX: y' }),
    selectProvider: (_t, pref) => ({ id: pref === 'openrouter' ? 'openrouter' : 'gemini' }),
    getPrompt: (name) => `SYS:${name}`,
    ...over,
  };
}

test('parseChapterVerdict reads the RATING line', () => {
  assert.equal(parseChapterVerdict('RATING: Strong (9)'), 'strong');
  assert.equal(parseChapterVerdict('RATING: Stall (2)\nISSUE: nothing changes'), 'stall');
  assert.equal(parseChapterVerdict('BEAT: missing\nISSUE: no kiss'), 'stall'); // missing beat → stall
  assert.equal(parseChapterVerdict('no rating here'), 'unknown');
});

test('runRomanceChapterCheck returns text + stall flag; passes the beat + cheap route', async () => {
  const calls: any[] = [];
  const d = deps({
    complete: async (req) => { calls.push(req); return { text: 'RATING: Stall (3)\nISSUE: no romantic change\nFIX: add an almost-moment' }; },
  });
  const r = await runRomanceChapterCheck(d, 'chapter prose', 'First Kiss');
  assert.equal(r?.stall, true);
  assert.equal(r?.verdict, 'stall');
  assert.match(calls[0].messages[0].content, /INTENDED BEAT: First Kiss/);
  assert.equal(calls[0].provider, 'openrouter');   // cheap route preferred
  assert.equal(calls[0].model, 'auto:newest-haiku');
});

test('runRomanceChapterCheck is fail-soft: missing prompt or empty text → null', async () => {
  assert.equal(await runRomanceChapterCheck(deps({ getPrompt: () => null }), 'x'), null);
  assert.equal(await runRomanceChapterCheck(deps(), '   '), null);
  const boom = deps({ complete: async () => { throw new Error('provider down'); } });
  assert.equal(await runRomanceChapterCheck(boom, 'prose'), null); // error swallowed
});

test('runRomanceArcCheck returns the critique; fail-soft on empty/missing', async () => {
  const d = deps({ complete: async () => ({ text: 'PART 1 ...\nGENRE PROMISE: PASS' }) });
  assert.match((await runRomanceArcCheck(d, 'the outline'))!, /GENRE PROMISE: PASS/);
  assert.equal(await runRomanceArcCheck(deps({ getPrompt: () => null }), 'outline'), null);
  assert.equal(await runRomanceArcCheck(deps(), ''), null);
});
