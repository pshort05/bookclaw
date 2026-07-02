/**
 * Regression test for bug L6: SkillLoader silently dropped a SKILL.md with
 * CRLF line endings because the frontmatter regex `^---\n` only matched LF.
 * A CRLF file yields `---\r\n`, the `\r` defeated the match, parseSkill returned
 * null, and the skill was skipped with no log.
 *
 * Run via: node --import tsx --test tests/unit/skill-loader-crlf.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SkillLoader } from '../../gateway/src/skills/loader.js';

function writeSkillWithEol(baseDir: string, category: string, name: string, eol: '\n' | '\r\n'): void {
  const dir = join(baseDir, category, name);
  mkdirSync(dir, { recursive: true });
  const lines = ['---', 'description: a CRLF skill', 'triggers:', '  - foo', '---', `# ${name}`, '', 'body'];
  writeFileSync(join(dir, 'SKILL.md'), lines.join(eol));
}

test('SkillLoader parses a SKILL.md with CRLF line endings', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-skills-crlf-'));
  try {
    const builtin = join(root, 'skills');
    writeSkillWithEol(builtin, 'core', 'crlf-skill', '\r\n');
    const loader = new SkillLoader(builtin, {} as never, join(root, 'workspace', 'skills'));
    await loader.loadAll();

    const skill = loader.getSkillByName('crlf-skill');
    assert.ok(skill, 'CRLF skill should load, not be silently dropped');
    assert.ok(skill?.triggers.includes('foo'), 'triggers should be parsed from CRLF frontmatter');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('SkillLoader still parses a SKILL.md with LF line endings (regression guard)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-skills-lf-'));
  try {
    const builtin = join(root, 'skills');
    writeSkillWithEol(builtin, 'core', 'lf-skill', '\n');
    const loader = new SkillLoader(builtin, {} as never, join(root, 'workspace', 'skills'));
    await loader.loadAll();

    const skill = loader.getSkillByName('lf-skill');
    assert.ok(skill, 'LF skill should load');
    assert.ok(skill?.triggers.includes('foo'), 'triggers should be parsed from LF frontmatter');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
