/**
 * Unit tests for the four VERIFIED Medium bug #28 fixes in
 * gateway/src/services/orchestrator.ts:
 *
 *  (a) Health-check auto-restart was a guaranteed no-op — an unhealthy but
 *      'running' script called start(), which early-returns while 'running'.
 *      Fixed by restartIfUnhealthy(): stop() THEN start().
 *  (b) The child-process 'error' (spawn failure) handler set state='crashed'
 *      but never emitted 'script-crashed' and never scheduled an auto-restart,
 *      unlike the 'exit' handler. Fixed via the shared scheduleRestartOrCrash().
 *  (c) persistConfig wrote orchestrator.json non-atomically (a crash mid-write
 *      could truncate it). Fixed with writeFileAtomic (temp file + rename).
 *  (d) buildSafeEnv did not strip BOOKCLAW_AUTH_TOKEN, so every spawned user
 *      script inherited the gateway's bearer token. Fixed by adding it (and
 *      BOOKCLAW_MCP_TOKEN) to the sensitiveKeys list.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  buildSafeEnv,
  restartIfUnhealthy,
  writeFileAtomic,
  OrchestratorService,
  type HealthCheckable,
  type ScriptStatus,
} from '../../gateway/src/services/orchestrator.js';

// ── (a) Health-check restart of an unhealthy running script ──

describe('(a) restartIfUnhealthy', () => {
  /** A minimal stateful fake matching the HealthCheckable surface. */
  function makeFake(state: ScriptStatus['state'], healthy: boolean) {
    const calls: string[] = [];
    let curState = state;
    const fake: HealthCheckable = {
      getStatus: () => ({ state: curState } as ScriptStatus),
      isHealthy: () => healthy,
      stop: async () => { calls.push('stop'); curState = 'stopped'; },
      start: () => { calls.push('start'); curState = 'running'; },
    };
    return { fake, calls, get state() { return curState; } };
  }

  test('a running-but-unhealthy script is STOPPED then STARTED', async () => {
    const f = makeFake('running', false);
    const restarted = await restartIfUnhealthy(f.fake);
    assert.equal(restarted, true, 'restart should be performed');
    assert.deepEqual(f.calls, ['stop', 'start'], 'must stop before start (bare start() is a no-op while running)');
    assert.equal(f.state, 'running', 'ends back in running');
  });

  test('a healthy running script is left untouched (no-op preserved)', async () => {
    const f = makeFake('running', true);
    const restarted = await restartIfUnhealthy(f.fake);
    assert.equal(restarted, false);
    assert.deepEqual(f.calls, [], 'no stop/start on a healthy script');
  });

  test('a stopped script is not restarted even if reported unhealthy', async () => {
    const f = makeFake('stopped', false);
    const restarted = await restartIfUnhealthy(f.fake);
    assert.equal(restarted, false);
    assert.deepEqual(f.calls, []);
  });
});

// ── (b) Spawn 'error' path emits script-crashed and honors autoRestart ──

describe('(b) spawn error emits script-crashed + honors autoRestart', () => {
  // A command that does not exist triggers the child_process 'error' (ENOENT)
  // path on POSIX with shell:false — exactly the branch that used to be silent.
  const MISSING = 'bookclaw-nonexistent-binary-xyz-123';
  let root: string;
  let orch: OrchestratorService;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'bookclaw-orch-b-'));
    orch = new OrchestratorService(root);
    await orch.initialize();
  });

  afterEach(async () => {
    await orch.shutdown(); // clears persist + any pending restart timers, flushes persist
    rmSync(root, { recursive: true, force: true });
  });

  test('a spawn failure emits a script-crashed event (no autoRestart)', async () => {
    // addScript() debounces persistence (2s) — don't await it; the script is
    // registered synchronously and shutdown() flushes the pending persist.
    void orch.addScript({ id: 's1', name: 's1', command: MISSING, autoRestart: false, maxRestarts: 0 });

    const crashed = new Promise<any>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('script-crashed never fired')), 4000);
      orch.once('script-crashed', (e) => { clearTimeout(t); resolve(e); });
    });

    orch.startScript('s1');
    const evt = await crashed;
    assert.equal(evt.id, 's1');
    assert.ok(evt.error, 'crash carries an error message');
    assert.equal(orch.getStatus('s1')[0].state, 'crashed', 'no autoRestart → crashed');
  });

  test('with autoRestart, a spawn failure schedules a restart (state=restarting, count incremented)', async () => {
    // Large restartDelayMs so the retry stays pending (we assert scheduling, not the retry firing).
    void orch.addScript({
      id: 's2', name: 's2', command: MISSING,
      autoRestart: true, maxRestarts: 3, restartDelayMs: 60000,
    });

    const crashed = new Promise<any>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('script-crashed never fired')), 4000);
      orch.once('script-crashed', (e) => { clearTimeout(t); resolve(e); });
    });

    orch.startScript('s2');
    const evt = await crashed;
    assert.equal(evt.restartCount, 1, 'restart counter advanced');
    assert.equal(orch.getStatus('s2')[0].state, 'restarting', 'auto-restart scheduled');

    await orch.stopScript('s2'); // clears the pending restart timer
  });
});

