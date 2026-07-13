import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PremiseIntakeService } from '../../gateway/src/services/premise-intake.js';

const CANNED = JSON.stringify({
  seeds: { storyArc: 'Legacy vs new on LBI', characters: 'Gia; Cole; Gianni; cousin', setting: 'Surf City, Long Beach Boulevard; the bayside', blueprint: 'Act One rivalry+storm; POV-lock on Cole until Act Three; ending: Gianni\'s Morning Joint', heat: 'sweet', chapterCount: 40, wordsPerChapter: 2500 },
  gaps: [{ id: 'cousin-name', question: "Cousin's name?", proposedAnswer: 'Nina', alternatives: ['Rosa'], targetField: 'characters' }],
  realPlace: { isReal: true, canonicalName: 'Long Beach Island, New Jersey' },
});

test('parse maps a premise into seeds, gaps, and realPlace', async () => {
  const svc = new PremiseIntakeService(async () => ({ text: CANNED }), () => ({ id: 'gemini' }));
  const out = await svc.parse('# FERRARO\'S ...');
  assert.equal(out.seeds.heat, 'sweet');
  assert.equal(out.seeds.chapterCount, 40);
  assert.equal(out.realPlace.isReal, true);
  assert.equal(out.gaps[0].targetField, 'characters');
});

test('parse tolerates fenced/pre-amble JSON and defaults the non-text fields', async () => {
  const fenced = 'Sure!\n```json\n' + JSON.stringify({
    seeds: { storyArc: 'x', characters: 'c', setting: 's', blueprint: 'b' },
  }) + '\n```';
  const svc = new PremiseIntakeService(async () => ({ text: fenced }), () => ({ id: 'gemini' }));
  const out = await svc.parse('thin premise');
  assert.equal(out.seeds.storyArc, 'x');
  assert.equal(out.seeds.heat, 'sweet');         // default
  assert.equal(out.seeds.chapterCount, 40);      // default
  assert.deepEqual(out.gaps, []);
  assert.equal(out.realPlace.isReal, false);
});

// Regression: the model returns `characters` as an array of objects and `blueprint`
// as an array of strings whenever the premise has several character sections or an
// act-by-act map. These used to coerce to '' and the content was silently lost —
// the book was then created with no cast and no structure.
test('parse flattens array/object seed fields instead of dropping them', async () => {
  const shaped = JSON.stringify({
    seeds: {
      storyArc: 'Legacy vs new on LBI',
      characters: [
        { name: 'Gia Ferraro', role: 'baker', want: 'save the bakery' },
        { name: 'Cole Kessler', role: 'cafe owner' },
      ],
      setting: { name: 'Long Beach Island', notes: 'shore town, late August' },
      blueprint: ['ACT ONE — rivalry and the storm', 'BLACK MOMENT — reader kept in the dark', 'THE ENDING'],
      heat: 'spicy', chapterCount: 30, wordsPerChapter: 2500,
    },
    gaps: [], realPlace: { isReal: false },
  });
  const svc = new PremiseIntakeService(async () => ({ text: shaped }), () => ({ id: 'gemini' }));
  const out = await svc.parse('# FERRARO\'S ...');

  assert.match(out.seeds.characters, /Gia Ferraro/);
  assert.match(out.seeds.characters, /Cole Kessler/);
  assert.match(out.seeds.characters, /save the bakery/);   // nested values survive
  assert.match(out.seeds.blueprint, /ACT ONE/);
  assert.match(out.seeds.blueprint, /THE ENDING/);
  assert.match(out.seeds.setting, /Long Beach Island/);
  assert.equal(out.seeds.heat, 'spicy');
});

test('parse keeps gaps whose id is not a string', async () => {
  const numericIds = JSON.stringify({
    seeds: { storyArc: 'x', characters: 'c', setting: 's', blueprint: 'b' },
    gaps: [{ id: 7, question: "Cousin's name?", proposedAnswer: 'Nina', targetField: 'characters' }],
    realPlace: { isReal: false },
  });
  const svc = new PremiseIntakeService(async () => ({ text: numericIds }), () => ({ id: 'gemini' }));
  const out = await svc.parse('x');
  assert.equal(out.gaps.length, 1);
  assert.equal(out.gaps[0].id, '7');
  assert.equal(out.gaps[0].targetField, 'characters');
});

test('parse fails loudly when a seed field parses to nothing', async () => {
  const svc = new PremiseIntakeService(
    async () => ({ text: JSON.stringify({ seeds: { storyArc: 'x', setting: 's' } }) }),
    () => ({ id: 'gemini' }),
  );
  await assert.rejects(() => svc.parse('thin premise'), /PREMISE_INTAKE_EMPTY_FIELDS:characters,blueprint/);
});

test('parse throws a typed error on unparseable output', async () => {
  const svc = new PremiseIntakeService(async () => ({ text: 'no json here' }), () => ({ id: 'gemini' }));
  await assert.rejects(() => svc.parse('x'), /PREMISE_INTAKE_PARSE_FAILED/);
});

// The mid-tier model the host defaults to (gpt-4o-mini / a 4B local model on
// these deployments) is flaky at strict JSON and the old 8000-token cap truncated
// long premises — both surfaced as PREMISE_INTAKE_PARSE_FAILED. Intake now pins a
// fast, JSON-reliable model via OpenRouter with a much larger output budget.
test('parse pins the fast JSON model via OpenRouter with a large output budget', async () => {
  let captured: any = null;
  const svc = new PremiseIntakeService(
    async (req) => { captured = req; return { text: CANNED }; },
    (_t, preferredId) => ({ id: preferredId === 'openrouter' ? 'openrouter' : 'gemini' }),
  );
  await svc.parse('# FERRARO\'S ...');
  assert.equal(captured.provider, 'openrouter');
  assert.equal(captured.model, 'anthropic/claude-haiku-4.5');
  assert.ok(captured.maxTokens >= 16384, `expected a >=16384 budget, got ${captured.maxTokens}`);
});

// When OpenRouter is not configured the router falls back to tier routing. Pinning
// an OpenRouter-only model slug onto that other provider would be wrong, so the
// pin is dropped and the fallback provider uses its own configured model.
test('parse does not pin the OpenRouter model when it falls back to another provider', async () => {
  let captured: any = null;
  const svc = new PremiseIntakeService(
    async (req) => { captured = req; return { text: CANNED }; },
    () => ({ id: 'gemini' }),
  );
  await svc.parse('# FERRARO\'S ...');
  assert.equal(captured.provider, 'gemini');
  assert.equal(captured.model, undefined);
});
