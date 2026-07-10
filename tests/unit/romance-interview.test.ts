import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RomanceInterviewService } from '../../gateway/src/services/romance-interview.js';

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

test('done turn defaults missing seed fields', async () => {
  const thin = JSON.stringify({ reply: 'done', done: true, seeds: { storyArc: 'x' } });
  const svc = new RomanceInterviewService(async () => ({ text: thin }), () => ({ id: 'gemini' }));
  const out = await svc.turn([]);
  assert.equal(out.seeds?.heat, 'sweet');            // default
  assert.equal(out.seeds?.characters, '');           // missing -> empty string
  assert.equal(out.seeds?.chapterCount, 40);         // default
  assert.equal(out.seeds?.wordsPerChapter, 2500);    // default
  assert.equal(out.seeds?.councilSelection, 'auto'); // default
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
