/**
 * BUG C5 (BOOK-GENERATION-REVIEW-2026-07-10 #5): council base story truncated
 * to 500 chars after a gateway restart.
 *
 * persistState truncates step results to 500 chars, relying on
 * rehydrateTruncatedResults() re-reading the step's per-step .md output file —
 * but that file is written only by the AI-generation route paths. The council
 * completion paths (auto mode in council-gate.ts and applyCouncilSelection in
 * propose mode) bypass it, so after a restart the base story the whole book
 * builds on is a 500-char stub.
 *
 * These tests prove the END-TO-END property: complete a council step with a
 * >500-char result, force persistence, construct a FRESH ProjectEngine over the
 * same workspace dir, and assert the rehydrated result is the FULL text.
 *
 * Mirrors tests/unit/council-selection-state.test.ts's realEngine() pattern.
 *
 * Run: node --import tsx --test tests/unit/council-result-rehydration.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { ProjectEngine } from '../../gateway/src/services/projects.js';
import { maybeRunCouncilStep } from '../../gateway/src/services/council-gate.js';

const PIPELINE = { schemaVersion: 1, name: 'romance-sweet-full', label: 'P', description: 'd', dynamic: false, steps: [
  { label: 'Council — Base Story Origination', skill: 'council-origination', taskType: 'book_bible', phase: 'premise', promptTemplate: 'Council.' },
  { label: 'Premise', taskType: 'book_bible', phase: 'premise', promptTemplate: 'Premise.' },
] } as const;

// Well over the 500-char state-file truncation, with a distinctive tail so an
// equality assertion proves the FULL text survived, not just a prefix.
const LONG_TEXT = 'PREMISE\n' + 'lorem-ipsum '.repeat(120) + '\nRELATIONSHIP ARC\n' + 'arc-beat '.repeat(60) + '\nEND-OF-BASE-STORY';

function engineAt(rootDir: string): ProjectEngine {
  const e = new ProjectEngine(undefined, rootDir);
  e.setPipelineResolver(() => (PIPELINE as any));
  return e;
}

async function waitFor(cond: () => boolean, label: string, ms = 5000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error(`timeout waiting for: ${label}`);
    await delay(50);
  }
}

// ── propose mode: applyCouncilSelection ──────────────────────────────────────

test('applyCouncilSelection: base story survives a restart at full length (not a 500-char stub)', async () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'bookclaw-council-rehydrate-'));
  try {
    const e1 = engineAt(rootDir);
    const p = e1.createProjectResolved('book-planning' as any, 'Council Book', 'd', {}) as any;
    e1.startProject(p.id); // council step active
    p.selection = {
      stepId: p.steps[0].id,
      candidates: [{ id: 'c1', model: 'claude', premise: 'P1', relationshipArc: 'A1', text: LONG_TEXT }],
      ranking: [{ id: 'c1', rank: 1, rationale: 'best' }],
      recommendedId: 'c1',
      rationale: 'r',
      createdAt: new Date().toISOString(),
    };
    p.status = 'paused';

    (e1 as any).applyCouncilSelection(p.id, 'c1');
    assert.equal(p.steps[0].result, LONG_TEXT, 'in-memory result is the full pick');

    // Force persistence (debounced) and wait for the flush deterministically.
    const stateFile = join(rootDir, 'workspace', '.config', 'projects-state.json');
    await waitFor(() => existsSync(stateFile), 'state file flushed');

    // Simulate the restart: a FRESH engine over the same workspace.
    const e2 = engineAt(rootDir);
    const reloaded = e2.getProject(p.id) as any;
    assert.ok(reloaded, 'project restored');
    assert.notEqual(reloaded.steps[0].result, LONG_TEXT, 'sanity: the state file itself stores a truncated stub');

    await e2.rehydrateTruncatedResults(reloaded);
    assert.equal(reloaded.steps[0].result, LONG_TEXT,
      'rehydrated council base story must be the FULL text — every later step generates from it');

    clearTimeout((e1 as any).saveDebounceTimer);
    clearTimeout((e2 as any).saveDebounceTimer);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

// ── auto mode: council-gate completes the step directly ─────────────────────

test('council-gate auto mode: base story survives a restart at full length (book-bound data dir)', async () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'bookclaw-council-rehydrate-auto-'));
  try {
    const bookDataDir = join(rootDir, 'bookdata'); // stands in for the bound book's data/ dir
    const e1 = engineAt(rootDir);
    e1.setDataDirResolver(() => bookDataDir);
    const p = e1.createProjectResolved('book-planning' as any, 'Council Book', 'd', {}) as any;
    e1.startProject(p.id); // council step active

    const council = {
      async originate() {
        return {
          candidates: [{ id: 'c1', model: 'claude', premise: 'P1', relationshipArc: 'A1', text: LONG_TEXT }],
          ranking: [{ id: 'c1', rank: 1, rationale: 'best' }],
          recommendedId: 'c1',
          rationale: 'r',
        };
      },
    };

    const outcome = await maybeRunCouncilStep({ engine: e1 as any, council }, p, p.steps[0]);
    assert.deepEqual(outcome, { handled: true, gated: false });
    assert.equal(p.steps[0].result, LONG_TEXT, 'in-memory result is the full recommended text');

    const stateFile = join(rootDir, 'workspace', '.config', 'projects-state.json');
    await waitFor(() => existsSync(stateFile), 'state file flushed');

    const e2 = engineAt(rootDir);
    e2.setDataDirResolver(() => bookDataDir);
    const reloaded = e2.getProject(p.id) as any;
    assert.ok(reloaded, 'project restored');

    await e2.rehydrateTruncatedResults(reloaded);
    assert.equal(reloaded.steps[0].result, LONG_TEXT,
      'rehydrated council base story must be the FULL text after auto-mode completion');

    clearTimeout((e1 as any).saveDebounceTimer);
    clearTimeout((e2 as any).saveDebounceTimer);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});
