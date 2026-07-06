/**
 * Unit tests for the narrative anti-fingerprint assets (spec:
 * docs/superpowers/specs/2026-07-06-anti-fingerprint-skill-design.md):
 *
 *  - library/pipelines/editorial-fingerprint.json — per-chapter 3-stage
 *    Audit -> Apply Fixes -> Humanize chain (StoryScope 2-pass + style polish)
 *  - skills/author/fingerprint-audit — 2-pass structural-tell catalog
 *  - skills/author/humanize — genre-neutral style de-AI pass
 *  - skills/author/narrative-anti-fingerprint — drafting-side prevention
 *
 * Asserts the pipeline parses/expands with full var interpolation and that all
 * three skills load through the real SkillLoader with loader-compatible
 * (single-line description) frontmatter.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parsePipelineJson } from '../../gateway/src/services/book-types.js';
import { expandSteps } from '../../gateway/src/services/pipeline-expand.js';
import { buildPipelineVars } from '../../gateway/src/services/pipeline-vars.js';
import { SkillLoader } from '../../gateway/src/skills/loader.js';

const PIPELINE_PATH = join('library', 'pipelines', 'editorial-fingerprint.json');

test('editorial-fingerprint is valid pipeline JSON with a 3-stage chapter-expand block', () => {
  const p = parsePipelineJson(readFileSync(PIPELINE_PATH, 'utf-8'));
  assert.equal(p.schemaVersion, 1);
  const expand = (p.steps as any[]).find((s) => s.expand === 'chapters');
  assert.ok(expand, 'has an expand:chapters group');
  assert.equal(expand.steps.length, 3, 'three per-chapter stages');
  assert.deepEqual(
    expand.steps.map((s: any) => s.taskType),
    ['revision', 'final_edit', 'final_edit'],
    'stage task types match Audit -> Apply Fixes -> Humanize',
  );
  assert.deepEqual(
    expand.steps.map((s: any) => s.skill),
    ['fingerprint-audit', 'fingerprint-audit', 'humanize'],
    'audit + fix share the fingerprint-audit skill; polish uses generic humanize',
  );
  // No baked model overrides — tier routing must decide (Neptune has no Claude key).
  assert.ok(expand.steps.every((s: any) => !s.modelOverride), 'no hardcoded modelOverride');
});

test('editorial-fingerprint expands to 3 steps per chapter, fully interpolated', () => {
  const p = parsePipelineJson(readFileSync(PIPELINE_PATH, 'utf-8'));
  const vars = buildPipelineVars({ title: 'T', description: 'd', targetChapters: 4, targetWordsPerChapter: 2800 });
  const resolved = expandSteps(p.steps as any[], vars);

  assert.equal(resolved.length, 4 * 3, '4 chapters x 3 stages');
  assert.ok(resolved.every((s) => !/\{\{/.test(s.prompt)), 'no unsubstituted {{vars}} remain');

  const ch3 = resolved.filter((s) => s.chapterNumber === 3);
  assert.equal(ch3.length, 3, 'chapter 3 has all three stages');

  // The prose-emitting stages carry the per-chapter word-count target; the audit must not.
  const audit = resolved.find((s) => s.label === 'Fingerprint Audit — Chapter 1');
  assert.ok(audit, 'audit step present');
  assert.equal(audit?.wordCountTarget, undefined, 'audit emits JSON findings, not prose');
  const fix = resolved.find((s) => s.label === 'Apply Fingerprint Fixes — Chapter 1');
  assert.equal(fix?.wordCountTarget, 2800);
  const humanize = resolved.find((s) => s.label === 'Humanize — Chapter 1');
  assert.equal(humanize?.wordCountTarget, 2800);
});

test('the three anti-fingerprint skills load via the real SkillLoader', async () => {
  const loader = new SkillLoader('skills', {} as never, join('tests', 'no-such-workspace-skills'));
  await loader.loadAll();

  for (const name of ['fingerprint-audit', 'humanize', 'narrative-anti-fingerprint']) {
    const s = loader.getSkillByName(name);
    assert.ok(s, `skill ${name} is installed`);
    assert.equal(s?.category, 'author');
    // Loader only parses single-line descriptions; a folded-block (>) frontmatter
    // description would come through as ">" — guard against that install mistake.
    assert.ok((s?.description ?? '').length > 20, `${name} has a real single-line description`);
    assert.ok((s?.triggers ?? []).length > 0, `${name} has triggers`);
  }

  // Drafting-side prevention auto-injects on drafting-step language.
  assert.ok(
    loader.matchSkillNames('draft the next scene of the chapter').includes('narrative-anti-fingerprint'),
    'narrative-anti-fingerprint matches drafting-step language',
  );
  // The audit skill answers fingerprint/tell language without colliding with humanize.
  assert.ok(
    loader.matchSkillNames('run a narrative audit for ai tells').includes('fingerprint-audit'),
    'fingerprint-audit matches audit language',
  );
});

test('fingerprint-audit skill carries both pass rule-blocks and the per-model appendix', () => {
  const md = readFileSync(join('skills', 'author', 'fingerprint-audit', 'SKILL.md'), 'utf-8');
  // Pass 1 catalog: the seven core tell categories, by their canonical headings.
  for (const category of ['STATED THEME', 'CHRONOLOGY', 'EMOTION DELIVERY', 'SINGLE TRACK', 'MORAL CLARITY', 'REFERENCE SPECIFICITY', 'SEALED BUBBLE']) {
    assert.ok(md.includes(category), `Pass 1 catalog includes ${category}`);
  }
  // Per-model appendix (one skill, evidence-driven — NOT per-model skill files).
  for (const model of ['Claude', 'GPT', 'Gemini', 'DeepSeek']) {
    assert.ok(md.includes(model), `per-model appendix covers ${model}`);
  }
  // Pass 2 conservatism: never invent material for structural gaps.
  assert.ok(/scope.*manuscript|manuscript.*scope/i.test(md), 'manuscript-scope findings are distinguished');
  assert.ok(/flag/i.test(md) && /fabricat|invent/i.test(md), 'fix pass flags rather than fabricates new material');
});

test('generic humanize skill is self-sufficient and leaves romance-humanize untouched', () => {
  const md = readFileSync(join('skills', 'author', 'humanize', 'SKILL.md'), 'utf-8');
  // Must not require a context-supplied forbidden-words doc: carries a fallback list.
  assert.ok(/fallback/i.test(md), 'humanize documents a fallback banned-list');
  // Same absolute-protection posture as romance-humanize.
  assert.ok(/dialogue/i.test(md) && /markdown/i.test(md), 'protects dialogue and Markdown');

  // Guard: romance-humanize (referenced by live romance pipelines + snapshotted
  // into existing Neptune book containers) must remain exactly the shared asset.
  const romance = readFileSync(join('skills', 'author', 'romance-humanize', 'SKILL.md'), 'utf-8');
  assert.ok(romance.includes('name: romance-humanize'), 'romance-humanize still installed under its own name');
});
