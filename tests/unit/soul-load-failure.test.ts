/**
 * Regression test for VERIFIED High bug #12: a transient FS error during a book
 * switch must NOT erase the currently-loaded author identity.
 *
 * SoulService.load() used to blank all content fields synchronously *before*
 * awaiting the file reads. If a read then threw (transient FS error), the
 * fields stayed blanked and getFullContext() silently fell back to the generic
 * "You are BookClaw…" prompt — even though useBook() logged "keeping current
 * Author". The fix composes the new values into locals and only assigns to the
 * instance once every read has succeeded, so a failed load is non-destructive.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SoulService } from '../../gateway/src/services/soul.js';

/** Author dir with SOUL.md + STYLE-GUIDE.md + VOICE-PROFILE.md. */
function authorDirFull(root: string, name: string, soul: string, style: string, voice: string): string {
  const d = join(root, name);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'SOUL.md'), soul, 'utf-8');
  writeFileSync(join(d, 'STYLE-GUIDE.md'), style, 'utf-8');
  writeFileSync(join(d, 'VOICE-PROFILE.md'), voice, 'utf-8');
  return d;
}

/**
 * Build an author dir that EXISTS (so useBook's existsSync gate passes) but
 * whose SOUL.md is a directory — existsSync(soulPath) is true, yet readFile
 * throws EISDIR, reproducing a transient mid-read failure without stubbing.
 */
function authorDirWithUnreadableSoul(root: string, name: string): string {
  const d = join(root, name);
  mkdirSync(d, { recursive: true });
  mkdirSync(join(d, 'SOUL.md'), { recursive: true }); // read of a dir throws EISDIR
  return d;
}

test('failed useBook does NOT erase the prior author identity (non-destructive load)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-soulfail-'));
  try {
    const a = authorDirFull(root, 'authorA', '# Author A\n\nVoice of A', 'Style guide of A', 'Voice profile of A');
    const soul = new SoulService(a);
    await soul.load();

    // Author A is fully loaded.
    assert.equal(soul.getName(), 'Author A');
    assert.match(soul.getFullContext(), /Voice of A/);
    assert.match(soul.getFullContext(), /Style guide of A/);

    // Switch to author B whose SOUL.md read FAILS mid-load.
    const b = authorDirWithUnreadableSoul(root, 'authorB');
    await soul.useBook(b, null); // fail-soft: must not throw

    // Author A's identity must survive the failed load — NOT blanked to defaults.
    assert.equal(soul.getName(), 'Author A', 'name must still be Author A, not the BookClaw default');
    const ctx = soul.getFullContext();
    assert.match(ctx, /Voice of A/, 'A personality must be retained');
    assert.match(ctx, /Style guide of A/, 'A style guide must be retained');
    assert.doesNotMatch(
      ctx,
      /^You are BookClaw, a helpful writing assistant for authors\.$/,
      'must NOT fall back to the generic BookClaw prompt',
    );
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('successful useBook to a leaner author fully replaces the prior author (reset-on-success preserved)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-soulfail-'));
  try {
    const a = authorDirFull(root, 'authorA', '# Author A\n\nVoice of A', 'Style guide of A', 'Voice profile of A');
    const soul = new SoulService(a);
    await soul.load();
    assert.match(soul.getFullContext(), /Style guide of A/);
    assert.match(soul.getFullContext(), /Voice profile of A/);

    // Author B has ONLY SOUL.md — no style/voice.
    const b = join(root, 'authorB');
    mkdirSync(b, { recursive: true });
    writeFileSync(join(b, 'SOUL.md'), '# Author B\n\nVoice of B', 'utf-8');

    await soul.useBook(b, null);
    const ctx = soul.getFullContext();
    assert.equal(soul.getName(), 'Author B');
    assert.match(ctx, /Voice of B/);
    // A's style/voice must NOT leak through a successful repoint.
    assert.doesNotMatch(ctx, /Style guide of A/, 'A style guide must not leak into B');
    assert.doesNotMatch(ctx, /Voice profile of A/, 'A voice profile must not leak into B');
    assert.doesNotMatch(ctx, /Voice of A/, 'A personality must not leak into B');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
