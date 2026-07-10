/**
 * LLM Council — CouncilService.originate() (Romance Workflow sub-project 3, Task 1).
 * Pure injected-AI service: fan out N candidate base stories, one judge call ranks
 * + recommends. Deterministic via canned aiComplete (discriminated by a marker in
 * `system`), no engine coupling.
 *
 * Run: node --import tsx --test tests/unit/council-service.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CouncilService, type CouncilSeeds, type CouncilModel } from '../../gateway/src/services/council.js';

const SEEDS: CouncilSeeds = {
  storyArc: 'Rival chefs forced to co-run a failing restaurant.',
  characters: 'Mara (guarded, perfectionist), Theo (charming, undisciplined).',
  setting: 'A coastal Maine town, off-season.',
  blueprint: 'Dual POV, enemies-to-lovers, HEA.',
  heat: 'sweet',
  title: 'Salt and Butter',
};

const THREE_MODELS: CouncilModel[] = [
  { provider: 'claude' },
  { provider: 'gemini' },
  { provider: 'deepseek' },
];

function candidateResponse(tag: string) {
  return { text: JSON.stringify({ premise: `Premise from ${tag}.`, relationshipArc: `Arc from ${tag}.` }) };
}

function judgeResponse(recommendedId: string, ids: string[]) {
  return {
    text: JSON.stringify({
      ranking: ids.map((id, i) => ({ id, rank: i + 1, rationale: `Rationale for ${id}.` })),
      recommendedId,
      rationale: 'Overall judge rationale.',
    }),
  };
}

// ── happy path: 3 models → 3 candidates + a valid judge ranking ───────────────

test('originate fans out over 3 models and returns 3 well-formed candidates plus a valid judge ranking', async () => {
  const aiComplete = async (req: { provider: string; system: string }) => {
    if (req.system.includes('JUDGE')) return judgeResponse('c2', ['c1', 'c2', 'c3']);
    return candidateResponse(req.provider);
  };
  const service = new CouncilService(aiComplete, () => ({ id: 'claude' }), THREE_MODELS);

  const result = await service.originate(SEEDS);

  assert.equal(result.candidates.length, 3);
  for (const c of result.candidates) {
    assert.ok(c.premise.length > 0, 'premise non-empty');
    assert.ok(c.relationshipArc.length > 0, 'relationshipArc non-empty');
    assert.ok(c.text.includes(c.premise), 'text contains premise');
    assert.ok(c.text.includes(c.relationshipArc), 'text contains relationshipArc');
  }

  const ids = result.candidates.map((c) => c.id);
  assert.ok(ids.includes(result.recommendedId), 'recommendedId is one of the candidate ids');
  assert.equal(result.ranking.length, result.candidates.length, 'ranking covers every candidate');
  for (const id of ids) assert.ok(result.ranking.some((r) => r.id === id), `ranking includes ${id}`);
});

// ── fail-soft: one model rejects, survivors still returned ────────────────────

test('a rejecting model is dropped; originate still returns with the survivors', async () => {
  const aiComplete = async (req: { provider: string; system: string }) => {
    if (req.system.includes('JUDGE')) return judgeResponse('c1', ['c1', 'c3']);
    if (req.provider === 'gemini') throw new Error('provider unavailable');
    return candidateResponse(req.provider);
  };
  const service = new CouncilService(aiComplete, () => ({ id: 'claude' }), THREE_MODELS);

  const result = await service.originate(SEEDS);

  assert.equal(result.candidates.length, 2, 'the gemini candidate was dropped');
  assert.deepEqual(result.candidates.map((c) => c.id), ['c1', 'c3'], 'surviving ids keep their original index');
});

// ── defensive judge fallback ───────────────────────────────────────────────────

test('a judge recommendation naming a non-existent id falls back to candidates[0].id', async () => {
  const aiComplete = async (req: { provider: string; system: string }) => {
    if (req.system.includes('JUDGE')) return judgeResponse('does-not-exist', ['c1', 'c2', 'c3']);
    return candidateResponse(req.provider);
  };
  const service = new CouncilService(aiComplete, () => ({ id: 'claude' }), THREE_MODELS);

  const result = await service.originate(SEEDS);

  assert.equal(result.recommendedId, result.candidates[0].id);
});

// ── total failure ──────────────────────────────────────────────────────────────

test('all generations rejecting throws COUNCIL_ORIGINATION_FAILED', async () => {
  const aiComplete = async () => { throw new Error('provider down'); };
  const service = new CouncilService(aiComplete, () => ({ id: 'claude' }), THREE_MODELS);

  await assert.rejects(() => service.originate(SEEDS), /COUNCIL_ORIGINATION_FAILED/);
});
