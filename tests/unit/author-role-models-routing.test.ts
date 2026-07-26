import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepRouting, applyBookModelConfig } from '../../gateway/src/api/routes/_shared.js';

test('applyBookModelConfig syncs sceneBriefModel/draftModel onto the project', () => {
  const project: any = {};
  applyBookModelConfig(project, {
    sceneBriefModel: { provider: 'openrouter', model: 'auto:newest-sonnet' },
    draftModel: { provider: 'openrouter', model: 'auto:newest-opus' },
  });
  assert.deepEqual(project.sceneBriefModel, { provider: 'openrouter', model: 'auto:newest-sonnet' });
  assert.deepEqual(project.draftModel, { provider: 'openrouter', model: 'auto:newest-opus' });
});

test('stepRouting applies the author draft model to a draft-role step', () => {
  const project: any = { genre: 'romance', draftModel: { provider: 'openrouter', model: 'auto:newest-opus' } };
  const r = stepRouting(project, { role: 'draft', taskType: 'creative_writing' });
  assert.equal(r.provider, 'openrouter');
  assert.equal(r.model, 'auto:newest-opus');
});

test('stepRouting applies the author scene-brief model to a scene_brief step', () => {
  const project: any = { genre: 'romance', sceneBriefModel: { provider: 'openrouter', model: 'auto:newest-sonnet' } };
  const r = stepRouting(project, { role: 'scene_brief', taskType: 'outline' });
  assert.equal(r.model, 'auto:newest-sonnet');
});

test('a per-step modelOverride still beats the author draft model', () => {
  const project: any = { genre: 'romance', draftModel: { provider: 'openrouter', model: 'auto:newest-opus' } };
  const r = stepRouting(project, { role: 'draft', taskType: 'creative_writing', modelOverride: { provider: 'openrouter', model: 'manual-pin' } });
  assert.equal(r.model, 'manual-pin');
});

test('an Outline stage pin does NOT leak onto scene_brief (shared taskType outline)', () => {
  const project: any = {
    genre: 'romance',
    sceneBriefModel: { provider: 'openrouter', model: 'auto:newest-sonnet' },
    stageModels: { outline: { provider: 'openrouter', model: 'cheap-outline-model' } },
  };
  const r = stepRouting(project, { role: 'scene_brief', taskType: 'outline' });
  // the author scene-brief model wins; the outline stage pin only affects real outline steps
  assert.equal(r.model, 'auto:newest-sonnet');
});

test('a creative_writing stage pin does NOT leak onto the draft role', () => {
  const project: any = {
    genre: 'romance',
    draftModel: { provider: 'openrouter', model: 'auto:newest-opus' },
    stageModels: { creative_writing: { provider: 'openrouter', model: 'legacy-pin' } },
  };
  const r = stepRouting(project, { role: 'draft', taskType: 'creative_writing' });
  assert.equal(r.model, 'auto:newest-opus');
});

test('an Outline stage pin still applies to a real outline step', () => {
  const project: any = { genre: 'romance', stageModels: { outline: { provider: 'openrouter', model: 'cheap-outline-model' } } };
  const r = stepRouting(project, { role: 'outline', taskType: 'outline' });
  assert.equal(r.model, 'cheap-outline-model');
});

test('no author model → draft-role step falls through to the genre sheet', () => {
  const project: any = { genre: 'romance' };
  const r = stepRouting(project, { role: 'draft', taskType: 'creative_writing' });
  // romance casting sheet pins draft to an opus slug; assert it is NOT the author sentinel
  assert.notEqual(r.model, 'auto:newest-opus');
});
