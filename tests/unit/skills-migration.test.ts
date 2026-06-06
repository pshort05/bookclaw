/**
 * Boot migration: the user skill overlay moved from workspace/skills/ to
 * workspace/library/skills/ when skills were folded into the library
 * (book-container Phase 1). migrateSkillOverlay() moves the old dir once,
 * fail-soft, and never clobbers an existing new dir.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { migrateSkillOverlay } from '../../gateway/src/init/phase-05-research-skills.js';

test('migrateSkillOverlay moves the legacy overlay once', () => {
  const ws = mkdtempSync(join(tmpdir(), 'bookclaw-mig-'));
  try {
    const old = join(ws, 'skills', 'author', 'mine');
    mkdirSync(old, { recursive: true });
    writeFileSync(join(old, 'SKILL.md'), '---\ndescription: x\ntriggers:\n  - x\n---\n# mine\n');

    migrateSkillOverlay(ws);

    assert.ok(!existsSync(join(ws, 'skills')), 'old overlay should be gone');
    const moved = join(ws, 'library', 'skills', 'author', 'mine', 'SKILL.md');
    assert.ok(existsSync(moved), 'overlay should be under library/skills now');
    assert.ok(readFileSync(moved, 'utf-8').includes('# mine'));
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test('migrateSkillOverlay is a no-op when the new dir already exists', () => {
  const ws = mkdtempSync(join(tmpdir(), 'bookclaw-mig-'));
  try {
    mkdirSync(join(ws, 'skills', 'core', 'a'), { recursive: true });
    mkdirSync(join(ws, 'library', 'skills'), { recursive: true });
    migrateSkillOverlay(ws); // must not throw, must not overwrite
    assert.ok(existsSync(join(ws, 'skills')), 'old dir left untouched when new exists');
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});
