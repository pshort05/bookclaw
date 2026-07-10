import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildPipelineVars } from '../../gateway/src/services/pipeline-vars.js';
import { expandSteps } from '../../gateway/src/services/pipeline-expand.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const load = (name: string) => JSON.parse(readFileSync(join(root, 'library', 'pipelines', `${name}.json`), 'utf-8'));

const SEEDS = {
  title: 'Test Book',
  description: 'desc',
  targetChapters: 4,
  targetWordsPerChapter: 2000,
  storyArc: 'ARC_MARKER rivals-to-lovers over one summer',
  characters: 'CHAR_MARKER Mara, a stubborn baker; Jonah, the new rival',
  setting: 'SETTING_MARKER a small coastal town',
};

for (const [name, prodSkill, heatWord] of [
  ['romance-sweet-full', 'romance-sweet-first-draft', 'fade-to-black'],
  ['romance-spicy-full', 'romance-spicy-first-draft', 'open-door'],
] as const) {
  test(`${name}: front half weaves the seeds`, () => {
    const p = load(name);
    const steps = expandSteps(p.steps, buildPipelineVars(SEEDS));
    const allPrompts = steps.map((s) => s.prompt).join('\n');
    assert.ok(allPrompts.includes('ARC_MARKER'), 'storyArc woven');
    assert.ok(allPrompts.includes('CHAR_MARKER'), 'characters woven');
    assert.ok(allPrompts.includes('SETTING_MARKER'), 'setting woven');
  });

  test(`${name}: production block carries romance skills + modelOverrides`, () => {
    const p = load(name);
    const steps = expandSteps(p.steps, buildPipelineVars(SEEDS));
    // 4 chapters × 6 per-chapter production steps present:
    const draftSteps = steps.filter((s) => s.skill === prodSkill);
    assert.equal(draftSteps.length, 4, 'one first-draft step per chapter');
    assert.ok(draftSteps.every((s) => s.modelOverride?.model), 'draft steps keep modelOverride');
  });

  test(`${name}: empty seeds collapse cleanly (no dangling markers, front half still generates)`, () => {
    const p = load(name);
    const steps = expandSteps(p.steps, buildPipelineVars({ ...SEEDS, storyArc: '', characters: '', setting: '' }));
    // Front block is now Council + Premise + Character Bible + Setting + Chapter Outline (5 steps).
    const front = steps.slice(0, 5).map((s) => s.prompt).join('\n');
    assert.ok(!front.includes('undefined') && !front.includes('{{'), 'no unresolved vars');
    assert.ok(front.includes(heatWord), 'heat language baked into front half');
    assert.ok(steps.length > 5, 'production + report steps still present');
  });
}

// LLM Council (sub-project 3, Task 5): the council-origination step is prepended
// at index 0 in both romance-full pipelines. Its result (the base story) is
// injected downstream into the Premise step via the existing phase:'premise'
// step-result chaining (projects.ts buildProjectContext) — no new template var.
for (const file of ['romance-sweet-full.json', 'romance-spicy-full.json']) {
  test(`${file}: council-origination step is prepended at index 0`, () => {
    const pipe = JSON.parse(readFileSync(new URL(`../../library/pipelines/${file}`, import.meta.url), 'utf-8'));
    const first = pipe.steps[0];
    assert.equal(first.skill, 'council-origination', `${file} step 0 has skill 'council-origination'`);
    assert.equal(first.phase, 'premise', `${file} step 0 has phase 'premise'`);
    const premiseIndex = pipe.steps.findIndex((s: any) => s.label === 'Premise');
    assert.equal(premiseIndex, 1, `${file} Premise step still follows immediately after the council step`);
  });
}

for (const file of ['romance-sweet-full.json', 'romance-spicy-full.json']) {
  test(`${file}: Chapter Outline step weaves {{blueprint}}`, () => {
    const pipe = JSON.parse(readFileSync(new URL(`../../library/pipelines/${file}`, import.meta.url), 'utf-8'));
    const outline = pipe.steps.find((s: any) => s.label === 'Chapter Outline');
    assert.ok(outline, `${file} has a Chapter Outline step`);
    assert.match(outline.promptTemplate, /\{\{blueprint\}\}/, `${file} outline weaves {{blueprint}}`);
    assert.match(outline.promptTemplate, /\{\{setupEnd\}\}/, `${file} outline keeps beat-var fallback`);
  });
}

// The per-chapter production group is copied verbatim from the shipped romance
// pipeline; guard that copy against drift (a future edit that keeps skill names
// but alters prompt text or a modelOverride would otherwise pass undetected).
for (const [full, base] of [
  ['romance-sweet-full', 'romance-sweet'],
  ['romance-spicy-full', 'romance-spicy'],
] as const) {
  test(`${full}: production block is byte-identical to ${base}`, () => {
    const prod = load(full).steps.find((s: any) => s.expand === 'chapters');
    const src = load(base).steps.find((s: any) => s.expand === 'chapters');
    assert.deepEqual(prod, src);
  });
}
