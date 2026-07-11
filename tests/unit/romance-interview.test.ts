import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RomanceInterviewService, type TurnMessage } from '../../gateway/src/services/romance-interview.js';

const ASK = JSON.stringify({ reply: "Who are your two leads, and what keeps pulling them together?", done: false });
const DONE = JSON.stringify({
  reply: 'Perfect — I have everything I need to build your story.',
  done: true,
  seeds: { heat: 'spicy', storyArc: 'Rival bakers, enemies to lovers', characters: 'Gia; Cole', setting: 'Long Beach Island, NJ — a boardwalk bakery', chapterCount: 36, wordsPerChapter: 2800, councilSelection: 'propose' },
});

test('turn returns the next question when not done', async () => {
  const svc = new RomanceInterviewService(async () => ({ text: ASK }), () => ({ id: 'gemini' }));
  const out = await svc.turn([{ role: 'user', content: 'A grumpy-sunshine bakery romance.' }]);
  assert.equal(out.done, false);
  assert.match(out.reply, /two leads/);
  assert.equal(out.seeds, undefined);
});

test('turn returns the full seed contract when done', async () => {
  const svc = new RomanceInterviewService(async () => ({ text: DONE }), () => ({ id: 'gemini' }));
  const out = await svc.turn([{ role: 'user', content: '...' }]);
  assert.equal(out.done, true);
  assert.equal(out.seeds?.heat, 'spicy');
  assert.equal(out.seeds?.chapterCount, 36);
  assert.equal(out.seeds?.councilSelection, 'propose');
  assert.equal(out.seeds?.setting, 'Long Beach Island, NJ — a boardwalk bakery');
});

test('done turn defaults missing optional seed fields when essential fields are present', async () => {
  const thin = JSON.stringify({ reply: 'done', done: true, seeds: { storyArc: 'x', characters: 'y', setting: 'z' } });
  const svc = new RomanceInterviewService(async () => ({ text: thin }), () => ({ id: 'gemini' }));
  const out = await svc.turn([]);
  assert.equal(out.done, true);
  assert.equal(out.seeds?.heat, 'sweet');            // default
  assert.equal(out.seeds?.characters, 'y');
  assert.equal(out.seeds?.chapterCount, 40);         // default
  assert.equal(out.seeds?.wordsPerChapter, 2500);    // default
  assert.equal(out.seeds?.councilSelection, 'auto'); // default
});

// Bug #16: the client transcript may start with an assistant turn (every turn after the
// opening one — the client's stored history begins with the assistant's first question).
// Claude/Gemini reject a messages array that doesn't start with 'user'. turn() must
// normalize any transcript to start with a user turn before forwarding it to the provider.
test('turn normalizes an assistant-first transcript to start with a user turn', async () => {
  let captured: TurnMessage[] | null = null;
  const svc = new RomanceInterviewService(
    async (r) => { captured = r.messages; return { text: ASK }; },
    () => ({ id: 'claude' }),
  );
  await svc.turn([{ role: 'assistant', content: 'Q1?' }, { role: 'user', content: 'my answer' }]);
  assert.ok(captured);
  assert.ok(captured!.length > 0);
  assert.equal(captured![0].role, 'user');
});

test('turn leaves an already user-first transcript unchanged (no redundant kickoff)', async () => {
  let captured: TurnMessage[] | null = null;
  const svc = new RomanceInterviewService(
    async (r) => { captured = r.messages; return { text: ASK }; },
    () => ({ id: 'claude' }),
  );
  await svc.turn([{ role: 'user', content: 'A grumpy-sunshine bakery romance.' }]);
  assert.deepEqual(captured, [{ role: 'user', content: 'A grumpy-sunshine bakery romance.' }]);
});

// Bug #17: a done:true turn with null/empty essential seeds must NOT be trusted — it would
// otherwise flip the client to a blank, un-recoverable review form.
test('done:true with null seeds is not trusted — conversation continues', async () => {
  const nullSeeds = JSON.stringify({ reply: 'Great, all set!', done: true, seeds: null });
  const svc = new RomanceInterviewService(async () => ({ text: nullSeeds }), () => ({ id: 'gemini' }));
  const out = await svc.turn([{ role: 'user', content: 'answer' }]);
  assert.equal(out.done, false);
  assert.ok(out.reply && out.reply.length > 0);
  assert.equal(out.seeds, undefined);
});

test('done:true with an empty essential seed field is not trusted — conversation continues', async () => {
  const emptySeeds = JSON.stringify({
    reply: 'Great, all set!',
    done: true,
    seeds: { storyArc: '', characters: 'Gia; Cole', setting: 'Long Beach Island, NJ' },
  });
  const svc = new RomanceInterviewService(async () => ({ text: emptySeeds }), () => ({ id: 'gemini' }));
  const out = await svc.turn([{ role: 'user', content: 'answer' }]);
  assert.equal(out.done, false);
  assert.ok(out.reply && out.reply.length > 0);
  assert.equal(out.seeds, undefined);
});

test('done:true with real essential seeds still returns done:true (happy path preserved)', async () => {
  const svc = new RomanceInterviewService(async () => ({ text: DONE }), () => ({ id: 'gemini' }));
  const out = await svc.turn([{ role: 'user', content: '...' }]);
  assert.equal(out.done, true);
  assert.equal(out.seeds?.storyArc, 'Rival bakers, enemies to lovers');
  assert.equal(out.seeds?.characters, 'Gia; Cole');
  assert.equal(out.seeds?.setting, 'Long Beach Island, NJ — a boardwalk bakery');
});

test('turn tolerates fenced JSON', async () => {
  const svc = new RomanceInterviewService(async () => ({ text: 'Sure!\n```json\n{"reply":"Q?","done":false}\n```' }), () => ({ id: 'gemini' }));
  const out = await svc.turn([]);
  assert.equal(out.reply, 'Q?');
  assert.equal(out.done, false);
});

test('malformed turn degrades gracefully — no throw, conversation continues', async () => {
  const svc = new RomanceInterviewService(async () => ({ text: 'no json, just prose asking a question' }), () => ({ id: 'gemini' }));
  const out = await svc.turn([{ role: 'user', content: 'hi' }]);
  assert.equal(out.done, false);
  assert.match(out.reply, /prose asking a question/);
  assert.equal(out.seeds, undefined);
});
