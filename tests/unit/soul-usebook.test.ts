/**
 * Unit tests for book-container Phase 3b: SoulService.useBook() re-points the
 * source dir to a book's templates/author/ and reloads, falling back to the
 * built-in default author dir when the snapshot is missing (fail-soft).
 * getFullContext() output must change when the active book changes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SoulService } from '../../gateway/src/services/soul.js';

function authorDir(root: string, name: string, soul: string): string {
  const d = join(root, name);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'SOUL.md'), soul, 'utf-8');
  return d;
}

/** Author dir with an additional STYLE-GUIDE.md and VOICE-PROFILE.md. */
function authorDirFull(root: string, name: string, soul: string, style: string, voice: string): string {
  const d = authorDir(root, name, soul);
  writeFileSync(join(d, 'STYLE-GUIDE.md'), style, 'utf-8');
  writeFileSync(join(d, 'VOICE-PROFILE.md'), voice, 'utf-8');
  return d;
}

test('useBook re-points the source and reload changes getFullContext', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-soul-'));
  try {
    const a = authorDir(root, 'authorA', '# Author A\n\nVoice of A');
    const b = authorDir(root, 'authorB', '# Author B\n\nVoice of B');
    const soul = new SoulService(a);
    await soul.load();
    assert.match(soul.getFullContext(), /Voice of A/);
    assert.equal(soul.getName(), 'Author A');

    await soul.useBook(b);
    assert.match(soul.getFullContext(), /Voice of B/);
    assert.equal(soul.getName(), 'Author B');
    assert.doesNotMatch(soul.getFullContext(), /Voice of A/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('useBook is fail-soft: a missing dir keeps the prior author loaded', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-soul-'));
  try {
    const a = authorDir(root, 'authorA', '# Author A\n\nVoice of A');
    const soul = new SoulService(a);
    await soul.load();
    await soul.useBook(join(root, 'does-not-exist'));
    // Falls back: prior author context is retained, not blanked.
    assert.match(soul.getFullContext(), /Voice of A/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('useBook resets fields: switching to a leaner author does not leak style/voice', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-soul-'));
  try {
    // Book A's author: SOUL.md + STYLE-GUIDE.md + VOICE-PROFILE.md.
    const a = authorDirFull(
      root,
      'authorA',
      '# Author A\n\nVoice of A',
      'Style guide of A',
      'Voice profile of A',
    );
    // Book B's author: only SOUL.md.
    const b = authorDir(root, 'authorB', '# Author B\n\nVoice of B');

    const soul = new SoulService(a);
    await soul.load();
    assert.match(soul.getFullContext(), /Style guide of A/);
    assert.match(soul.getFullContext(), /Voice profile of A/);

    await soul.useBook(b);
    const ctx = soul.getFullContext();
    assert.match(ctx, /Voice of B/);
    // A's style guide and voice profile must NOT leak into B's context.
    assert.doesNotMatch(ctx, /Style guide of A/);
    assert.doesNotMatch(ctx, /Voice profile of A/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
