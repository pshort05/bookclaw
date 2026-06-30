/**
 * Unit tests for SkillLoader's built-in + workspace overlay and reload()
 * (gateway/src/skills/loader.ts).
 *
 * Run via: npm run test:unit  (node --test through tsx)
 *
 * Creates throwaway built-in + workspace skill trees on disk so we can assert
 * the overlay merge (workspace overrides built-in by name), the `source` field,
 * and that reload() re-reads disk while preserving runtime synthetic skills.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SkillLoader } from '../../gateway/src/skills/loader.js';

function writeSkill(baseDir: string, category: string, name: string, description: string, body: string): void {
  const dir = join(baseDir, category, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'),
    `---\ndescription: ${description}\ntriggers:\n  - ${name}\n---\n# ${name}\n\n${body}\n`);
}

test('SkillLoader merges a workspace overlay over built-ins and tags source', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-skills-'));
  try {
    const builtin = join(root, 'skills');
    const workspace = join(root, 'workspace', 'skills');
    writeSkill(builtin, 'author', 'write', 'built-in write', 'BUILTIN BODY');
    writeSkill(builtin, 'core', 'self-improve', 'built-in self-improve', 'core body');
    writeSkill(workspace, 'author', 'write', 'user-overridden write', 'WORKSPACE BODY'); // overrides built-in
    writeSkill(workspace, 'author', 'my-skill', 'a user-created skill', 'user body');     // new

    const loader = new SkillLoader(builtin, {} as never, workspace);
    await loader.loadAll();

    const write = loader.getSkillByName('write');
    assert.equal(write?.source, 'workspace', 'workspace copy should win');
    assert.ok(write?.content.includes('WORKSPACE BODY'), 'should serve the workspace content');

    assert.equal(loader.getSkillByName('self-improve')?.source, 'builtin');
    assert.equal(loader.getSkillByName('my-skill')?.source, 'workspace');

    // Catalog carries source too.
    const cat = loader.getSkillCatalog().find(s => s.name === 'write');
    assert.equal(cat?.source, 'workspace');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('matchSkillNames returns skill names, not "---" frontmatter (activity-log fix)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-skills-'));
  try {
    const builtin = join(root, 'skills');
    writeSkill(builtin, 'author', 'book-bible', 'maintain world consistency', 'body');
    writeSkill(builtin, 'author', 'outline', 'structure a story', 'body');
    const loader = new SkillLoader(builtin, {} as never, join(root, 'workspace', 'skills'));
    await loader.loadAll();

    // matchSkills returns full content (first line is the '---' frontmatter delimiter).
    const content = loader.matchSkills('please use book-bible here');
    assert.ok(content[0]?.startsWith('---'), 'matchSkills returns content starting with frontmatter');

    // matchSkillNames returns the actual skill name instead.
    assert.deepEqual(loader.matchSkillNames('please use book-bible here'), ['book-bible']);
    assert.deepEqual(loader.matchSkillNames('nothing matches here'), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('reload() re-reads disk and preserves runtime synthetic skills', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-skills-'));
  try {
    const builtin = join(root, 'skills');
    writeSkill(builtin, 'author', 'outline', 'outline a story', 'v1');
    const loader = new SkillLoader(builtin, {} as never, join(root, 'workspace', 'skills'));
    await loader.loadAll();
    loader.registerSynthetic([{ name: 'tool-x', description: 'from a tool', triggers: ['toolx'] }]);
    assert.equal(loader.getSkillByName('tool-x')?.source, 'synthetic');

    // Edit the file on disk, then reload.
    writeSkill(builtin, 'author', 'outline', 'outline a story', 'v2-edited');
    await loader.reload();

    assert.ok(loader.getSkillByName('outline')?.content.includes('v2-edited'), 'reload should pick up the edit');
    assert.equal(loader.getSkillByName('tool-x')?.source, 'synthetic', 'synthetic skill should survive reload');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
