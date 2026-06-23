import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listForms, getForm, validateFormFit } from '../../gateway/src/services/story-forms.js';

test('catalog has the v1 forms with coherent bands', () => {
  const ids = listForms().map(f => f.id);
  for (const id of ['flash','short-story','novelette','novella','novel','epic','serial','pulp']) assert.ok(ids.includes(id), id);
  for (const f of listForms()) if (f.maxWords !== null) assert.ok(f.minWords < f.maxWords, `${f.id} band`);
});

test('validateFormFit rejects out-of-band totals and accepts in-band', () => {
  const shortStory = getForm('short-story')!;
  const r1 = validateFormFit(shortStory, 24, 100000); // 2.4M >> 7500
  assert.equal(r1.ok, false);
  assert.equal(r1.total, 2400000);
  assert.match(r1.message!, /Short Story/);

  const novella = getForm('novella')!;
  assert.equal(validateFormFit(novella, 24, 1250).ok, true); // 30k in [17.5k,40k]

  const serial = getForm('serial')!;
  assert.equal(validateFormFit(serial, 100, 3000).ok, true);  // open max
  assert.equal(validateFormFit(serial, 1, 500).ok, false);    // below min 2000

  const epic = getForm('epic')!;
  assert.equal(validateFormFit(epic, 40, 3000).ok, true);     // 120k ok
});
