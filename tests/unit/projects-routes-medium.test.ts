/**
 * Unit tests for the three Medium bug fixes in projects.routes.ts:
 *
 *  - BUG #25: POST /api/projects/:id/provider mutated project.preferredProvider
 *    in memory but never flushed it, so the override reverted on restart. The
 *    route now calls engine.saveState(). Tested at the engine level: set the
 *    field, saveState, reload a fresh engine on the same root, assert it survived
 *    (and that WITHOUT the flush it is lost — the reason the fix is needed).
 *
 *  - BUG #26: the legacy (no bound book) delete branch rm'd the whole
 *    title-slug dir, so `?files=true` on one no-book project deleted a
 *    same-titled survivor's files. The route now selects only the deleting
 *    project's own files via projectOwnedFiles(). Tested against the extracted
 *    helper + a temp-dir deletion fixture.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectEngine } from '../../gateway/src/services/projects.js';
import { projectOwnedFiles } from '../../gateway/src/api/routes/projects.routes.js';

function engine(): { eng: ProjectEngine; root: string } {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-medium-'));
  return { eng: new ProjectEngine(undefined, root), root };
}

// ─── BUG #25: provider override persistence ─────────────────────────────────

// persistState() is debounced (~1s); wait past it so the on-disk state settles.
const FLUSH_MS = 1200;
const settle = () => new Promise((r) => setTimeout(r, FLUSH_MS));

test('BUG #25: preferredProvider survives a restart after saveState()', async () => {
  const { eng, root } = engine();
  const project = eng.createProject('custom' as any, 'Provider Persist', 'desc');

  // Mirror the route's mutation, then the fix: flush to disk.
  (project as any).preferredProvider = 'deepseek';
  eng.saveState();
  await settle();

  // Fresh engine on the same root re-reads state from disk (like a restart).
  const reloaded = new ProjectEngine(undefined, root);
  const after = reloaded.getProject(project.id);
  assert.ok(after, 'project should reload from disk');
  assert.equal((after as any).preferredProvider, 'deepseek', 'override must persist across restart');
});

test('BUG #25 (regression rationale): without saveState() the override is lost on restart', async () => {
  const { eng, root } = engine();
  const project = eng.createProject('custom' as any, 'Provider No Flush', 'desc');
  // Let createProject's own debounced persist land first (WITHOUT the override).
  await settle();

  // Mutating in memory but NOT flushing is exactly the pre-fix bug.
  (project as any).preferredProvider = 'claude';
  // (no saveState here)

  const reloaded = new ProjectEngine(undefined, root);
  const after = reloaded.getProject(project.id);
  assert.ok(after, 'project should reload from disk');
  assert.equal((after as any).preferredProvider, undefined,
    'without the flush the in-memory override never reaches disk — this is why the fix calls saveState()');
});

// ─── BUG #26: delete only the project's own files from a shared dir ──────────

test('BUG #26: projectOwnedFiles selects only the given project id prefix', () => {
  const idA = 'proj-aaa';
  const idB = 'proj-bbb';
  const entries = [
    `${idA}-step-1-outline.md`,
    `${idA}-step-2-draft.md`,
    `${idB}-step-1-outline.md`,
    'stray-file.md',
  ];
  const own = projectOwnedFiles(entries, idA);
  assert.deepEqual(own.sort(), [`${idA}-step-1-outline.md`, `${idA}-step-2-draft.md`].sort());
  // Never selects the co-located project's files or unrelated files.
  assert.ok(!own.includes(`${idB}-step-1-outline.md`));
  assert.ok(!own.includes('stray-file.md'));
});

test('BUG #26: deleting one no-book project leaves a same-titled survivor\'s files intact', () => {
  // Two same-titled no-book projects historically share workspace/projects/<title-slug>.
  const dir = mkdtempSync(join(tmpdir(), 'bookclaw-del26-'));
  const idA = 'aaa111';
  const idB = 'bbb222';
  const aFiles = [`${idA}-step-1-outline.md`, `${idA}-step-2-draft.md`];
  const bFiles = [`${idB}-step-1-outline.md`];
  for (const f of [...aFiles, ...bFiles]) writeFileSync(join(dir, f), 'x');

  // Emulate the route's file deletion for project A with files=true.
  const own = projectOwnedFiles(readdirSync(dir), idA);
  for (const f of own) rmSync(join(dir, f));

  // A's files gone; B's survivor file untouched (the pre-fix blanket rm removed it).
  for (const f of aFiles) assert.ok(!existsSync(join(dir, f)), `${f} should be deleted`);
  for (const f of bFiles) assert.ok(existsSync(join(dir, f)), `${f} must survive`);
});
