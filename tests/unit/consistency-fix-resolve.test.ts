import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveChapterFile } from '../../gateway/src/services/consistency/fix-resolve.js';

function withTempDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'fix-resolve-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('per-chapter book: returns the whole file as both fileText and chapterText', () => {
  withTempDir((dir) => {
    const ch1 = '# Chapter 1\n\nHer eyes were blue.';
    const ch2 = '# Chapter 2\n\nHer eyes were green.';
    writeFileSync(join(dir, 'chapter-1.md'), ch1);
    writeFileSync(join(dir, 'chapter-2.md'), ch2);

    const r = resolveChapterFile(dir, 'chapter-2');
    assert.ok(r, 'chapter-2 should resolve');
    assert.equal(r!.filename, 'chapter-2.md');
    assert.equal(r!.fileText, ch2);
    assert.equal(r!.chapterText, ch2);
    assert.equal(r!.fileText, r!.chapterText);
  });
});

test('per-chapter book: matches a staged filename by chapter number', () => {
  withTempDir((dir) => {
    const ch3 = '# Chapter 3\n\nThe tower stood.';
    writeFileSync(join(dir, 'chapter-3-polish.md'), ch3);

    const r = resolveChapterFile(dir, 'chapter-3');
    assert.ok(r, 'chapter-3 should resolve to the polish file');
    assert.equal(r!.filename, 'chapter-3-polish.md');
    assert.equal(r!.chapterText, ch3);
  });
});

test('combined manuscript: fileText is the whole file, chapterText is the segment', () => {
  withTempDir((dir) => {
    const manuscript = [
      '# Chapter 1',
      '',
      'The sky was red.',
      '',
      '# Chapter 2',
      '',
      'The sky was blue.',
    ].join('\n');
    writeFileSync(join(dir, 'manuscript.md'), manuscript);

    const r = resolveChapterFile(dir, 'chapter-2');
    assert.ok(r, 'chapter-2 segment should resolve');
    assert.equal(r!.filename, 'manuscript.md');
    assert.equal(r!.fileText, manuscript, 'fileText is the whole combined file');
    assert.notEqual(r!.chapterText, manuscript, 'chapterText is only the segment');
    assert.match(r!.chapterText, /The sky was blue\./);
    assert.doesNotMatch(r!.chapterText, /The sky was red\./);
  });
});

test('returns null when nothing resolves', () => {
  withTempDir((dir) => {
    writeFileSync(join(dir, 'outline.md'), '# Outline\n\nnotes');
    assert.equal(resolveChapterFile(dir, 'chapter-9'), null);
  });
  assert.equal(resolveChapterFile(join(tmpdir(), 'does-not-exist-xyz'), 'chapter-1'), null);
});
