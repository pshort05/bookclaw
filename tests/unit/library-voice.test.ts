/** Unit tests for the first-class `voice` library kind (Phase 3 loose ends). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LibraryService } from '../../gateway/src/services/library.js';

const fakeSkills = { getSkillCatalog: () => [], getSkillByName: () => undefined } as never;

function write(base: string, rel: string, body: string): void {
  const p = join(base, rel);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, body, 'utf-8');
}

test('voice is a first-class library kind: list + get', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-voice-'));
  try {
    const builtin = join(root, 'library');
    write(builtin, 'authors/default/SOUL.md', '# Default Author\n\nidentity');
    write(builtin, 'voices/default/STYLE-GUIDE.md', 'style rules');
    write(builtin, 'voices/default/VOICE-PROFILE.md', 'voice profile');
    const lib = new LibraryService(builtin, join(root, 'workspace', 'library'), fakeSkills);
    await lib.loadAll();

    const voices = lib.list('voice').map((v) => v.name);
    assert.deepEqual(voices, ['default']);

    const full = lib.get('voice', 'default');
    assert.ok(full?.files, 'voice get() returns a files bundle');
    assert.deepEqual(Object.keys(full!.files!).sort(), ['STYLE-GUIDE.md', 'VOICE-PROFILE.md']);
    assert.equal(full!.files!['STYLE-GUIDE.md'], 'style rules');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
