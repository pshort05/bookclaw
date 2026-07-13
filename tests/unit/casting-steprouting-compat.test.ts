import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepRouting } from '../../gateway/src/api/routes/_shared.js';

test('untagged step keeps today behavior: manual pin then project preference', () => {
  // No role → project.preferredProvider/Model apply to the whole step (legacy).
  assert.deepEqual(
    stepRouting({ preferredProvider: 'gemini', preferredModel: 'google/gemini-3-pro' }, {}),
    { provider: 'gemini', model: 'google/gemini-3-pro', temperature: undefined },
  );
  assert.deepEqual(
    stepRouting({ preferredProvider: 'gemini' }, { modelOverride: { provider: 'openai', model: 'gpt-4o', temperature: 0.5 } }),
    { provider: 'openai', model: 'gpt-4o', temperature: 0.5 },
  );
});

test('stageModels[taskType] pins an untagged step, below an explicit modelOverride, above project default', () => {
  const project = {
    preferredProvider: 'openrouter', preferredModel: 'auto:newest-sonnet',
    stageModels: { creative_writing: { provider: 'openrouter', model: 'anthropic/claude-opus-4.8' } },
  };
  // Stage pin wins over the project default for a creative_writing step.
  assert.deepEqual(
    stepRouting(project, { taskType: 'creative_writing' }),
    { provider: 'openrouter', model: 'anthropic/claude-opus-4.8', temperature: undefined },
  );
  // A step whose taskType has no stage entry falls back to the project default.
  assert.deepEqual(
    stepRouting(project, { taskType: 'outline' }),
    { provider: 'openrouter', model: 'auto:newest-sonnet', temperature: undefined },
  );
  // An explicit per-step modelOverride still wins over the stage pin.
  assert.equal(
    stepRouting(project, { taskType: 'creative_writing', modelOverride: { provider: 'openai', model: 'gpt-4o' } }).model,
    'gpt-4o',
  );
});

test('stageModels also pins a tagged (role) step via the manual-pin slot', () => {
  const project = { context: { genre: '__no_sheet__' }, stageModels: { creative_writing: { provider: 'openrouter', model: 'anthropic/claude-opus-4.8' } } };
  const r = stepRouting(project, { role: 'draft', taskType: 'creative_writing' });
  assert.equal(r.provider, 'openrouter');
  assert.equal(r.model, 'anthropic/claude-opus-4.8');
});

test('a tagged prose step uses the project prose pick only on prose roles', () => {
  const project = { preferredProvider: 'deepseek', preferredModel: 'deepseek-chat', context: { genre: '__no_sheet__' } };
  // With no sheet on disk for this genre, a draft role still gets the prose pick.
  assert.equal(stepRouting(project, { role: 'draft' }).provider, 'deepseek');
  // A non-prose role with no sheet entry falls through to undefined (tier routing).
  assert.equal(stepRouting(project, { role: 'improve' }).provider, undefined);
});

test('a tagged step loads the real casting sheet from project.context.genre', () => {
  // Genre lives at project.context.genre, never project.genre — this is the
  // real shape ProjectEngine/BookService produce. Uses the committed
  // library/casting/romance.json (tests run from repo root).
  const r = stepRouting({ context: { genre: 'romance' } }, { role: 'improve' });
  assert.equal(r.provider, 'openrouter');
  assert.equal(r.model, 'google/gemini-3-pro');

  // A prose role still honors the sheet/prose pick path.
  const draft = stepRouting({ context: { genre: 'romance' } }, { role: 'draft' });
  assert.equal(draft.provider, 'openrouter');

  // No genre at all → tier fallback (undefined).
  const noGenre = stepRouting({}, { role: 'improve' });
  assert.equal(noGenre.provider, undefined);
});
