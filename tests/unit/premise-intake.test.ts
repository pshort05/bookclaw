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

test('parse tolerates fenced/pre-amble JSON and defaults missing fields', async () => {
  const svc = new PremiseIntakeService(async () => ({ text: 'Sure!\n```json\n{"seeds":{"storyArc":"x"}}\n```' }), () => ({ id: 'gemini' }));
  const out = await svc.parse('thin premise');
  assert.equal(out.seeds.storyArc, 'x');
  assert.equal(out.seeds.characters, '');       // missing → empty string
  assert.equal(out.seeds.heat, 'sweet');         // default
  assert.deepEqual(out.gaps, []);
  assert.equal(out.realPlace.isReal, false);
});

test('parse throws a typed error on unparseable output', async () => {
  const svc = new PremiseIntakeService(async () => ({ text: 'no json here' }), () => ({ id: 'gemini' }));
  await assert.rejects(() => svc.parse('x'), /PREMISE_INTAKE_PARSE_FAILED/);
});
