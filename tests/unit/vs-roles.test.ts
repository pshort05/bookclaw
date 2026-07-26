import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isVsEnabled, resolveVsConfig, VS_ROLES } from '../../gateway/src/sampling/vs-roles.js';

test('VS is enabled on an allowlisted role', () => {
  assert.equal(isVsEnabled({ role: 'approach', vs: { enabled: true } }), true);
  assert.equal(isVsEnabled({ role: 'draft', vs: { enabled: true } }), true);
});

test('VS is refused on a non-allowlisted role even with vs.enabled', () => {
  assert.equal(isVsEnabled({ role: 'continuity', vs: { enabled: true } }), false);
  assert.equal(isVsEnabled({ role: 'editorial', vs: { enabled: true } }), false);
});

test('no vs block → not enabled', () => {
  assert.equal(isVsEnabled({ role: 'draft' }), false);
});

test('resolveVsConfig fills defaults and clamps k', () => {
  assert.deepEqual(resolveVsConfig({ vs: { enabled: true } }), { k: 5, probabilityThreshold: 0.10, variant: 'cot' });
  assert.equal(resolveVsConfig({ vs: { enabled: true, k: 99 } }).k, 8);
  assert.equal(resolveVsConfig({ vs: { enabled: true, k: 1 } }).k, 2);
});

test('scene_brief is in the allowlist (future attach point)', () => {
  assert.ok(VS_ROLES.has('scene_brief'));
});
