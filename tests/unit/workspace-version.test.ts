/**
 * Unit tests for the workspace-level version gate (owner roadmap: versioning
 * breaking-change gate). Mirrors the per-book classifyVersion posture, applied to
 * the whole workspace: the persisted workspace.json `schemaVersion` is classified
 * against this build's supported range, and an incompatible marker halts boot
 * unless the operator consciously sets the override.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  WORKSPACE_SCHEMA_VERSION,
  WORKSPACE_MIN_SUPPORTED,
  classifyWorkspace,
  workspaceGate,
} from '../../gateway/src/services/workspace-version.js';

test('classifyWorkspace: current version is ok', () => {
  assert.equal(classifyWorkspace(WORKSPACE_SCHEMA_VERSION), 'ok');
});

test('classifyWorkspace: the minimum supported version is ok', () => {
  assert.equal(classifyWorkspace(WORKSPACE_MIN_SUPPORTED), 'ok');
});

test('classifyWorkspace: below the minimum is quarantined (too old)', () => {
  assert.equal(classifyWorkspace(WORKSPACE_MIN_SUPPORTED - 1), 'quarantined');
});

test('classifyWorkspace: above the current version is readonly (newer app wrote it)', () => {
  assert.equal(classifyWorkspace(WORKSPACE_SCHEMA_VERSION + 1), 'readonly');
});

test('workspaceGate: a compatible marker proceeds without halting', () => {
  const g = workspaceGate(WORKSPACE_SCHEMA_VERSION, false);
  assert.equal(g.halt, false);
  assert.equal(g.level, 'ok');
});

test('workspaceGate: a too-new marker halts boot (fatal) without an override', () => {
  const g = workspaceGate(WORKSPACE_SCHEMA_VERSION + 1, false);
  assert.equal(g.halt, true);
  assert.equal(g.level, 'fatal');
  assert.match(g.message, /Refusing to start/);
  assert.match(g.message, /BOOKCLAW_SKIP_VERSION_GATE=1/);
});

test('workspaceGate: a too-old marker halts boot (fatal) without an override', () => {
  const g = workspaceGate(WORKSPACE_MIN_SUPPORTED - 1, false);
  assert.equal(g.halt, true);
  assert.equal(g.level, 'fatal');
});

test('workspaceGate: the override downgrades an incompatible marker to a warning and continues', () => {
  const g = workspaceGate(WORKSPACE_SCHEMA_VERSION + 1, true);
  assert.equal(g.halt, false);
  assert.equal(g.level, 'warn');
  assert.match(g.message, /unsafe/i);
});

test('workspaceGate: a compatible marker ignores the override (stays ok, not warn)', () => {
  const g = workspaceGate(WORKSPACE_SCHEMA_VERSION, true);
  assert.equal(g.halt, false);
  assert.equal(g.level, 'ok');
});
