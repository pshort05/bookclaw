/**
 * Unit tests for Phase 8 Task 2: SoulService.composeForBook()
 *
 * Core guarantee: composeForBook() returns the same string shape as
 * getFullContext() for the given dirs, but NEVER mutates any instance field.
 * After calling composeForBook(B), getFullContext() must be byte-identical to
 * its pre-call value.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SoulService } from '../../gateway/src/services/soul.js';

/** Create a minimal author dir with a SOUL.md. */
function makeAuthorDir(root: string, name: string, soulContent: string): string {
  const d = join(root, name);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'SOUL.md'), soulContent, 'utf-8');
  return d;
}

test('composeForBook returns the target book\'s content', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-compose-'));
  try {
    const a = makeAuthorDir(root, 'authorA', '# Author A\n\nSENTINEL_ALPHA_SOUL');
    const b = makeAuthorDir(root, 'authorB', '# Author B\n\nSENTINEL_BETA_SOUL');
    writeFileSync(join(b, 'STYLE-GUIDE.md'), 'SENTINEL_BETA_STYLE', 'utf-8');

    const soul = new SoulService(a);
    await soul.load();

    const result = await soul.composeForBook(b, null);
    assert.match(result, /SENTINEL_BETA_SOUL/, 'should contain B\'s soul content');
    assert.match(result, /SENTINEL_BETA_STYLE/, 'should contain B\'s style guide');
    assert.doesNotMatch(result, /SENTINEL_ALPHA_SOUL/, 'should not contain A\'s soul content');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('composeForBook does not mutate instance fields (core no-mutation guarantee)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-compose-'));
  try {
    const a = makeAuthorDir(root, 'authorA', '# Author A\n\nSENTINEL_ALPHA_SOUL');
    writeFileSync(join(a, 'STYLE-GUIDE.md'), 'SENTINEL_ALPHA_STYLE', 'utf-8');
    const b = makeAuthorDir(root, 'authorB', '# Author B\n\nSENTINEL_BETA_SOUL');
    writeFileSync(join(b, 'STYLE-GUIDE.md'), 'SENTINEL_BETA_STYLE', 'utf-8');

    const soul = new SoulService(a);
    await soul.load();

    // Snapshot the state BEFORE calling composeForBook(B).
    const before = soul.getFullContext();
    assert.match(before, /SENTINEL_ALPHA_SOUL/);
    assert.match(before, /SENTINEL_ALPHA_STYLE/);

    // Call composeForBook with B.
    const result = await soul.composeForBook(b, null);
    assert.match(result, /SENTINEL_BETA_SOUL/, 'result contains B\'s content');
    assert.match(result, /SENTINEL_BETA_STYLE/, 'result contains B\'s style');

    // CRITICAL: getFullContext() must be byte-identical to the pre-call snapshot.
    const after = soul.getFullContext();
    assert.strictEqual(after, before, 'getFullContext() must be byte-identical to pre-call snapshot — no mutation');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('composeForBook with missing authorDir returns empty string', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-compose-'));
  try {
    const a = makeAuthorDir(root, 'authorA', '# Author A\n\nSENTINEL_ALPHA_SOUL');
    const soul = new SoulService(a);
    await soul.load();

    const result = await soul.composeForBook(join(root, 'no-such-dir'), null);
    assert.strictEqual(result, '', 'missing authorDir must resolve to empty string');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('composeForBook with empty string authorDir returns empty string', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-compose-'));
  try {
    const a = makeAuthorDir(root, 'authorA', '# Author A\n\nSENTINEL_ALPHA_SOUL');
    const soul = new SoulService(a);
    await soul.load();

    const result = await soul.composeForBook('', null);
    assert.strictEqual(result, '', 'empty authorDir must resolve to empty string');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('composeForBook reads style from voiceDir when provided', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-compose-'));
  try {
    const a = makeAuthorDir(root, 'authorA', '# Author A\n\nSENTINEL_ALPHA_SOUL');
    const b = makeAuthorDir(root, 'authorB', '# Author B\n\nSENTINEL_BETA_SOUL');
    const v = join(root, 'voiceB');
    mkdirSync(v, { recursive: true });
    writeFileSync(join(v, 'STYLE-GUIDE.md'), 'SENTINEL_VOICE_STYLE', 'utf-8');
    writeFileSync(join(v, 'VOICE-PROFILE.md'), 'SENTINEL_VOICE_PROFILE', 'utf-8');

    const soul = new SoulService(a);
    await soul.load();
    const before = soul.getFullContext();

    const result = await soul.composeForBook(b, v);
    assert.match(result, /SENTINEL_BETA_SOUL/, 'soul from authorDir');
    assert.match(result, /SENTINEL_VOICE_STYLE/, 'style from voiceDir');
    assert.match(result, /SENTINEL_VOICE_PROFILE/, 'voice from voiceDir');

    // No mutation.
    assert.strictEqual(soul.getFullContext(), before, 'no mutation after composeForBook with voiceDir');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
