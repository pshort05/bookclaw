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
