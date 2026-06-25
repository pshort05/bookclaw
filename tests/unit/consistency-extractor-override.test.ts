import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractChapterFacts } from '../../gateway/src/services/consistency/extractor.js';

test('passes override provider to select and model to complete', async () => {
  let seenPref: string | undefined; let seenModel: string | undefined;
  const deps = { ai: {
    select: (_t: string, pref?: string) => { seenPref = pref; return { id: pref ?? 'gemini' }; },
    complete: async (r: any) => { seenModel = r.model; return { text: '{"facts":[],"events":[]}' }; },
  } };
  await extractChapterFacts(deps as any, 'text', [], 0, { provider: 'claude', model: 'claude-x' });
  assert.equal(seenPref, 'claude');
  assert.equal(seenModel, 'claude-x');
});

test('drops the pinned model when select falls back to a different provider', async () => {
  let seenModel: string | undefined = 'unset';
  const deps = { ai: {
    select: (_t: string, _pref?: string) => ({ id: 'ollama' }), // pinned provider unavailable -> fallback
    complete: async (r: any) => { seenModel = r.model; return { text: '{"facts":[],"events":[]}' }; },
  } };
  await extractChapterFacts(deps as any, 'text', [], 0, { provider: 'gemini', model: 'gemini-2.5-flash' });
  assert.equal(seenModel, undefined);
});

test('no override -> select gets no preferredId, complete gets no model', async () => {
  let seenPref: string | undefined = 'unset'; let seenModel: string | undefined = 'unset';
  const deps = { ai: {
    select: (_t: string, pref?: string) => { seenPref = pref; return { id: 'gemini' }; },
    complete: async (r: any) => { seenModel = r.model; return { text: '{"facts":[],"events":[]}' }; },
  } };
  await extractChapterFacts(deps as any, 'text', [], 0);
  assert.equal(seenPref, undefined);
  assert.equal(seenModel, undefined);
});
