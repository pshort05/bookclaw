/**
 * End-to-end fixture tests for per-step model pinning (Tasks 5 & 6).
 *
 * T5: inline 2-step pipeline — modelOverride survives parse→expand on the pinned
 *     step and is undefined on the unpinned step.
 * T6: real romantasy-planning.json — the 4 ideation steps each carry
 *     provider:'openrouter' with distinct model ids and temperature >= 1.0;
 *     evaluator/selection steps carry temperature <= 0.3.
 *
 * Run: node --import tsx --test tests/unit/per-step-model-pinning.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildPipelineVars } from '../../gateway/src/services/pipeline-vars.ts';
import { expandSteps } from '../../gateway/src/services/pipeline-expand.ts';

// ── T5: inline fixture ────────────────────────────────────────────────────────

test('inline 2-step pipeline: modelOverride survives parse→expand on pinned step', () => {
  const raw = [
    {
      label: 'Generator',
      taskType: 'creative_writing',
      promptTemplate: 'Write {{title}}.',
      modelOverride: { provider: 'openrouter', model: 'x-ai/grok-4', temperature: 1.1 },
    },
    {
      label: 'Evaluator',
      taskType: 'revision',
      promptTemplate: 'Evaluate {{title}}.',
    },
  ];
  const vars = buildPipelineVars({ title: 'T', description: 'D' });
  const out = expandSteps(raw as any, vars);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0].modelOverride, { provider: 'openrouter', model: 'x-ai/grok-4', temperature: 1.1 });
  assert.equal(out[0].modelOverride!.temperature, 1.1);
  assert.equal(out[1].modelOverride, undefined, 'unpinned step has undefined modelOverride');
});

// ── T6: real romantasy-planning.json ─────────────────────────────────────────

test('romantasy-planning.json: 4 ideation steps carry openrouter with distinct models + temp >= 1.0', () => {
  const pipe = JSON.parse(readFileSync(new URL('../../library/pipelines/romantasy-planning.json', import.meta.url), 'utf8'));
  const vars = buildPipelineVars({ title: 'Emberbound', description: 'd', targetChapters: 25 });
  const resolved = expandSteps(pipe.steps, vars);

  // The generators live inside a `{ parallel: [...] }` group; expandSteps flattens
  // them and preserves each member's `phase`, so filter on the resolved step's phase.
  const ideation = resolved.filter((s) => s.phase === 'ideation');
  assert.equal(ideation.length, 4, '4 ideation steps');

  const models = ideation.map((s) => {
    assert.ok(s.modelOverride, `ideation step "${s.label}" must have modelOverride`);
    assert.equal(s.modelOverride!.provider, 'openrouter', `ideation step "${s.label}" provider must be openrouter`);
    assert.ok(typeof s.modelOverride!.temperature === 'number' && s.modelOverride!.temperature >= 1.0,
      `ideation step "${s.label}" temperature must be >= 1.0, got ${s.modelOverride!.temperature}`);
    return s.modelOverride!.model;
  });
  const uniqueModels = new Set(models);
  assert.equal(uniqueModels.size, 4, `all 4 ideation steps must use distinct model ids, got: ${[...uniqueModels].join(', ')}`);
});

test('romantasy-planning.json: evaluator/selection steps carry temperature <= 0.3', () => {
  const pipe = JSON.parse(readFileSync(new URL('../../library/pipelines/romantasy-planning.json', import.meta.url), 'utf8'));
  const vars = buildPipelineVars({ title: 'Emberbound', description: 'd', targetChapters: 25 });
  const resolved = expandSteps(pipe.steps, vars);

  // Evaluators live inside a `{ parallel: [...] }` group; the editor-in-chief join
  // is also phase 'selection'. expandSteps preserves each member's phase.
  const evaluators = resolved.filter((s) => s.phase === 'selection');
  assert.ok(evaluators.length >= 3, `expected at least 3 selection steps, got ${evaluators.length}`);

  for (const s of evaluators) {
    assert.ok(s.modelOverride, `selection step "${s.label}" must have modelOverride`);
    assert.ok(typeof s.modelOverride!.temperature === 'number' && s.modelOverride!.temperature <= 0.3,
      `selection step "${s.label}" temperature must be <= 0.3, got ${s.modelOverride!.temperature}`);
  }
});
