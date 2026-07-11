import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PremiseIntakeService } from '../../gateway/src/services/premise-intake.js';

const research = { lookup: async () => ({ answer: 'LBI towns: Surf City, Ship Bottom, Beach Haven. Main road: Long Beach Boulevard. Ocean east, bay west.', citations: [{ title: 'LBI', url: 'https://example.org/lbi' }], hasVerifiedSources: true }) };
const groundingJson = JSON.stringify({
  dossier: '# Long Beach Island\nTowns: Surf City...\n',
  discrepancies: [
    { id: 'd1', premiseClaim: 'Ferraro\'s on Surf City, Long Beach Boulevard', finding: 'Surf City and Long Beach Boulevard are real and correctly placed', status: 'pass', targetField: 'setting' },
    { id: 'd2', premiseClaim: 'shop on Beachfront Ave', finding: 'No Beachfront Ave on LBI', status: 'fail', suggestion: 'Long Beach Boulevard', targetField: 'setting' },
  ],
});

test('ground skips when the place is not real', async () => {
  const svc = new PremiseIntakeService(async () => ({ text: groundingJson }), () => ({ id: 'gemini' }), research);
  const out = await svc.ground('a made-up kingdom', { isReal: false }, 'premise');
  assert.equal(out.status, 'skipped');
  assert.deepEqual(out.discrepancies, []);
});

test('ground produces a dossier + pass/fail discrepancies for a real place', async () => {
  const svc = new PremiseIntakeService(async () => ({ text: groundingJson }), () => ({ id: 'gemini' }), research);
  const out = await svc.ground('Surf City...', { isReal: true, canonicalName: 'Long Beach Island, NJ' }, 'premise');
  assert.equal(out.status, 'grounded');
  assert.match(out.dossier, /Long Beach Island/);
  assert.equal(out.discrepancies.find(d => d.id === 'd2')?.status, 'fail');
  assert.equal(out.discrepancies.find(d => d.id === 'd2')?.suggestion, 'Long Beach Boulevard');
});

test('ground falls back when research is unavailable', async () => {
  const svc = new PremiseIntakeService(async () => ({ text: groundingJson }), () => ({ id: 'gemini' }), undefined);
  const out = await svc.ground('Surf City...', { isReal: true, canonicalName: 'LBI' }, 'premise');
  assert.equal(out.status, 'fallback-llm');
});

// Bug #32(a): isReal:true with a missing/empty canonicalName must not research "undefined".
test('ground skips research when isReal is true but canonicalName is missing', async () => {
  const queries: string[] = [];
  const spyResearch = { lookup: async (query: string) => { queries.push(query); return research.lookup(); } };
  const svc = new PremiseIntakeService(async () => ({ text: groundingJson }), () => ({ id: 'gemini' }), spyResearch);
  const out = await svc.ground('a coastal town', { isReal: true, canonicalName: undefined }, 'premise');
  assert.equal(out.status, 'skipped');
  assert.deepEqual(out.discrepancies, []);
  assert.equal(out.dossier, 'a coastal town');
  assert.equal(queries.length, 0, 'research lookup must not be called');
  assert.ok(!queries.some(q => q.includes('undefined')), 'no query should ever contain the literal "undefined"');
});

test('ground skips research when isReal is true but canonicalName is an empty string', async () => {
  const queries: string[] = [];
  const spyResearch = { lookup: async (query: string) => { queries.push(query); return research.lookup(); } };
  const svc = new PremiseIntakeService(async () => ({ text: groundingJson }), () => ({ id: 'gemini' }), spyResearch);
  const out = await svc.ground('a coastal town', { isReal: true, canonicalName: '' }, 'premise');
  assert.equal(out.status, 'skipped');
  assert.equal(queries.length, 0, 'research lookup must not be called');
});
