/**
 * Unit tests for resolveIntimacyRouting() covering two Plan 2 code-review
 * fixes that both live in the same function:
 *
 * M1 — the ceiling clamp (decision.effectiveSpice / ceiling.violence) is
 * computed but was never injected into the draft prompt, so the model was
 * never actually told to cap explicitness at the ceiling.
 *
 * M2 — per-character profanity injection lived inside `if (decision.template)`,
 * so it was intimacy-only; profanity is independent of heat and must apply to
 * any draft/intimacy step for a book with a declared contentCeiling, even a
 * scene that itself scores as fade (no heat template).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveIntimacyRouting } from '../../gateway/src/api/routes/_shared.js';

function makeServices(opts: { characters?: Record<string, any> } = {}) {
  return {
    books: {
      open: async () => ({ manifest: { contentCeiling: { spice: 4, violence: 5 }, pulledFrom: { genre: { name: 'romance' } } } }),
    },
    aiRouter: {
      complete: async () => ({ text: '{"spice":9,"violence":0}' }), // above ceiling → clamp exercised
      selectProvider: () => ({ id: 'gemini' }),
    },
    characterVoices: {
      getProjectVoices: async () => ({ characters: opts.characters || {} }),
    },
  };
}

const draftStep = { role: 'draft' };
const project = { id: 'proj-1', bookSlug: 'romance-book', context: { genre: 'romance' } };

test('M1: the ceiling clamp is injected into the prompt as an explicit intensity cap', async () => {
  const services = makeServices();
  const result = await resolveIntimacyRouting({ services, project, step: draftStep, sceneBriefText: 'a heated scene' });
  assert.equal(result.active, true);
  assert.equal(result.decision?.effectiveSpice, 4); // clamped from score 9 to ceiling 4
  assert.match(result.promptAddition, /heat level 4\/10/);
  assert.match(result.promptAddition, /violence at 5\/10 MAX/);
});

test('M2: a character with profanity.level set produces an injection block even on a fade (non-intimacy) scene', async () => {
  const services = {
    books: {
      // Ceiling declared (so the function is active) but the scored scene is
      // clean (spice 0) → mode 'fade' → decision.template is null.
      open: async () => ({ manifest: { contentCeiling: { spice: 8, violence: 5 }, pulledFrom: { genre: { name: 'romance' } } } }),
    },
    aiRouter: {
      complete: async () => ({ text: '{"spice":0,"violence":0}' }),
      selectProvider: () => ({ id: 'gemini' }),
    },
    characterVoices: {
      getProjectVoices: async () => ({
        characters: { Rook: { characterName: 'Rook', profanity: { level: 8, contexts: ['angry'], register: 'crude street slang' } } },
      }),
    },
  };
  const result = await resolveIntimacyRouting({ services, project, step: draftStep, sceneBriefText: 'a clean scene' });
  assert.equal(result.decision?.mode, 'fade');
  assert.equal(result.decision?.template, null);
  assert.match(result.promptAddition, /Rook/);
  assert.match(result.promptAddition, /do not sanitize/i);
});

test('M2: a character with profanity level 0 (or absent) produces no injection block', async () => {
  const services = makeServices({
    characters: { Alice: { characterName: 'Alice', profanity: { level: 0, contexts: [], register: 'clean' } } },
  });
  const result = await resolveIntimacyRouting({ services, project, step: draftStep, sceneBriefText: 'a heated scene' });
  assert.doesNotMatch(result.promptAddition, /Alice/);
});
