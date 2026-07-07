/**
 * Guards for the visual pipeline builder's palette catalog
 * (frontend/studio/src/lib/stepPresets.ts): every preset taskType must be a
 * real TASK_TIERS key in the gateway AI router (so a router rename cannot
 * silently orphan a preset), and the palette-id codec + node factory must
 * round-trip every item kind.
 * Run: node --import tsx --test tests/unit/step-presets.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  STEP_PRESETS, paletteId, parsePaletteId, nodeFromPalette, type PaletteItem,
} from '../../frontend/studio/src/lib/stepPresets.js';
import { isGroupNode } from '../../frontend/studio/src/lib/pipelineEdits.js';

test('every preset taskType is a TASK_TIERS key in the gateway router', () => {
  const src = readFileSync(join(process.cwd(), 'gateway/src/ai/router.ts'), 'utf-8');
  const block = src.match(/const TASK_TIERS[^=]*=\s*\{([\s\S]*?)\n\};/);
  assert.ok(block, 'TASK_TIERS block found in router.ts');
  const keys = [...block![1].matchAll(/^\s*([a-z_]+):/gm)].map((m) => m[1]);
  assert.ok(keys.length >= 10, `parsed TASK_TIERS keys (${keys.length})`);
  for (const p of STEP_PRESETS) {
    assert.ok(keys.includes(p.taskType), `preset "${p.key}" taskType "${p.taskType}" is canonical`);
  }
});

test('presets have unique keys and non-empty labels', () => {
  assert.equal(new Set(STEP_PRESETS.map((p) => p.key)).size, STEP_PRESETS.length);
  for (const p of STEP_PRESETS) assert.ok(p.label.trim());
});

test('paletteId/parsePaletteId round-trip every item kind', () => {
  const items: PaletteItem[] = [
    { type: 'preset', key: STEP_PRESETS[0].key },
    { type: 'skill', name: 'romance-humanize' },
    { type: 'block', kind: 'parallel' },
    { type: 'block', kind: 'expand' },
  ];
  for (const item of items) assert.deepEqual(parsePaletteId(paletteId(item)), item);
  assert.equal(parsePaletteId('step-7'), null);
  assert.equal(parsePaletteId('pal:block:bogus'), null);
});

test('nodeFromPalette builds the right node per item kind', () => {
  let i = 0;
  const mk = () => `n${i++}`;
  const preset = nodeFromPalette({ type: 'preset', key: STEP_PRESETS[0].key }, mk);
  assert.ok(preset && preset.kind === 'step');
  assert.equal(preset.step.taskType, STEP_PRESETS[0].taskType);
  const skill = nodeFromPalette({ type: 'skill', name: 'my-skill' }, mk);
  assert.ok(skill && skill.kind === 'step');
  assert.equal(skill.step.skill, 'my-skill');
  assert.equal(skill.step.label, 'my-skill');
  const block = nodeFromPalette({ type: 'block', kind: 'parallel' }, mk);
  assert.ok(block && isGroupNode(block));
  assert.equal(block.members.length, 0);
  assert.equal(nodeFromPalette({ type: 'preset', key: 'no-such' }, mk), null);
});
