/**
 * Unit test for the repo-root .gitignore workspace/ deny-by-default policy
 * (Tier-1 AuthorAgent hardening, Task 2).
 *
 * The repo .gitignore must ignore everything under workspace/ by default and
 * re-include ONLY the product-default files that ship with the repo. This
 * guards against push.sh's `git add .` sweeping runtime-written private data
 * (manuscripts, staged imports, generated covers, voice fingerprints) into
 * version control the moment a currently-empty runtime directory gets its
 * first file.
 *
 * Uses `git check-ignore <path>` via execSync from the repo root:
 *   - exit 0 (stdout: the path) => IGNORED
 *   - exit 1 (no stdout)        => NOT ignored
 * execSync throws on non-zero exit, so both outcomes are handled via helper.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const repoRoot = join(import.meta.dirname, '..', '..');

/** Returns true if `git check-ignore` reports the path as ignored. */
function isIgnored(relPath: string): boolean {
  try {
    execFileSync('git', ['check-ignore', relPath], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return true; // exit 0 => ignored
  } catch (err: any) {
    if (typeof err.status === 'number') {
      return false; // exit 1 => not ignored
    }
    throw err; // unexpected failure (e.g. git not found)
  }
}

describe('.gitignore workspace/ deny-by-default', () => {
  describe('leak-risk runtime paths must be ignored', () => {
    const leakPaths = [
      'workspace/images/x.png',
      'workspace/.import-staging/x',
      'workspace/character-voices/x.json',
      'workspace/plot-promises/proj1.json',
      'workspace/website/index.html',
    ];
    for (const p of leakPaths) {
      test(`${p} is ignored`, () => {
        assert.equal(isIgnored(p), true, `${p} should be ignored but is NOT`);
      });
    }
  });

  describe('representative runtime dirs remain ignored', () => {
    const runtimePaths = ['workspace/books/slug/book.json', 'workspace/memory/x'];
    for (const p of runtimePaths) {
      test(`${p} is ignored`, () => {
        assert.equal(isIgnored(p), true, `${p} should be ignored but is NOT`);
      });
    }
  });

  describe('shipped-default tracked files must NOT be ignored', () => {
    const trackedPaths = [
      'workspace/SKILLS.txt',
      'workspace/soul/PERSONALITY.md',
      'workspace/soul/SOUL.md',
      'workspace/soul/STYLE-GUIDE.md',
      'workspace/soul/VOICE-PROFILE.md',
      'workspace/projects/.template/README.md',
    ];
    for (const p of trackedPaths) {
      test(`${p} is NOT ignored`, () => {
        assert.equal(isIgnored(p), false, `${p} should NOT be ignored but IS`);
      });
    }
  });

  test('the currently-tracked workspace/ file set is unchanged (6 files)', () => {
    const out = execFileSync('git', ['ls-files', 'workspace/'], { cwd: repoRoot }).toString().trim();
    const files = out.split('\n').filter(Boolean).sort();
    assert.deepEqual(files, [
      'workspace/SKILLS.txt',
      'workspace/projects/.template/README.md',
      'workspace/soul/PERSONALITY.md',
      'workspace/soul/SOUL.md',
      'workspace/soul/STYLE-GUIDE.md',
      'workspace/soul/VOICE-PROFILE.md',
    ]);
  });

  test('git status --porcelain shows no newly-committable workspace content', () => {
    const out = execFileSync('git', ['status', '--porcelain', '--', 'workspace/'], {
      cwd: repoRoot,
    }).toString();
    // Any line here would represent workspace content that git now considers
    // stageable (untracked-and-not-ignored, or modified-tracked). None of the
    // 6 shipped-default files are expected to be dirty in a clean checkout,
    // and no leak-risk dir should show up as untracked ('??').
    const untrackedLeaks = out
      .split('\n')
      .filter((line) => line.startsWith('??'));
    assert.deepEqual(untrackedLeaks, [], `unexpected untracked workspace content:\n${out}`);
  });
});
