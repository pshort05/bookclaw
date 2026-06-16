import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'fs';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { writeWithVersion, listVersions, restoreVersion } from '../../gateway/src/services/file-versions.ts';

test('writeWithVersion snapshots prior content; restoreVersion brings it back and is itself undoable', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fv-'));

  // First write: no prior content, so no version snapshot.
  await writeWithVersion(dir, 'a.md', 'v1');
  assert.equal(await readFile(join(dir, 'a.md'), 'utf-8'), 'v1');
  assert.equal((await listVersions(dir, 'a.md')).length, 0);

  // Second write: prior 'v1' is snapshotted before 'v2' lands.
  await writeWithVersion(dir, 'a.md', 'v2');
  assert.equal(await readFile(join(dir, 'a.md'), 'utf-8'), 'v2');
  const afterSecond = await listVersions(dir, 'a.md');
  assert.equal(afterSecond.length, 1);
  const snapPath = join(dir, '.versions', 'a.md', `${afterSecond[0].id}.md`);
  assert.equal(await readFile(snapPath, 'utf-8'), 'v1');

  // Restore: current 'v2' snapshotted first, then 'v1' restored.
  await restoreVersion(dir, 'a.md', afterSecond[0].id);
  assert.equal(await readFile(join(dir, 'a.md'), 'utf-8'), 'v1');
  assert.equal((await listVersions(dir, 'a.md')).length, 2);
});

test('a brand-new filename writes with zero versions', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fv-'));
  await writeWithVersion(dir, 'new.md', 'hello');
  assert.equal((await listVersions(dir, 'new.md')).length, 0);
});

test('writeWithVersion prunes to at most 20 prior versions', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'fv-prune-'));
  for (let i = 0; i < 25; i++) await writeWithVersion(dir, 'a.md', 'v' + i);
  const versions = await listVersions(dir, 'a.md');
  assert.ok(versions.length <= 20, `expected <= 20 versions, got ${versions.length}`);
});
