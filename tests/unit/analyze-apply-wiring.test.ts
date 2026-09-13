/**
 * Wiring tests for `resolveAnalyzeApplyBlock` (gateway/src/api/routes/_shared.ts)
 * against the step shapes the DETERMINISTIC ROMANCE PIPELINES actually emit
 * (verified live on project-84, chapter 1):
 *
 *   Scene Brief      role=scene_brief  skill=romance-sweet-scene-brief
 *   First Draft      role=draft        skill=romance-sweet-first-draft   continuityFlags=[…]
 *   Improvement Plan role=improve      skill=romance-sweet-improvement-plan
 *   Rewrite          role=rewrite      skill=romance-sweet-rewrite
 *   Humanize/De-AI   role=humanize     skill=romance-deai-audit
 *
 * The old guards keyed on `skill === 'revise'` (target) and `skill === 'write'`
 * (source), so none of these matched and the chapter's continuity flags never
 * reached a generation step. Critics are stubbed so the assertions are about
 * the wiring only. Companion to analyze-apply-seam.test.ts (legacy shapes).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAnalyzeApplyBlock } from '../../gateway/src/api/routes/_shared.js';

const PROSE = 'She set the mug down and looked at the rain.';

/** Zero-finding stubs mirroring what analyzeChapter calls on each service. */
function stubServices() {
  return {
    craftCritic: {
      analyze(_projectId: string, chapters: Array<{ id: string; number: number; title: string; text: string }>) {
        assert.equal(Array.isArray(chapters), true);
        assert.equal(typeof chapters[0]?.text, 'string');
        return { flags: [] };
      },
    },
    dialogueAuditor: {
      audit(text: string) {
        assert.equal(typeof text, 'string');
        return { flags: [] };
      },
    },
  };
}

const flag = (detail: string) => ({ kind: 'contradiction', detail });

// ── Real romance-pipeline step shapes ──
const sceneBrief = (ch: number) => ({ id: 's1', label: `Scene Brief — Chapter ${ch}`, role: 'scene_brief', skill: 'romance-sweet-scene-brief', chapterNumber: ch, status: 'completed', result: 'brief' });
const firstDraft = (ch: number, result: string, continuityFlags?: any[], id = 'd1') =>
  ({ id, label: `First Draft — Chapter ${ch}`, role: 'draft', skill: 'romance-sweet-first-draft', chapterNumber: ch, status: 'completed', result, continuityFlags });
const improvementPlan = (ch: number) => ({ id: 'i1', label: `Improvement Plan — Chapter ${ch}`, role: 'improve', skill: 'romance-sweet-improvement-plan', chapterNumber: ch });
const rewrite = (ch: number) => ({ id: 'r1', label: `Rewrite — Chapter ${ch}`, role: 'rewrite', skill: 'romance-sweet-rewrite', chapterNumber: ch });
const deaiSweep = (ch: number) => ({ id: 'h1', label: `Humanize — De-AI Sweep — Chapter ${ch}`, role: 'humanize', skill: 'romance-deai-audit', chapterNumber: ch });

// ── 1. The regression: romance draft → romance rewrite ──
test('romance pipeline: continuity flags on the first draft reach the Rewrite step', () => {
  const project = {
    id: 'project-84',
    steps: [sceneBrief(1), firstDraft(1, PROSE, [flag('Maya drives a truck in ch1 but a hatchback in the bible.')]), improvementPlan(1), rewrite(1)],
  };
  const block = resolveAnalyzeApplyBlock({ services: stubServices(), project, step: rewrite(1) });
  assert.match(block, /Analysis Findings/);
  assert.match(block, /Maya drives a truck in ch1 but a hatchback in the bible\./);
});