// ── (c) Atomic persistence ──

describe('(c) atomic orchestrator.json persistence', () => {
  let root: string;

  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'bookclaw-orch-c-')); });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  test('writeFileAtomic writes the target and leaves no .tmp remnant', async () => {
    const target = join(root, 'orchestrator.json');
    await writeFileAtomic(target, 'v1');
    assert.equal(readFileSync(target, 'utf-8'), 'v1');
    assert.equal(existsSync(`${target}.tmp`), false, 'temp file renamed away, not left behind');

    // Overwrite replaces atomically and still leaves no remnant.
    await writeFileAtomic(target, 'v2-longer-content');
    assert.equal(readFileSync(target, 'utf-8'), 'v2-longer-content');
    assert.equal(existsSync(`${target}.tmp`), false);
  });

  test('persistConfig produces a complete, valid orchestrator.json (via shutdown flush)', async () => {
    const orch = new OrchestratorService(root);
    await orch.initialize();
    void orch.addScript({ id: 'p1', name: 'p1', command: 'true' });
    await orch.shutdown(); // flushes the debounced persist through writeFileAtomic

    const path = join(root, 'orchestrator.json');
    assert.ok(existsSync(path), 'orchestrator.json written');
    assert.equal(existsSync(`${path}.tmp`), false, 'no leftover temp file');
    const parsed = JSON.parse(readFileSync(path, 'utf-8')); // must be complete, non-truncated JSON
    assert.equal(parsed.scripts[0].id, 'p1');
  });
});

// ── (d) buildSafeEnv strips the gateway auth tokens ──

describe('(d) buildSafeEnv strips BOOKCLAW_AUTH_TOKEN / BOOKCLAW_MCP_TOKEN', () => {
  const saved: Record<string, string | undefined> = {};
  const keys = ['BOOKCLAW_AUTH_TOKEN', 'BOOKCLAW_MCP_TOKEN', 'OPENAI_API_KEY'];

  beforeEach(() => {
    for (const k of keys) saved[k] = process.env[k];
    process.env.BOOKCLAW_AUTH_TOKEN = 'secret-bearer';
    process.env.BOOKCLAW_MCP_TOKEN = 'secret-mcp';
    process.env.OPENAI_API_KEY = 'secret-openai';
  });

  afterEach(() => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  test('the returned env omits the gateway bearer + MCP tokens (and provider keys)', () => {
    const env = buildSafeEnv();
    assert.equal(env.BOOKCLAW_AUTH_TOKEN, undefined, 'bearer token must not leak to user scripts');
    assert.equal(env.BOOKCLAW_MCP_TOKEN, undefined, 'MCP token must not leak to user scripts');
    assert.equal(env.OPENAI_API_KEY, undefined, 'provider keys still stripped');
    assert.ok(env.PATH !== undefined, 'benign vars still pass through');
  });

  test('explicit extra env still merges after stripping', () => {
    const env = buildSafeEnv({ MY_SCRIPT_VAR: 'hello' });
    assert.equal(env.MY_SCRIPT_VAR, 'hello');
    assert.equal(env.BOOKCLAW_AUTH_TOKEN, undefined);
  });
});
