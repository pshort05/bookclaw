/**
 * Unit tests for Project.bookSlug binding at creation (Phase 8, Task 3).
 *
 * Covers:
 *   - createProject with bookSlug → project carries the value
 *   - createProject without bookSlug → field is undefined
 *   - createProjectFromPipeline with bookSlug → project carries the value
 *   - createProjectFromPipeline without bookSlug → field is undefined
 *   - createProjectResolved delegates bookSlug via context (covered by above two)
 *   - Persistence round-trip: save + reload preserves bookSlug
 *
 * Run: node --import tsx --test tests/unit/project-bookslug.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { ProjectEngine } from '../../gateway/src/services/projects.js';

// Engine pointing at a non-existent root → loadState() is a no-op.
function makeEngine(rootDir?: string): ProjectEngine {
  return new ProjectEngine(undefined, rootDir ?? join(tmpdir(), 'bookclaw-unit-test-no-such-root'));
}

// A minimal valid LibraryPipeline (non-dynamic, has steps[]).
const MINIMAL_PIPELINE = {
  schemaVersion: 1,
  name: 'book-planning',
  label: 'Book Planning',
  description: 'Plan a book',
  dynamic: false,
  steps: [
    {
      label: 'Outline',
      skill: undefined,
      toolSuggestion: undefined,
      taskType: 'outline',
      promptTemplate: 'Create an outline for {{title}}.',
    },
  ],
} as const;

// ── createProject ────────────────────────────────────────────────────────────

test('createProject with bookSlug sets project.bookSlug', () => {
  const e = makeEngine();
  const project = e.createProject('custom', 'My Novel', 'A great story', { bookSlug: 'my-book' });
  assert.equal(project.bookSlug, 'my-book');
  clearTimeout((e as any).saveDebounceTimer);
});

test('createProject without bookSlug leaves project.bookSlug undefined', () => {
  const e = makeEngine();
  const project = e.createProject('custom', 'My Novel', 'A great story', {});
  assert.equal(project.bookSlug, undefined);
  clearTimeout((e as any).saveDebounceTimer);
});

test('createProject with no context leaves project.bookSlug undefined', () => {
  const e = makeEngine();
  const project = e.createProject('custom', 'My Novel', 'A great story');
  assert.equal(project.bookSlug, undefined);
  clearTimeout((e as any).saveDebounceTimer);
});

// ── createProjectFromPipeline ────────────────────────────────────────────────

test('createProjectFromPipeline with bookSlug sets project.bookSlug', () => {
  const e = makeEngine();
  const project = e.createProjectFromPipeline(
    MINIMAL_PIPELINE as any,
    'My Novel',
    'A great story',
    { bookSlug: 'my-book' },
  );
  assert.equal(project.bookSlug, 'my-book');
  clearTimeout((e as any).saveDebounceTimer);
});

test('createProjectFromPipeline without bookSlug leaves project.bookSlug undefined', () => {
  const e = makeEngine();
  const project = e.createProjectFromPipeline(
    MINIMAL_PIPELINE as any,
    'My Novel',
    'A great story',
    {},
  );
  assert.equal(project.bookSlug, undefined);
  clearTimeout((e as any).saveDebounceTimer);
});

test('createProjectFromPipeline with no context leaves project.bookSlug undefined', () => {
  const e = makeEngine();
  const project = e.createProjectFromPipeline(
    MINIMAL_PIPELINE as any,
    'My Novel',
    'A great story',
  );
  assert.equal(project.bookSlug, undefined);
  clearTimeout((e as any).saveDebounceTimer);
});

// ── createProjectResolved (delegate path) ───────────────────────────────────

test('createProjectResolved threads bookSlug to the created project (via createProject fallback)', () => {
  const e = makeEngine();
  // No pipeline resolver injected → falls back to createProject.
  const project = e.createProjectResolved('custom', 'My Novel', 'A great story', { bookSlug: 'slug-via-resolved' });
  assert.equal(project.bookSlug, 'slug-via-resolved');
  clearTimeout((e as any).saveDebounceTimer);
});

// ── Persistence round-trip ───────────────────────────────────────────────────

test('bookSlug survives a save + reload cycle', async () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'bookclaw-bookslug-test-'));
  try {
    const e1 = makeEngine(rootDir);
    const created = e1.createProject('custom', 'Persisted Novel', 'test', { bookSlug: 'persisted-slug' });
    assert.equal(created.bookSlug, 'persisted-slug', 'field must be present in-memory before flush');

    // Wait for the debounced write (1000 ms) plus a margin.
    await delay(1300);

    const stateFile = join(rootDir, 'workspace', '.config', 'projects-state.json');
    assert.ok(existsSync(stateFile), 'state file must exist after flush');

    // Load a fresh engine from the same root — it will read the state file.
    const e2 = makeEngine(rootDir);
    const reloaded = e2.getProject(created.id);
    assert.ok(reloaded, 'project must be found in the reloaded engine');
    assert.equal(reloaded!.bookSlug, 'persisted-slug', 'bookSlug must survive round-trip');

    clearTimeout((e1 as any).saveDebounceTimer);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});