// ── 2. Legacy shapes untouched ──
test('legacy shape: skill "write" source + skill "revise" target still returns its block', () => {
  const project = {
    id: 'p1',
    steps: [{ id: 'w1', skill: 'write', chapterNumber: 3, status: 'completed', result: PROSE, continuityFlags: [flag('Eye color changed from blue to brown.')] }],
  };
  const step = { id: 'rev-1', phase: 'revision', skill: 'revise', role: 'editorial', chapterNumber: 3 };
  const block = resolveAnalyzeApplyBlock({ services: stubServices(), project, step });
  assert.match(block, /Eye color changed from blue to brown\./);
});

// ── 3. Polish-phase branch unchanged ──
test('polish phase: phase "polish" + skill "revise" behaves exactly as before', () => {
  const project = {
    id: 'p1',
    steps: [{ id: 'w1', skill: 'write', chapterNumber: 3, status: 'completed', result: PROSE, continuityFlags: [flag('The storm ends twice.')] }],
  };
  const step = { id: 'polish-1', phase: 'polish', skill: 'revise', chapterNumber: 3 };
  const block = resolveAnalyzeApplyBlock({ services: stubServices(), project, step });
  assert.match(block, /The storm ends twice\./);
});

// ── 4. Non-rewrite steps must never receive the block ──
// Each shape below is paired with a COMPLETED draft for the same chapter that
// carries a continuity flag, so a match would produce a non-empty block — the
// assertion is about the predicate, not about a missing source step.
for (const [name, step] of [
  ['scene brief', sceneBrief(1)],
  ['improvement plan', improvementPlan(1)],
  ['de-AI sweep', deaiSweep(1)],
  // Critique-only steps from the technothriller/romantasy pipelines, which
  // share `skill: 'revise'` across four different step kinds. Injecting
  // "fix these" into a critique narrows the critique.
  ['improve + revise', { id: 'x', role: 'improve', skill: 'revise', chapterNumber: 1 }],
  ['humanize + revise', { id: 'x', role: 'humanize', skill: 'revise', chapterNumber: 1 }],
  ['continuity + revise', { id: 'x', role: 'continuity', skill: 'revise', chapterNumber: 1 }],
  // Critique-only editorial steps with NO skill (nerdynovelistai stage 5:
  // "Chronology Check" / "Style Check" — "produce an improvement plan only").
  ['editorial, no skill', { id: 'x', role: 'editorial', skill: undefined, chapterNumber: 1 }],
  // An older persisted project predating `inferRole`: skill 'revise' +
  // chapterNumber and NO role. There is no load-time backfill, so this shape
  // is real — and it is exactly what the old predicate also refused.
  ['revise with no role', { id: 'x', skill: 'revise', chapterNumber: 1 }],
] as Array<[string, any]>) {
  test(`non-rewrite step (${name}) returns ""`, () => {
    const project = { id: 'project-84', steps: [firstDraft(1, PROSE, [flag('Maya drives a truck.')]), step] };
    const block = resolveAnalyzeApplyBlock({ services: stubServices(), project, step });
    assert.equal(block, '');
  });
}

// ── 4b. The legacy role-tagged shapes stay pinned (they matched before) ──
for (const role of ['rewrite', 'editorial']) {
  test(`legacy step (role "${role}" + skill "revise") still returns its block`, () => {
    const step = { id: 'x', role, skill: 'revise', chapterNumber: 1 };
    const project = { id: 'p1', steps: [firstDraft(1, PROSE, [flag('Maya drives a truck.')]), step] };
    const block = resolveAnalyzeApplyBlock({ services: stubServices(), project, step });
    assert.match(block, /Maya drives a truck\./);
  });
}

// ── 5. No completed draft for this chapter ──
test('no completed draft for the chapter returns ""', () => {
  const project = {
    id: 'project-84',
    steps: [{ ...firstDraft(1, '', [flag('x')]), status: 'running', result: undefined }, firstDraft(2, PROSE, [flag('other chapter')], 'd2')],
  };
  const block = resolveAnalyzeApplyBlock({ services: stubServices(), project, step: rewrite(1) });
  assert.equal(block, '');
});

