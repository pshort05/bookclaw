/**
 * Unit tests for PermissionManager (gateway/src/security/permissions.ts):
 * snapshots the EXACT flag set of each of the 4 presets (minimal/standard/
 * advanced/expert), the check() default-false on unknown keys, and the
 * per-channel sliding-window rate limiter (allow N, block N+1, reset after the
 * window). Characterization: asserts ACTUAL current behavior.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PermissionManager } from '../../gateway/src/security/permissions.js';

/** Read the private permission map without widening the public surface. */
function flagsOf(pm: PermissionManager): Record<string, boolean> {
  return (pm as any).permissions as Record<string, boolean>;
}

describe('PermissionManager presets', () => {
  test('default preset is standard', () => {
    assert.equal(new PermissionManager().preset, 'standard');
  });

  test('minimal preset exact flags', () => {
    assert.deepEqual(flagsOf(new PermissionManager('minimal')), {
      shell: false, shellSandboxed: false,
      browser: false, browserAllowlist: false,
      filesWorkspaceOnly: true, filesHomeDir: false, filesFullAccess: false,
      network: false, selfModify: false, deleteFiles: false,
      exportFiles: true, researchInternet: false,
    });
  });

  test('standard preset exact flags — shell, filesFullAccess, selfModify are OFF', () => {
    const f = flagsOf(new PermissionManager('standard'));
    assert.equal(f.shell, false);
    assert.equal(f.filesFullAccess, false);
    assert.equal(f.selfModify, false);
    assert.deepEqual(f, {
      shell: false, shellSandboxed: true,
      browser: false, browserAllowlist: true,
      filesWorkspaceOnly: true, filesHomeDir: false, filesFullAccess: false,
      network: true, selfModify: false, deleteFiles: false,
      exportFiles: true, researchInternet: true,
    });
  });

  test('advanced preset exact flags', () => {
    assert.deepEqual(flagsOf(new PermissionManager('advanced')), {
      shell: false, shellSandboxed: true,
      browser: true, browserAllowlist: true,
      filesWorkspaceOnly: false, filesHomeDir: true, filesFullAccess: false,
      network: true, selfModify: false, deleteFiles: true,
      exportFiles: true, researchInternet: true,
    });
  });

  test('expert preset exact flags — the only preset with shell + filesFullAccess + selfModify', () => {
    const f = flagsOf(new PermissionManager('expert'));
    assert.equal(f.shell, true);
    assert.equal(f.filesFullAccess, true);
    assert.equal(f.selfModify, true);
    assert.deepEqual(f, {
      shell: true, shellSandboxed: false,
      browser: true, browserAllowlist: false,
      filesWorkspaceOnly: false, filesHomeDir: false, filesFullAccess: true,
      network: true, selfModify: true, deleteFiles: true,
      exportFiles: true, researchInternet: true,
    });
  });
});

describe('PermissionManager.check', () => {
  test('check returns the flag value for a known key', () => {
    const pm = new PermissionManager('standard');
    assert.equal(pm.check('network'), true);
    assert.equal(pm.check('shell'), false);
  });

  test('check on an unknown key returns false (?? false default)', () => {
    const pm = new PermissionManager('standard');
    assert.equal(pm.check('nonsense' as any), false);
  });

  test('mutating the constructor PRESETS source does not bleed across instances (clone)', () => {
    const a = flagsOf(new PermissionManager('standard'));
    a.shell = true;
    assert.equal(new PermissionManager('standard').check('shell'), false);
  });
});

describe('PermissionManager.checkRateLimit', () => {
  test('allows exactly maxPerMinute (30) calls then blocks the 31st', () => {
    const pm = new PermissionManager('standard');
    for (let i = 1; i <= 30; i++) {
      assert.equal(pm.checkRateLimit('telegram'), true, `call ${i} should pass`);
    }
    assert.equal(pm.checkRateLimit('telegram'), false, '31st call should be blocked');
    assert.equal(pm.checkRateLimit('telegram'), false, 'still blocked after limit');
  });

  test('rate limits are per-channel (independent counters)', () => {
    const pm = new PermissionManager('standard');
    for (let i = 0; i < 30; i++) pm.checkRateLimit('telegram');
    assert.equal(pm.checkRateLimit('telegram'), false);
    // A different channel starts fresh.
    assert.equal(pm.checkRateLimit('discord'), true);
  });

  test('resets and allows again once the 60s window has elapsed', () => {
    const pm = new PermissionManager('standard');
    for (let i = 0; i < 30; i++) pm.checkRateLimit('web');
    assert.equal(pm.checkRateLimit('web'), false);

    // Force the stored window into the past, then the next call resets it.
    const entry = (pm as any).rateLimits.get('web');
    entry.resetAt = Date.now() - 1;

    assert.equal(pm.checkRateLimit('web'), true, 'first call after window reset passes');
    // Counter restarted at 1 — 29 more allowed.
    for (let i = 0; i < 29; i++) assert.equal(pm.checkRateLimit('web'), true);
    assert.equal(pm.checkRateLimit('web'), false, 'blocked again after the fresh 30');
  });
});
