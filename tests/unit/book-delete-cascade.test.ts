/**
 * Regression: deleting a book must cascade to its projects. Previously
 * BookService.delete() removed the book dir + active-book pointer but left every
 * project with that bookSlug orphaned in projects-state.json — a "ghost" the
 * book list no longer showed but whose projects persisted (and reloaded on
 * boot). ProjectEngine.deleteProjectsByBook(slug) is the cascade primitive the
 * DELETE route calls after the book is removed.
 *
 * Run: node --import tsx --test tests/unit/book-delete-cascade.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProjectEngine } from '../../gateway/src/services/projects.js';

const PIPELINE = {
  schemaVersion: 1, name: 'book-planning', label: 'Plan', description: 'd', dynamic: false,
  steps: [{ label: 'One', taskType: 'general', promptTemplate: 'x' }],
} as const;

function makeEngine() {
  const e = new ProjectEngine(undefined, join(tmpdir(), 'bookclaw-unit-test-no-such-root'));
  e.setPipelineResolver((name) => (name === 'book-planning' ? (PIPELINE as any) : null));
  return e;
}
const quiesce = (e: ProjectEngine) => clearTimeout((e as any).saveDebounceTimer);

test('deleteProjectsByBook removes only the matching book\'s projects', () => {
  const e = makeEngine();
  const a1 = e.createProjectResolved('book-planning' as any, 'A1', 'd', { bookSlug: 'book-a' } as any);
  const a2 = e.createProjectResolved('book-planning' as any, 'A2', 'd', { bookSlug: 'book-a' } as any);
  const b1 = e.createProjectResolved('book-planning' as any, 'B1', 'd', { bookSlug: 'book-b' } as any);
  const unbound = e.createProjectResolved('book-planning' as any, 'U', 'd', {});

  const removed = e.deleteProjectsByBook('book-a');

  assert.equal(removed, 2);
  assert.equal(e.getProject(a1.id), undefined);
  assert.equal(e.getProject(a2.id), undefined);
  assert.ok(e.getProject(b1.id), 'other book\'s project survives');
  assert.ok(e.getProject(unbound.id), 'unbound project survives');
  quiesce(e);
});

test('deleteProjectsByBook removes active and completed projects alike (no status guard)', () => {
  const e = makeEngine();
  const p = e.createProjectResolved('book-planning' as any, 'Active', 'd', { bookSlug: 'book-x' } as any);
  e.startProject(p.id); // p is now active
  assert.equal(e.getProject(p.id)?.status, 'active');

  assert.equal(e.deleteProjectsByBook('book-x'), 1);
  assert.equal(e.getProject(p.id), undefined);
  quiesce(e);
});

test('deleteProjectsByBook returns 0 for an unknown/empty slug and removes nothing', () => {
  const e = makeEngine();
  const keep = e.createProjectResolved('book-planning' as any, 'Keep', 'd', { bookSlug: 'book-a' } as any);
  assert.equal(e.deleteProjectsByBook('no-such-book'), 0);
  assert.equal(e.deleteProjectsByBook(''), 0);
  assert.ok(e.getProject(keep.id));
  quiesce(e);
});
