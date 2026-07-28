import { test } from 'node:test';
import assert from 'node:assert/strict';
import { limitEmDashes } from '../../gateway/src/services/deai/em-dash.js';

test('caps mid-sentence em-dashes at the budget, converting the excess to commas', () => {
  const src = 'She paused — thinking — then spoke — again — and finally — done.';
  const r = limitEmDashes(src, 2);
  // 5 mid-sentence em-dashes; keep 2, convert 3.
  assert.equal(r.removed, 3);
  assert.equal((r.text.match(/—/g) || []).length, 2);
  assert.match(r.text, /She paused — thinking — then spoke, again, and finally, done\./);
});

test('under budget is unchanged', () => {
  const src = 'A quiet room — then a knock.';
  const r = limitEmDashes(src, 3);
  assert.equal(r.removed, 0);
  assert.equal(r.text, src);
});

test('dialogue interruptions are preserved and not counted', () => {
  // Two interruption dashes + three mid-sentence ones; budget 1 keeps 1 mid, converts 2,
  // and leaves both interruptions intact.
  const src = '"I don\'t—" she started. He was calm — steady — sure — and kind. "Wait—"';
  const r = limitEmDashes(src, 1);
  assert.match(r.text, /"I don't—"/);      // interruption kept
  assert.match(r.text, /"Wait—"/);          // interruption kept
  assert.equal(r.removed, 2);               // 3 mid-sentence, keep 1, convert 2
});

test('does not create doubled commas when converting next to existing punctuation', () => {
  const src = 'the cake, still warm — sat there — waiting — cooling.';
  const r = limitEmDashes(src, 0);
  assert.doesNotMatch(r.text, /,\s*,/);
});

test('leaves a numeric range dash intact and does not count it (#2)', () => {
  // The en-dash range must survive and not consume the em-dash budget.
  const src = 'The war of 1914–1918 dragged on — endless — grinding — brutal — and cold.';
  const r = limitEmDashes(src, 1);
  assert.match(r.text, /1914–1918/);   // range untouched, not turned into "1914, 1918"
  assert.equal(r.removed, 3);          // 4 prose em-dashes, keep 1, convert 3; range excluded
});
