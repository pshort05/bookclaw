/**
 * Unit tests for two VERIFIED Medium bugs in gateway/src/services/projects.ts:
 *
 *  - #15: applyReviewResume's 'edit'/'regenerate' actions on a 'pipeline-gate'
 *    review fell through to the 'else' (approve) branch, silently completing
 *    the step with the placeholder/pendingResult instead of honoring the
 *    requested edit or regenerate.
 *  - #18a: the novel-pipeline writing-phase context head-truncates the joined
 *    outline to 4000 chars, so a later chapter's own outline beats can be
 *    dropped entirely once earlier chapters' beats fill the budget.
 *  - #18b: the default (non-novel/non-production) context branch appends ALL
 *    completed prior steps with a per-step cap but no overall cap, so it can
 *    grow unbounded across many steps.
 *
 * Run: node --import tsx --test tests/unit/project-context-budget.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { ProjectEngine, type Project, type ProjectStep } from '../../gateway/src/services/projects.js';

function engine(): ProjectEngine {
  return new ProjectEngine(undefined, mkdtempSync(join(tmpdir(), 'bookclaw-ctxbudget-')));
}

function baseProject(overrides: Partial<Project> = {}): Project {
  const now = new Date().toISOString();
  return {
    id: 'p1',
    type: 'novel-pipeline',
    title: 'Ctx Budget Test',
    description: 'd',
    status: 'active',
    progress: 0,
    steps: [],
    createdAt: now,
    updatedAt: now,
    context: {},
    ...overrides,
  } as Project;
}

// ── #18a: current chapter's outline beats must survive into writing context ──

test('#18a: writing-phase context for a later chapter includes that chapter\'s own outline beats', async () => {
  const e = engine();

  // Build a multi-chapter outline whose combined text exceeds the old 4000-char
  // head-truncation cap, with each chapter's beats clearly labelled.
  const chapterBlock = (n: number) =>
    `Chapter ${n}: Title ${n}\nPOV: Someone\nLocation: Somewhere\n` +
    `Filler scene-setting prose to pad this chapter's outline entry out to a realistic length. `.repeat(4) +
    `\nBeats:\n- UNIQUE-BEAT-MARKER-${n}-alpha\n- UNIQUE-BEAT-MARKER-${n}-beta\n- UNIQUE-BEAT-MARKER-${n}-gamma\n` +
    `Tension: 5\nHook: cliffhanger ${n}\n\n`;
  const outlineText = Array.from({ length: 20 }, (_, i) => chapterBlock(i + 1)).join('');
  assert.ok(outlineText.length > 4000, 'outline fixture must exceed the old head-truncation cap');
  // Chapter 12's block must start well past the old 4000-char head cap, so the
  // bug (head-only truncation) would genuinely drop it.
  const ch12Offset = outlineText.indexOf('UNIQUE-BEAT-MARKER-12-alpha');
  assert.ok(ch12Offset > 4000, `chapter 12 marker must start past char 4000 (fixture: ${ch12Offset})`);

  const outlineStep: ProjectStep = {
    id: 'outline-1', label: 'Chapter outline', taskType: 'outline', prompt: 'x',
    status: 'completed', phase: 'outline', result: outlineText,
  };
  const writingStep: ProjectStep = {
    id: 'write-12', label: 'Write Chapter 12', taskType: 'creative_writing', prompt: 'x',
    status: 'active', phase: 'writing', chapterNumber: 12,
  };
  const project = baseProject({ steps: [outlineStep, writingStep] });

  const context = await e.buildProjectContext(project, writingStep);

  assert.ok(
    context.includes('UNIQUE-BEAT-MARKER-12-alpha'),
    'chapter 12 beats must be present in the writing-phase context, not dropped by head truncation',
  );
  clearTimeout((e as any).saveDebounceTimer);
});

test('#18a: an early chapter (already within the old 4000-char head) still gets its beats (no regression)', async () => {
  const e = engine();
  const chapterBlock = (n: number) =>
    `Chapter ${n}: Title ${n}\nBeats:\n- UNIQUE-BEAT-MARKER-${n}-alpha\n\n`;
  const outlineText = Array.from({ length: 20 }, (_, i) => chapterBlock(i + 1)).join('');

  const outlineStep: ProjectStep = {
    id: 'outline-1', label: 'Chapter outline', taskType: 'outline', prompt: 'x',
    status: 'completed', phase: 'outline', result: outlineText,
  };
  const writingStep: ProjectStep = {
    id: 'write-1', label: 'Write Chapter 1', taskType: 'creative_writing', prompt: 'x',
    status: 'active', phase: 'writing', chapterNumber: 1,
  };
  const project = baseProject({ steps: [outlineStep, writingStep] });

  const context = await e.buildProjectContext(project, writingStep);
  assert.ok(context.includes('UNIQUE-BEAT-MARKER-1-alpha'));
  clearTimeout((e as any).saveDebounceTimer);
});

// ── #18b: default-branch context must be bounded overall ────────────────────

test('#18b: default-branch context of ~21 large completed steps is bounded, not ~160k chars', async () => {
  const e = engine();
  const bigResult = 'X'.repeat(10000); // per-step result far exceeding a single step's cap alone
  const steps: ProjectStep[] = Array.from({ length: 21 }, (_, i) => ({
    id: `s${i}`, label: `Step ${i}`, taskType: 'general', prompt: 'x',
    status: 'completed', result: `${bigResult}-MARKER-${i}`,
  }));
  steps.push({ id: 'active', label: 'Active step', taskType: 'general', prompt: 'x', status: 'active' });
  const project = baseProject({ type: 'custom' as any, steps });

  const context = await e.buildProjectContext(project, steps[steps.length - 1]);

  // Previously unbounded: 21 steps * (5000 head + 3000 tail) ≈ 168,000 chars.
  assert.ok(context.length < 100000, `context length ${context.length} must be bounded well below the old ~168k`);
  // Most recent step's content should still be present (relevance to current step).
  assert.ok(context.includes('MARKER-20'), 'the most recent completed step must still be included');
  clearTimeout((e as any).saveDebounceTimer);
});

// ── #15: pipeline-gate edit/regenerate must not silently approve ────────────

const PIPELINE = { schemaVersion: 1, name: 'gate-pipeline', label: 'P', description: 'd', dynamic: false, steps: [
  { label: 'Gate Step', taskType: 'general', phase: 'production', promptTemplate: 'x' },
  { label: 'Next Step', taskType: 'general', phase: 'production', promptTemplate: 'y' },
] } as const;

function gateEngine() {
  const e = new ProjectEngine(undefined, mkdtempSync(join(tmpdir(), 'bookclaw-gate15-')));
  e.setPipelineResolver(() => (PIPELINE as any));
  return e;
}

function pipelineGateProject() {
  const e = gateEngine();
  const p = e.createProjectResolved('book-production' as any, 'P', 'd', {});
  e.startProject(p.id); // step[0] active
  return { e, p: p as any };
}

test('#15 pipeline-gate regenerate reopens the step for regeneration instead of silently approving it', () => {
  const { e, p } = pipelineGateProject();
  p.status = 'paused';
  p.review = { kind: 'pipeline-gate', stepId: p.steps[0].id, confirmationId: 'c1' };

  (e as any).applyReviewResume(p.id, p.steps[0].id, 'pipeline-gate', 'regenerate', { note: 'try again' });

  assert.equal(p.steps[0].status, 'active', 'must reopen for regeneration, not complete');
  assert.notEqual(p.steps[0].result, '[approved by human review]');
  assert.equal(p.steps[0].result, undefined);
  assert.equal(p.steps[0].regenerateNote, 'try again');
  assert.equal(p.steps[1].status, 'pending', 'must NOT silently advance past the gate');
  assert.equal(p.review, undefined);
  clearTimeout((e as any).saveDebounceTimer);
});

test('#15 pipeline-gate edit completes the step with the edited text, not the placeholder', () => {
  const { e, p } = pipelineGateProject();
  p.status = 'paused';
  p.review = { kind: 'pipeline-gate', stepId: p.steps[0].id, confirmationId: 'c2' };

  (e as any).applyReviewResume(p.id, p.steps[0].id, 'pipeline-gate', 'edit', { editedText: 'human edited text' });

  assert.equal(p.steps[0].status, 'completed');
  assert.equal(p.steps[0].result, 'human edited text');
  assert.notEqual(p.steps[0].result, '[approved by human review]');
  assert.equal(p.steps[1].status, 'active');
  assert.equal(p.review, undefined);
  clearTimeout((e as any).saveDebounceTimer);
});

test('#15 pipeline-gate approve (no action / default) is unchanged — still falls back to the placeholder', () => {
  const { e, p } = pipelineGateProject();
  p.status = 'paused';
  p.review = { kind: 'pipeline-gate', stepId: p.steps[0].id, confirmationId: 'c3' };

  (e as any).applyReviewResume(p.id, p.steps[0].id, 'pipeline-gate');

  assert.equal(p.steps[0].result, '[approved by human review]');
  assert.equal(p.steps[0].status, 'completed');
  clearTimeout((e as any).saveDebounceTimer);
});