// ── 6. Fail-soft on a throwing critic ──
test('a critic that throws degrades to "" without rethrowing', () => {
  const services = {
    craftCritic: { analyze() { throw new Error('mis-wire: wrong shape'); } },
    dialogueAuditor: { audit: () => ({ flags: [] }) },
  };
  const project = { id: 'project-84', steps: [firstDraft(1, PROSE, [flag('Maya drives a truck.')])] };
  const block = resolveAnalyzeApplyBlock({ services, project, step: rewrite(1) });
  assert.equal(block, '');
});

// ── 7. Two drafting passes for one chapter → the LAST completed one is the
// PROSE source (the continuity flags themselves union across the chapter — see
// test 8 — because a flag can be attached to any draft-role step). ──
test('two completed drafting passes: the LAST one is the prose the critics see', () => {
  const seen: string[] = [];
  const services = {
    craftCritic: { analyze(_p: string, chapters: Array<{ text: string }>) { seen.push(chapters[0].text); return { flags: [] }; } },
    dialogueAuditor: { audit: () => ({ flags: [] }) },
  };
  const project = {
    id: 'project-84',
    steps: [
      firstDraft(1, 'first pass prose', [flag('From the first pass.')], 'd1'),
      firstDraft(1, 'second pass prose', [flag('From the second pass.')], 'd2'),
      rewrite(1),
    ],
  };
  const block = resolveAnalyzeApplyBlock({ services, project, step: rewrite(1) });
  assert.deepEqual(seen, ['second pass prose']);
  assert.match(block, /From the second pass\./);
});

// ── 8. Flags live on EVERY step sharing the chapter, not just the last draft ──
// `detectPostDraftContinuity` attaches flags to any `role: 'draft'` step, and
// Alternate Takes injects a second one ("Draft Opening — Chapter N") before the
// main draft. Reading `writeStep.continuityFlags` directly dropped those; the
// block must union across the chapter (deduped) via `chapterContinuityFlags`.
test('continuity flags from an EARLIER draft step (Alternate Takes opening) still reach the Rewrite', () => {
  const draftOpening = {
    id: 'o1', label: 'Draft Opening — Chapter 1', role: 'draft', chapterNumber: 1,
    status: 'completed', result: 'A short opening.', continuityFlags: [flag('The bar closed in ch0 but is open here.')],
  };
  const project = {
    id: 'project-84',
    steps: [draftOpening, firstDraft(1, PROSE, [flag('Maya drives a truck.')]), rewrite(1)],
  };
  const block = resolveAnalyzeApplyBlock({ services: stubServices(), project, step: rewrite(1) });
  assert.match(block, /The bar closed in ch0 but is open here\./);
  assert.match(block, /Maya drives a truck\./);
});

test('a flag repeated across two steps of the same chapter is listed once', () => {
  const dup = 'Maya drives a truck in ch1 but a hatchback in the bible.';
  const project = {
    id: 'project-84',
    steps: [
      { ...firstDraft(1, 'opening prose', [flag(dup)], 'o1'), label: 'Draft Opening — Chapter 1' },
      firstDraft(1, PROSE, [flag(dup)]),
      rewrite(1),
    ],
  };
  const block = resolveAnalyzeApplyBlock({ services: stubServices(), project, step: rewrite(1) });
  assert.equal(block.split(dup).length - 1, 1);
});

// ── 9. The findings header must be ADDITIVE, not a competing "ONLY" scope ──
// The block is appended after the improvement plan, and the romance Rewrite
// prompt says "change only what the plan flags" — two disjoint "ONLY" lists in
// one prompt let the model drop either.
test('the findings header reads as additive to the improvement plan', () => {
  const project = {
    id: 'project-84',
    steps: [sceneBrief(1), firstDraft(1, PROSE, [flag('Maya drives a truck.')]), improvementPlan(1), rewrite(1)],
  };
  const block = resolveAnalyzeApplyBlock({ services: stubServices(), project, step: rewrite(1) });
  assert.match(block, /IN ADDITION to the improvement plan/);
  assert.doesNotMatch(block, /fix ONLY these issues/);
});
