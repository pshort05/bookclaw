import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectEnding } from '../../gateway/src/services/pipeline/ending-gate.js';

test('delivered: an epilogue HEA with both leads', () => {
  const t = `Epilogue — One Year Later. Gia and Cole moved in together above the merged bakery. "I love you," she said. They were married by autumn, and it was, at last, forever.`;
  const v = detectEnding(t, ['Gia', 'Cole']);
  assert.equal(v.status, 'delivered');
  assert.equal(v.bothLeadsPresent, true);
});

test('missing: ends on the black moment / unopened text (Two Seasons shape)', () => {
  const t = `She sat on the bayside wall. The phone lit up — a message from Cole she would not open. She let it go dark and did not answer. Francesca pulled up to drive her home, and Gia walked away from the water without looking back.`;
  const v = detectEnding(t, ['Gia', 'Cole']);
  assert.equal(v.status, 'missing');
  assert.ok(v.rupture.length >= 1);
});

test('missing: ends on the breakup (Firefly shape)', () => {
  const t = `The banner said Kayla. She sat looking at the name. Her thumb hovered where a thumb goes. The screen dimmed, considered itself, and went out. She was alone in the office, and it was over.`;
  const v = detectEnding(t, ['Addi', 'Jay']);
  assert.equal(v.status, 'missing');
});

test('uncertain: a rupture word but resolved in the same ending stretch', () => {
  // "walked away" appears, but the ending clearly resolves to an HEA note.
  const t = `He almost walked away — then didn't. "I love you," Jay said, and they stood together as the fireflies came up. Forever, this time.`;
  const v = detectEnding(t, ['Addi', 'Jay']);
  assert.notEqual(v.status, 'missing'); // the resolution guard prevents a false 'missing'
});

test('uncertain when signals are thin', () => {
  const v = detectEnding('They talked about the weather and went to bed.', ['A', 'B']);
  assert.equal(v.status, 'uncertain');
});

test('leadNames optional; a delivered ending without names still reads delivered', () => {
  const t = `One year later, they were married and moved in together. "I love you." Forever.`;
  const v = detectEnding(t);
  assert.equal(v.bothLeadsPresent, null);
  assert.equal(v.status, 'delivered');
});
