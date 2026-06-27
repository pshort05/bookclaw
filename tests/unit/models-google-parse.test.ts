import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGoogleModels } from '../../gateway/src/api/routes/models.routes.js';

test('parseGoogleModels keeps generateContent models, strips prefix, sorts by id', () => {
  const out = parseGoogleModels({
    models: [
      {
        name: 'models/gemini-2.5-pro',
        displayName: 'Gemini 2.5 Pro',
        supportedGenerationMethods: ['generateContent', 'countTokens'],
      },
      {
        name: 'models/gemini-2.5-flash',
        displayName: 'Gemini 2.5 Flash',
        supportedGenerationMethods: ['generateContent'],
      },
    ],
  });
  assert.deepEqual(out, [
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
  ]);
});

test('parseGoogleModels excludes models without generateContent (e.g. embeddings)', () => {
  const out = parseGoogleModels({
    models: [
      { name: 'models/embedding-001', displayName: 'Embedding 001', supportedGenerationMethods: ['embedContent'] },
      { name: 'models/gemini-2.0-flash', displayName: 'Gemini 2.0 Flash', supportedGenerationMethods: ['generateContent'] },
    ],
  });
  assert.deepEqual(out, [{ id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' }]);
});

test('parseGoogleModels falls back to id when displayName is missing', () => {
  assert.deepEqual(
    parseGoogleModels({ models: [{ name: 'models/gemini-x', supportedGenerationMethods: ['generateContent'] }] }),
    [{ id: 'gemini-x', name: 'gemini-x' }],
  );
});

test('parseGoogleModels tolerates bad input', () => {
  assert.deepEqual(parseGoogleModels({ models: [{ name: 'models/x' }, { supportedGenerationMethods: ['generateContent'] }] }), []);
  assert.deepEqual(parseGoogleModels({}), []);
  assert.deepEqual(parseGoogleModels(null), []);
});
