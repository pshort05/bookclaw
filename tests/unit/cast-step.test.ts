import { test } from 'node:test';
import assert from 'node:assert/strict';
import { castStep } from '../../gateway/src/services/casting/cast-step.js';
import type { CastingSheet } from '../../gateway/src/services/casting/casting-sheet.js';

const sheet: CastingSheet = {
  genre: 'romance',
  roleModels: {
    draft: { provider: 'openrouter', model: 'anthropic/claude-opus-4.6', temperature: 1 },
    improve: { provider: 'openrouter', model: 'google/gemini-3-pro', temperature: 0.7 },
  },
  proseRoles: ['scene_brief', 'draft'],
};

test('spice re-route beats everything, including a manual pin', () => {
  const r = castStep({ step: { role: 'draft', modelOverride: { provider: 'openai', model: 'gpt-4o' } }, sheet, spiceRoute: { provider: 'grok' } });
  assert.equal(r.source, 'spice');
  assert.equal(r.provider, 'grok');
});

test('manual pin beats the prose pick and the sheet', () => {
  const r = castStep({ step: { role: 'draft', modelOverride: { provider: 'openai', model: 'gpt-4o' } }, sheet, proseModel: { provider: 'deepseek' } });
  assert.equal(r.source, 'manual');
  assert.equal(r.provider, 'openai');
  assert.equal(r.model, 'gpt-4o');
});

test('prose pick applies to a prose role only', () => {
  const draft = castStep({ step: { role: 'draft' }, sheet, proseModel: { provider: 'deepseek', model: 'deepseek-chat' } });
  assert.equal(draft.source, 'prose-pick');
  assert.equal(draft.provider, 'deepseek');
  const improve = castStep({ step: { role: 'improve' }, sheet, proseModel: { provider: 'deepseek', model: 'deepseek-chat' } });
  assert.equal(improve.source, 'sheet');
  assert.equal(improve.provider, 'openrouter');
});

test('sheet default applies when no pin/pick', () => {
  const r = castStep({ step: { role: 'draft' }, sheet });
  assert.equal(r.source, 'sheet');
  assert.equal(r.model, 'anthropic/claude-opus-4.6');
  assert.equal(r.temperature, 1);
});

test('no role + no sheet entry falls through to tier-fallback', () => {
  const r = castStep({ step: { role: 'analysis' }, sheet });
  assert.equal(r.source, 'tier-fallback');
  assert.equal(r.provider, undefined);
});

test('a temperature-only modelOverride applies on top of the winning model source', () => {
  const r = castStep({ step: { role: 'draft', modelOverride: { temperature: 0.2 } }, sheet });
  // Model still comes from the sheet (no provider/model in the override to pin).
  assert.equal(r.source, 'sheet');
  assert.equal(r.model, 'anthropic/claude-opus-4.6');
  assert.equal(r.provider, 'openrouter');
  // But the manual temperature always wins.
  assert.equal(r.temperature, 0.2);
});

test('an invalid model id is dropped (provider kept), not passed through', () => {
  const bad: CastingSheet = { ...sheet, roleModels: { draft: { provider: 'openrouter', model: 'has spaces/bad' } } };
  const r = castStep({ step: { role: 'draft' }, sheet: bad });
  assert.equal(r.provider, 'openrouter');
  assert.equal(r.model, undefined);
});

test('a dropped invalid model id logs a warning', () => {
  const bad: CastingSheet = { ...sheet, roleModels: { draft: { provider: 'openrouter', model: 'has spaces/bad' } } };
  const calls: unknown[][] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => { calls.push(args); };
  try {
    castStep({ step: { role: 'draft' }, sheet: bad });
  } finally {
    console.warn = original;
  }
  assert.equal(calls.length, 1);
  assert.match(String(calls[0][0]), /dropping invalid model id "has spaces\/bad"/);
});

test('authorModels drives the draft role, inheriting sheet temperature', () => {
  const r = castStep({
    step: { role: 'draft' },
    sheet,
    authorModels: { draft: { provider: 'openrouter', model: 'auto:newest-opus' } },
  });
  assert.equal(r.source, 'author');
  assert.equal(r.provider, 'openrouter');
  assert.equal(r.model, 'auto:newest-opus');
  assert.equal(r.temperature, 1); // inherited from the sheet's draft role
});

test('authorModels is role-scoped: a draft entry does not affect scene_brief', () => {
  const briefSheet: CastingSheet = {
    genre: 'romance',
    roleModels: { scene_brief: { provider: 'openrouter', model: 'sheet-brief' } },
    proseRoles: ['scene_brief', 'draft'],
  };
  const r = castStep({
    step: { role: 'scene_brief' },
    sheet: briefSheet,
    authorModels: { draft: { provider: 'openrouter', model: 'auto:newest-opus' } },
  });
  assert.equal(r.source, 'sheet');
  assert.equal(r.model, 'sheet-brief');
});

test('a manual per-step pin still wins over authorModels', () => {
  const r = castStep({
    step: { role: 'draft', modelOverride: { provider: 'openrouter', model: 'manual-pin' } },
    sheet: null,
    authorModels: { draft: { provider: 'openrouter', model: 'auto:newest-opus' } },
  });
  assert.equal(r.source, 'manual');
  assert.equal(r.model, 'manual-pin');
});

test('authorModels beats prose-pick (book preferred model) for the draft role', () => {
  const flat: CastingSheet = { genre: 'romance', roleModels: {}, proseRoles: ['scene_brief', 'draft'] };
  const r = castStep({
    step: { role: 'draft' },
    sheet: flat,
    proseModel: { provider: 'openrouter', model: 'book-default' },
    authorModels: { draft: { provider: 'openrouter', model: 'auto:newest-opus' } },
  });
  assert.equal(r.source, 'author');
  assert.equal(r.model, 'auto:newest-opus');
});

test('bucketTemperature overrides the casting-sheet role temperature', () => {
  const r = castStep({ step: { role: 'draft' }, sheet, bucketTemperature: 0.85 });
  assert.equal(r.model, 'anthropic/claude-opus-4.6'); // model still from the sheet
  assert.equal(r.temperature, 0.85);                  // temp from the bucket, not the sheet's 1
});

test('an explicit modelOverride.temperature still wins over bucketTemperature', () => {
  const r = castStep({ step: { role: 'draft', modelOverride: { temperature: 0.2 } }, sheet, bucketTemperature: 0.85 });
  assert.equal(r.temperature, 0.2);
});

test('no bucketTemperature → the sheet temperature is unchanged', () => {
  const r = castStep({ step: { role: 'draft' }, sheet });
  assert.equal(r.temperature, 1);
});
