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
