/**
 * Multi-step skills Phase A — SkillLoader reads a sibling steps.json and attaches
 * steps/retries to the Skill (executable); absent/invalid → passive (fail-soft).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SkillLoader } from '../../gateway/src/skills/loader.js';

function writeSkill(baseDir: string, category: string, name: string, stepsJson?: unknown): void {
  const dir = join(baseDir, category, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), `---\ndescription: ${name}\ntriggers:\n  - ${name}\n---\n# ${name}\n\nbody\n`);
  if (stepsJson !== undefined) writeFileSync(join(dir, 'steps.json'), typeof stepsJson === 'string' ? stepsJson : JSON.stringify(stepsJson));
}

async function load(root: string) {
  const loader = new SkillLoader(join(root, 'skills'), {} as never, join(root, 'workspace', 'skills'));
  await loader.loadAll();
  return loader;
}

test('a valid steps.json makes the skill executable (steps + retries attached)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-ss-'));
  try {
    writeSkill(join(root, 'skills'), 'author', 'humanize', {
      retries: 2,
      steps: [
        { name: 'detect', model: 'google/gemini-2.0-flash-001', temperature: 0.2, prompt: 'find {{input}}' },
        { name: 'rewrite', model: 'google/gemini-pro-1.5', temperature: 0.9, prompt: 'fix {{previous}}' },
      ],
    });
    const s = (await load(root)).getSkillByName('humanize');
    assert.equal(s?.steps?.length, 2);
    assert.equal(s?.retries, 2);
    assert.equal(s?.steps?.[0].model, 'google/gemini-2.0-flash-001');
    assert.equal(s?.steps?.[1].temperature, 0.9);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('no steps.json → passive skill (steps undefined)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-ss-'));
  try {
    writeSkill(join(root, 'skills'), 'author', 'plain');
    assert.equal((await load(root)).getSkillByName('plain')?.steps, undefined);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('retries clamp to 0–4', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-ss-'));
  try {
    writeSkill(join(root, 'skills'), 'author', 'hi', { retries: 99, steps: [{ model: 'm', prompt: 'p' }] });
    writeSkill(join(root, 'skills'), 'author', 'lo', { retries: -5, steps: [{ model: 'm', prompt: 'p' }] });
    const l = await load(root);
    assert.equal(l.getSkillByName('hi')?.retries, 4);
    assert.equal(l.getSkillByName('lo')?.retries, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('invalid steps.json → passive + no throw', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-ss-'));
  try {
    writeSkill(join(root, 'skills'), 'author', 'bad-json', '{not json');
    writeSkill(join(root, 'skills'), 'author', 'no-steps', { retries: 1, steps: [] });
    writeSkill(join(root, 'skills'), 'author', 'no-prompt', { steps: [{ model: 'm' }] });
    const l = await load(root);
    assert.equal(l.getSkillByName('bad-json')?.steps, undefined);
    assert.equal(l.getSkillByName('no-steps')?.steps, undefined);
    assert.equal(l.getSkillByName('no-prompt')?.steps, undefined); // prompt still required
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('an unknown provider is rejected at the parse trust boundary', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-ss-'));
  try {
    writeSkill(join(root, 'skills'), 'author', 'badprov', { steps: [{ provider: 'anthropic', model: 'm', prompt: 'p' }] });
    assert.equal((await load(root)).getSkillByName('badprov')?.steps, undefined); // 'anthropic' is not a known provider
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('provider is captured; model optional (defaults handled at runtime)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-ss-'));
  try {
    writeSkill(join(root, 'skills'), 'author', 'multi', {
      steps: [
        { provider: 'claude', prompt: 'a {{input}}' },                 // no model — valid now
        { provider: 'openrouter', model: 'google/gemini-2.0-flash-001', prompt: 'b {{previous}}' },
      ],
    });
    const s = (await load(root)).getSkillByName('multi');
    assert.equal(s?.steps?.length, 2);
    assert.equal(s?.steps?.[0].provider, 'claude');
    assert.equal(s?.steps?.[0].model, undefined);
    assert.equal(s?.steps?.[1].provider, 'openrouter');
    assert.equal(s?.steps?.[1].model, 'google/gemini-2.0-flash-001');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
