/**
 * Regression test: stepRouting() must surface modelOverride.temperature.
 *
 * Bug (HIGH): temperature was dropped on the REST execution paths because
 * stepRouting() returned only { provider, model }. The two REST handlers
 * (/execute and /auto-execute) therefore always called handleMessage with
 * overrideTemperature === undefined even when a step had a pinned temperature,
 * silently discarding the per-step setting on the most common execution route.
 *
 * Run: node --import tsx --test tests/unit/step-routing-temperature.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepRouting } from '../../gateway/src/api/routes/_shared.js';

const project = { preferredProvider: 'gemini' };

test('stepRouting returns temperature from step.modelOverride when set', () => {
  const step = { modelOverride: { provider: 'openrouter', model: 'x-ai/grok-4', temperature: 1.1 } };
  const result = stepRouting(project, step);
  assert.equal(result.temperature, 1.1);
});

test('stepRouting returns temperature === 0 (falsy number must not be dropped)', () => {
  // This was the exact failure mode: || 0 would return false, silently
  // discarding a legitimate zero-temperature pin. Must use typeof guard.
  const step = { modelOverride: { provider: 'claude', temperature: 0 } };
  const result = stepRouting(project, step);
  assert.equal(typeof result.temperature, 'number', 'temperature should be a number, not undefined');
  assert.equal(result.temperature, 0);
});

test('stepRouting returns undefined temperature when step has no modelOverride', () => {
  const step = {};
  const result = stepRouting(project, step);
  assert.equal(result.temperature, undefined);
});

test('stepRouting returns undefined temperature when modelOverride has no temperature', () => {
  const step = { modelOverride: { provider: 'openrouter', model: 'x-ai/grok-4' } };
  const result = stepRouting(project, step);
  assert.equal(result.temperature, undefined);
});

test('stepRouting still returns provider and model correctly with temperature present', () => {
  const step = { modelOverride: { provider: 'openrouter', model: 'x-ai/grok-4', temperature: 1.5 } };
  const result = stepRouting(project, step);
  assert.equal(result.provider, 'openrouter');
  assert.equal(result.model, 'x-ai/grok-4');
  assert.equal(result.temperature, 1.5);
});

test('stepRouting falls back to project preferredProvider when step has no modelOverride', () => {
  const step = {};
  const result = stepRouting(project, step);
  assert.equal(result.provider, 'gemini');
  assert.equal(result.model, undefined);
  assert.equal(result.temperature, undefined);
});

/**
 * Regression (HIGH): stepRouting() dropped project.preferredModel. The REST
 * auto-execute/execute paths inherit a book/project model pin via
 * project.preferredModel (not a per-step modelOverride). When that pin was set
 * but no per-step override existed, stepRouting returned model: undefined, so
 * the call used the provider's DEFAULT model instead of the pinned one — e.g.
 * a book pinned to deepseek/claude via OpenRouter silently ran on the cheap
 * default google/gemma-3-4b-it. The fix mirrors the bridge path
 * (index.ts: stepOverride?.model || project.preferredModel).
 */
const pinnedProject = { preferredProvider: 'openrouter', preferredModel: 'anthropic/claude-sonnet-4.6' };

test('stepRouting falls back to project preferredModel when step has no modelOverride', () => {
  const result = stepRouting(pinnedProject, {});
  assert.equal(result.provider, 'openrouter');
  assert.equal(result.model, 'anthropic/claude-sonnet-4.6');
});

test('stepRouting prefers step modelOverride.model over project preferredModel', () => {
  const step = { modelOverride: { provider: 'openrouter', model: 'deepseek/deepseek-v4-pro' } };
  const result = stepRouting(pinnedProject, step);
  assert.equal(result.model, 'deepseek/deepseek-v4-pro');
});
