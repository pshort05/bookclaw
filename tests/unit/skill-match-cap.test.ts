/**
 * Unit tests for the skill-match token cap (gateway/src/skills/loader.ts).
 *
 * SkillLoader.matchSkills() used to push the FULL markdown of every
 * trigger-substring-matched skill with no cap and no budget — a message
 * matching several 15-23KB skill files could inject tens of thousands of
 * untracked chars into the system prompt. This asserts the fix: score +
 * rank matches, cap at MAX_MATCHED_SKILLS, bound total injected content at
 * CONTENT_BUDGET_CHARS, and keep matchSkills/matchSkillNames in agreement.
 *
 * Run via: node --import tsx --test tests/unit/skill-match-cap.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SkillLoader } from '../../gateway/src/skills/loader.js';

function writeSkill(
  baseDir: string,
  category: string,
  name: string,
  description: string,
  triggers: string[],
  body: string,
): void {
  const dir = join(baseDir, category, name);
  mkdirSync(dir, { recursive: true });
  const triggerLines = triggers.map((t) => `  - ${t}`).join('\n');
  writeFileSync(
    join(dir, 'SKILL.md'),
    `---\ndescription: ${description}\ntriggers:\n${triggerLines}\n---\n${body}\n`,
  );
}

function newLoader(root: string): { loader: SkillLoader; builtin: string } {
  const builtin = join(root, 'skills');
  const loader = new SkillLoader(builtin, {} as never, join(root, 'workspace', 'skills'));
  return { loader, builtin };
}

test('matchSkills caps results at 3 when more skills match', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-skill-cap-'));
  try {
    const { loader, builtin } = newLoader(root);
    for (let i = 1; i <= 6; i++) {
      writeSkill(builtin, 'author', `skill-${i}`, `desc ${i}`, ['revision'], `body ${i}`);
    }
    await loader.loadAll();

    const matched = loader.matchSkills('please do a revision pass on chapter one');
    assert.equal(matched.length, 3, `expected exactly 3 matches (cap), got ${matched.length}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('matchSkillNames selects higher-scoring skills over weaker substring-only matches', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-skill-cap-'));
  try {
    const { loader, builtin } = newLoader(root);
    // 'champion' hits two word-bounded trigger phrases (highest score).
    writeSkill(builtin, 'author', 'champion', 'desc', ['orbital mechanics', 'thrust vector'], 'body');
    // 'runner-up' hits one word-bounded, long trigger.
    writeSkill(builtin, 'author', 'runner-up', 'desc', ['orbital mechanics'], 'body');
    // 'third' hits one word-bounded, short trigger.
    writeSkill(builtin, 'author', 'third', 'desc', ['thrust'], 'body');
    // 'excluded' only matches as a bare (non-word-bounded) substring inside "vector".
    writeSkill(builtin, 'author', 'excluded', 'desc', ['vect'], 'body');
    await loader.loadAll();

    const input = "Explain orbital mechanics and thrust vector for the ship's flight path.";
    const names = loader.matchSkillNames(input);

    assert.deepEqual(names, ['champion', 'runner-up', 'third']);
    assert.ok(!names.includes('excluded'), 'weakest (non-word-bounded) match should be dropped by the cap');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('joined matched skill bodies stay within the 8000-char content budget', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-skill-cap-'));
  try {
    const { loader, builtin } = newLoader(root);
    for (let i = 1; i <= 3; i++) {
      writeSkill(builtin, 'author', `budget-${i}`, `desc ${i}`, ['flowstate'], 'X'.repeat(2000));
    }
    await loader.loadAll();

    const matched = loader.matchSkills('need help reaching flowstate today');
    const joined = matched.join('\n');
    assert.ok(joined.length <= 8000, `joined content should be <=8000 chars, got ${joined.length}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an oversized skill body is truncated with a [truncated] marker', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-skill-cap-'));
  try {
    const { loader, builtin } = newLoader(root);
    writeSkill(builtin, 'author', 'huge', 'desc', ['huge-trigger'], 'X'.repeat(10000));
    await loader.loadAll();

    const matched = loader.matchSkills('please use huge-trigger now');
    assert.equal(matched.length, 1);
    assert.ok(matched[0].includes('[truncated]'), 'oversized body should be marked truncated');
    assert.ok(matched[0].length <= 8000, `truncated body should fit the budget, got ${matched[0].length}`);
    assert.ok(matched[0].length < 10000, 'truncated body should be shorter than the original');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('matchSkillNames returns names for the same selected set and order as matchSkills', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-skill-cap-'));
  try {
    const { loader, builtin } = newLoader(root);
    writeSkill(builtin, 'author', 'champion', 'desc', ['orbital mechanics', 'thrust vector'], 'BODY-FOR-champion');
    writeSkill(builtin, 'author', 'runner-up', 'desc', ['orbital mechanics'], 'BODY-FOR-runner-up');
    writeSkill(builtin, 'author', 'third', 'desc', ['thrust'], 'BODY-FOR-third');
    writeSkill(builtin, 'author', 'excluded', 'desc', ['vect'], 'BODY-FOR-excluded');
    await loader.loadAll();

    const input = "Explain orbital mechanics and thrust vector for the ship's flight path.";
    const bodies = loader.matchSkills(input);
    const names = loader.matchSkillNames(input);

    assert.equal(bodies.length, names.length);
    for (let i = 0; i < names.length; i++) {
      assert.ok(bodies[i].includes(`BODY-FOR-${names[i]}`), `body[${i}] should belong to name[${i}] (${names[i]})`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('matchSkillNames excludes a budget-exhausted skill (agrees with matchSkills)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-skill-cap-'));
  try {
    const { loader, builtin } = newLoader(root);
    // First selected skill's body alone exhausts the 8000-char budget, so the
    // second selected skill is OMITTED from matchSkills — matchSkillNames must
    // omit it too (the review's budget-exhaustion divergence case).
    const huge = 'X'.repeat(9000);
    writeSkill(builtin, 'author', 'big', 'desc', ['orbital mechanics', 'thrust vector'], huge);
    writeSkill(builtin, 'author', 'small', 'desc', ['orbital mechanics'], 'SMALL-BODY');
    await loader.loadAll();

    const input = 'Explain orbital mechanics and thrust vector.';
    const bodies = loader.matchSkills(input);
    const names = loader.matchSkillNames(input);

    assert.equal(bodies.length, names.length, 'bodies and names must have the same count');
    assert.ok(!names.includes('small'), 'the budget-omitted skill must not be reported by matchSkillNames');
    assert.equal(names[0], 'big');
    assert.ok(bodies[0].includes('[truncated]'), 'the first skill is truncated to the budget');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('zero-match input returns []', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-skill-cap-'));
  try {
    const { loader, builtin } = newLoader(root);
    writeSkill(builtin, 'author', 'only', 'desc', ['unique-trigger-xyz'], 'body');
    await loader.loadAll();

    assert.deepEqual(loader.matchSkills('nothing relevant here at all'), []);
    assert.deepEqual(loader.matchSkillNames('nothing relevant here at all'), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
