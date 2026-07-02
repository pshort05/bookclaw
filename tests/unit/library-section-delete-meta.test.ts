/**
 * Bug L13: deleteOverlayEntry for a section must also remove the sibling
 * `<name>.meta.json` sidecar. The section stores its description in a sibling
 * sidecar (not inside a directory), so rm(<name>.md) leaves it orphaned and a
 * later recreate-without-description resurrects the stale description.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LibraryService } from '../../gateway/src/services/library.js';

const fakeSkills = {
  getSkillCatalog: () => [],
  getSkillByName: () => undefined,
} as never;

test('deleting a section overlay removes its description sidecar (no resurrection)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-secdel-'));
  try {
    const builtin = join(root, 'library');
    const workspace = join(root, 'workspace', 'library');
    const svc = new LibraryService(builtin, workspace, fakeSkills);

    // Create a section WITH a description → sidecar sections/ch1.meta.json.
    await svc.createEntry('section', 'ch1', { content: 'body A', description: 'STALE' });
    await svc.loadAll();
    assert.equal(svc.get('section', 'ch1')?.description, 'STALE');

    const sidecar = join(workspace, 'sections', 'ch1.meta.json');
    assert.equal(existsSync(sidecar), true, 'sidecar should exist after create');

    // Delete the overlay entry (callers reload after delete).
    await svc.deleteOverlayEntry('section', 'ch1');
    await svc.loadAll();
    assert.equal(existsSync(sidecar), false, 'sidecar must be gone after delete');

    // Recreate WITHOUT a description — the stale sidecar must not resurrect.
    await svc.createEntry('section', 'ch1', { content: 'body B' });
    await svc.loadAll();
    assert.equal(svc.get('section', 'ch1')?.description, undefined, 'no resurrected description');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
