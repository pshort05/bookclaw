/**
 * BUG C1 (BOOK-GENERATION-REVIEW-2026-07-10 #1): project state loss + chapter
 * overwrite after a crash mid-write of projects-state.json.
 *
 * - persistState must write atomically (temp file + rename) so a crash can
 *   never leave a truncated JSON behind.
 * - loadState, on a corrupt state file, must preserve the evidence as
 *   projects-state.json.corrupt-<timestamp> (never silently overwritten by the
 *   next persist) and must recover nextId from `project-(\d+)` occurrences in
 *   the corrupt text so new projects never reuse an old ID (which would
 *   overwrite the old project's chapter files in the shared book data dir).
 *
 * Mirrors tests/unit/council-selection-state.test.ts's realEngine() pattern.
 *
 * Run: node --import tsx --test tests/unit/projects-state-atomic.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync, readFileSync,
  readdirSync, statSync,
} from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { ProjectEngine } from '../../gateway/src/services/projects.js';

const PIPELINE = { schemaVersion: 1, name: 'p', label: 'P', description: 'd', dynamic: false, steps: [
  { label: 'Premise', taskType: 'book_bible', phase: 'premise', promptTemplate: 'Premise.' },
] } as const;

function engineAt(rootDir: string): ProjectEngine {
  const e = new ProjectEngine(undefined, rootDir);
  e.setPipelineResolver(() => (PIPELINE as any));
  return e;
}

/** Deterministic wait: poll a condition instead of sleeping an arbitrary time. */
async function waitFor(cond: () => boolean, label: string, ms = 5000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error(`timeout waiting for: ${label}`);
    await delay(50);
  }
}

// ── corrupt state file on load ───────────────────────────────────────────────

test('corrupt projects-state.json is preserved as .corrupt-<ts> and IDs found in it are not reused', async () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'bookclaw-state-corrupt-'));
  try {
    const cfgDir = join(rootDir, 'workspace', '.config');
    mkdirSync(cfgDir, { recursive: true });
    const stateFile = join(cfgDir, 'projects-state.json');
    // A crash-truncated state file: valid prefix, cut off mid-object.
    const corrupt = '{"nextId": 8, "projects": [{"id": "project-7", "title": "Real Book", "steps": [{"id": "project-7-step-1", "label": "Chap';
    writeFileSync(stateFile, corrupt, 'utf-8');

    const e = engineAt(rootDir);

    // (a) Evidence preserved under a .corrupt-<timestamp> name, byte-identical.
    const corruptFiles = readdirSync(cfgDir).filter(f => f.startsWith('projects-state.json.corrupt-'));
    assert.equal(corruptFiles.length, 1, 'corrupt file preserved for hand-recovery');
    assert.equal(readFileSync(join(cfgDir, corruptFiles[0]), 'utf-8'), corrupt, 'evidence byte-identical');

    // (b) nextId recovered from project-(\d+) in the corrupt text: max 7 → 8.
    const p = e.createProjectResolved('book-planning' as any, 'New Book', 'd', {});
    assert.equal(p.id, 'project-8', 'must not reuse project-7 (would overwrite its chapter files)');

    // (c) The next persist writes a fresh state file WITHOUT touching the evidence.
    e.saveState();
    await waitFor(() => existsSync(stateFile), 'state file re-created after persist');
    assert.equal(readFileSync(join(cfgDir, corruptFiles[0]), 'utf-8'), corrupt, 'evidence untouched by later persist');
    const parsed = JSON.parse(readFileSync(stateFile, 'utf-8'));
    assert.equal(parsed.nextId, 9);
    assert.equal(parsed.projects.length, 1);
    assert.equal(parsed.projects[0].id, 'project-8');

    clearTimeout((e as any).saveDebounceTimer);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test('a corrupt state file that yields no project IDs keeps nextId at 1 and still preserves evidence', async () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'bookclaw-state-corrupt2-'));
  try {
    const cfgDir = join(rootDir, 'workspace', '.config');
    mkdirSync(cfgDir, { recursive: true });
    const stateFile = join(cfgDir, 'projects-state.json');
    writeFileSync(stateFile, '{"nex', 'utf-8');

    const e = engineAt(rootDir);
    const corruptFiles = readdirSync(cfgDir).filter(f => f.startsWith('projects-state.json.corrupt-'));
    assert.equal(corruptFiles.length, 1);

    const p = e.createProjectResolved('book-planning' as any, 'T', 'd', {});
    assert.equal(p.id, 'project-1', 'no IDs recoverable → nextId stays 1 (fail-soft)');
    clearTimeout((e as any).saveDebounceTimer);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

// ── atomic persist ───────────────────────────────────────────────────────────

test('persist is atomic: replaces via rename (new inode each flush), parses cleanly, leaves no temp file', async () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'bookclaw-state-atomic-'));
  try {
    const cfgDir = join(rootDir, 'workspace', '.config');
    const stateFile = join(cfgDir, 'projects-state.json');

    const e = engineAt(rootDir);
    e.createProjectResolved('book-planning' as any, 'Book One', 'd', {});
    e.saveState();
    await waitFor(() => existsSync(stateFile), 'first flush');
    const ino1 = statSync(stateFile).ino;

    // Second flush over the existing file.
    e.createProjectResolved('book-planning' as any, 'Book Two', 'd', {});
    e.saveState();
    await waitFor(() => {
      try { return JSON.parse(readFileSync(stateFile, 'utf-8')).projects.length === 2; }
      catch { return false; }
    }, 'second flush visible');

    // Rename-based replace gives the state file a NEW inode each flush; an
    // in-place writeFile (truncate + write — the crash-truncation bug) keeps
    // the same inode. This is the observable proof the write is atomic.
    const ino2 = statSync(stateFile).ino;
    assert.notEqual(ino2, ino1, 'state file must be replaced by rename, not truncated in place');

    const parsed = JSON.parse(readFileSync(stateFile, 'utf-8'));
    assert.equal(parsed.projects.length, 2);
    const leftovers = readdirSync(cfgDir).filter(f => f.includes('.tmp'));
    assert.deepEqual(leftovers, [], 'no temp file left behind');

    clearTimeout((e as any).saveDebounceTimer);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});
