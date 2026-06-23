import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GROUP_NAMES, resolveToolGroups } from '../../src/tool-groups.js';

test('unset env selects the "all" profile (every group)', () => {
  const r = resolveToolGroups({});
  assert.deepEqual([...r.names].sort(), [...GROUP_NAMES].sort());
  assert.match(r.source, /profile=all/);
  assert.deepEqual(r.warnings, []);
});

test('profile=core selects the core groups plus the always-on escape-hatch', () => {
  const names: string[] = resolveToolGroups({ BOOKCLAW_MCP_PROFILE: 'core' }).names;
  assert.ok(names.includes('escape-hatch'));
  assert.ok(names.includes('books'));
  assert.ok(!names.includes('marketing'));
  assert.ok(!names.includes('personas'));
});

test('profile=author adds personas/series/craft to core', () => {
  const names: string[] = resolveToolGroups({ BOOKCLAW_MCP_PROFILE: 'author' }).names;
  for (const g of ['personas', 'series', 'craft', 'books', 'escape-hatch']) assert.ok(names.includes(g), `missing ${g}`);
  assert.ok(!names.includes('marketing'));
});

test('unknown profile falls back to all with a warning', () => {
  const r = resolveToolGroups({ BOOKCLAW_MCP_PROFILE: 'bogus' });
  assert.deepEqual([...r.names].sort(), [...GROUP_NAMES].sort());
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /bogus/);
});

test('BOOKCLAW_MCP_GROUPS overrides the profile with an explicit allowlist', () => {
  const r = resolveToolGroups({ BOOKCLAW_MCP_PROFILE: 'core', BOOKCLAW_MCP_GROUPS: 'craft,media' });
  assert.deepEqual([...r.names].sort(), ['craft', 'escape-hatch', 'media']);
  assert.match(r.source, /groups=/);
});

test('escape-hatch is always present even when not requested', () => {
  const names: string[] = resolveToolGroups({ BOOKCLAW_MCP_GROUPS: 'books' }).names;
  assert.ok(names.includes('escape-hatch'));
  assert.ok(names.includes('books'));
});

test('unknown groups in the allowlist are dropped with a warning', () => {
  const r = resolveToolGroups({ BOOKCLAW_MCP_GROUPS: 'books,nope,media' });
  const names: string[] = r.names;
  assert.ok(!names.includes('nope'));
  assert.ok(names.includes('books') && names.includes('media'));
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /nope/);
});
