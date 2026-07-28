/**
 * C2: romance engagement checks attached to the human-review cadence gate.
 * - the chapter checker FORCE-OPENS a gate on a Stall even when the book's
 *   cadence (per_act here, non-act chapter) would not pause;
 * - the arc checker annotates the always-on outline gate;
 * - both are inert for non-romance projects.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maybeOpenCadenceGate } from '../../gateway/src/services/human-review.js';
import type { RomanceCheckDeps } from '../../gateway/src/services/pipeline/romance-checks.js';

function strictGate() {
  const created: any[] = [];
  return {
    created,
    async createRequest(input: any) {
      if (!input?.service || !input?.action || !input?.payload?.projectId || !input?.payload?.stepId) {
        throw new Error('malformed confirmation request');
      }
      created.push(input);
      return { id: `conf-${created.length}` };
    },
    checkDecision() { return { status: 'pending', request: null }; },
    async recordOutcome() { return null; },
  };
}
const fakeEngine = { listProjects: () => [], getProject: () => null, parkForReview() {}, applyReviewResume() {}, clearReview() {} };

function romanceDep(over: Partial<RomanceCheckDeps> = {}): RomanceCheckDeps {
  return {
    complete: async () => ({ text: 'RATING: Stall (2)\nBEAT: partially\nISSUE: nothing changes between them\nFIX: add an almost-moment' }),
    selectProvider: (_t, pref) => ({ id: pref === 'openrouter' ? 'openrouter' : 'gemini' }),
    getPrompt: () => 'SYSTEM PROMPT',
    ...over,
  };
}

// 9 chapter steps (one per chapter) + a trailing assembly step; act boundaries land on 3/6/9.
function romanceProject(type = 'romance-spicy-deterministic') {
  const steps: any[] = Array.from({ length: 9 }, (_, i) => ({ id: `ch${i + 1}`, label: `Chapter ${i + 1}`, chapterNumber: i + 1, skill: 'romance-spicy-first-draft' }));
  steps.push({ id: 'asm', label: 'Compile manuscript', skill: 'assembly' });
  return { id: 'p1', title: 'Book', type, steps, review: undefined as any };
}

test('chapter Stall FORCE-OPENS a gate on a per_act book at a non-act chapter', async () => {
  const project = romanceProject();
  const step = project.steps[1]; // chapter 2 — not an act boundary (acts at 3/6/9)
  const gate = strictGate();
  const r = await maybeOpenCadenceGate(
    { gate, engine: fakeEngine } as any, project, step, 'chapter prose',
    { manifest: { review: { cadence: 'per_act' } }, romance: romanceDep() },
  );
  assert.equal(r.gated, true);
  assert.equal(gate.created.length, 1);
  assert.ok(gate.created[0].payload.findings?.romanceChapter, 'chapter finding attached');
  assert.match(String(gate.created[0].payload.findings.romanceChapter), /nothing changes/);
});

test('a Strong chapter does NOT force a gate on a per_act non-act chapter', async () => {
  const project = romanceProject();
  const step = project.steps[1];
  const gate = strictGate();
  const r = await maybeOpenCadenceGate(
    { gate, engine: fakeEngine } as any, project, step, 'chapter prose',
    { manifest: { review: { cadence: 'per_act' } }, romance: romanceDep({ complete: async () => ({ text: 'RATING: Strong (9)\nBEAT: delivered' }) }) },
  );
  assert.equal(r.gated, false);
  assert.equal(gate.created.length, 0);
});

test('non-romance project is inert (no romance check, no forced gate)', async () => {
  const project = romanceProject('book-production');
  const step = project.steps[1];
  const gate = strictGate();
  const r = await maybeOpenCadenceGate(
    { gate, engine: fakeEngine } as any, project, step, 'chapter prose',
    { manifest: { review: { cadence: 'per_act' } }, romance: romanceDep() },
  );
  assert.equal(r.gated, false);
});

test('final chapter with a missing HEA force-gates via the deterministic ending backstop + passes the HEA beat', async () => {
  // 9 chapters + a review step + assembly, so chapter 9 is NOT pre_export.
  const steps: any[] = Array.from({ length: 9 }, (_, i) => ({ id: `ch${i + 1}`, label: `Chapter ${i + 1}`, chapterNumber: i + 1, skill: 'romance-sweet-first-draft' }));
  steps.push({ id: 'rev', label: 'Continuity & Arc Review', skill: 'revision' });
  steps.push({ id: 'asm', label: 'Compile manuscript', skill: 'assembly' });
  const project = { id: 'p3', title: 'Book', type: 'romance-sweet-deterministic', steps, review: undefined as any };
  const final = steps[8]; // chapter 9 (the last chapter)
  const calls: any[] = [];
  const gate = strictGate();
  const r = await maybeOpenCadenceGate(
    { gate, engine: fakeEngine } as any, project, final,
    'The screen went dark. It was over. She was alone. Goodbye.', // clear-cut missing ending
    { manifest: { review: { cadence: 'autonomous' } }, // autonomous never gates on cadence
      romance: romanceDep({ complete: async (req: any) => { calls.push(req); return { text: 'RATING: Strong (8)\nBEAT: delivered' }; } }) },
  );
  assert.equal(r.gated, true, 'ending backstop forced a gate despite autonomous cadence + Strong chapter rating');
  assert.match(String(gate.created[0].payload.findings.ending), /NOT delivered/i);
  assert.match(calls[0].messages[0].content, /INTENDED BEAT: HEA \/ HFN/); // the HEA beat was fed to the checker
});

test('canon fact-sheet flags a new proper noun as an advisory finding on an open gate', async () => {
  const steps: any[] = [
    { id: 'canon', label: 'Canon Fact-Sheet', skill: 'book-bible',
      result: '{"characters":[{"name":"Gia Ferraro","aliases":["Gia"]}],"places":["Surf City"]}' },
    ...Array.from({ length: 9 }, (_, i) => ({ id: `ch${i + 1}`, label: `Chapter ${i + 1}`, chapterNumber: i + 1, skill: 'romance-sweet-first-draft' })),
    { id: 'asm', label: 'Compile manuscript', skill: 'assembly' },
  ];
  const project = { id: 'p4', title: 'Book', type: 'romance-sweet-deterministic', steps, review: undefined as any };
  const step = steps[3]; // chapter 3 — an act boundary for a 9-chapter book (gates under per_act)
  const gate = strictGate();
  const r = await maybeOpenCadenceGate(
    { gate, engine: fakeEngine } as any, project, step,
    'Gia met Denny Alvarez down in Surf City that afternoon.',
    { manifest: { review: { cadence: 'per_act' } }, romance: romanceDep({ complete: async () => ({ text: 'RATING: Strong (8)\nBEAT: delivered' }) }) },
  );
  assert.equal(r.gated, true); // act boundary opens the gate
  assert.deepEqual(gate.created[0].payload.findings.newNouns, ['Denny Alvarez']); // flagged; Gia + Surf City are canon
});

test('arc checker annotates the always-on outline gate', async () => {
  const project = { id: 'p2', title: 'Book', type: 'romance-sweet-deterministic',
    steps: [{ id: 'o', label: 'Chapter Outline', skill: 'outline', role: 'outline' }], review: undefined as any };
  const step = project.steps[0];
  const gate = strictGate();
  const r = await maybeOpenCadenceGate(
    { gate, engine: fakeEngine } as any, project, step, 'the full outline text',
    { manifest: { review: { cadence: 'autonomous' } }, romance: romanceDep({ complete: async () => ({ text: 'PART 1...\nGENRE PROMISE: FAIL — no HEA in the outline' }) }) },
  );
  assert.equal(r.gated, true); // outline_approved always gates
  assert.match(String(gate.created[0].payload.findings.romanceArc), /GENRE PROMISE: FAIL/);
});
