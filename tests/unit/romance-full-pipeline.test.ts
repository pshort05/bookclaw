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
    const front = steps.slice(0, 4).map((s) => s.prompt).join('\n');
    assert.ok(!front.includes('undefined') && !front.includes('{{'), 'no unresolved vars');
    assert.ok(front.includes(heatWord), 'heat language baked into front half');
    assert.ok(steps.length > 4, 'production + report steps still present');
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
