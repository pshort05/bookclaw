/**
 * Tests for Flagship Plan 6, Task 5: live-sync of maxConcurrentDrives and the
 * provider throttle on POST /api/config/update, mirroring the pre-existing
 * costs.dailyLimit live-sync pattern (bug-review #16) in settings.routes.ts.
 * Driven through the REAL route (mountSettings) with a real DriveScheduler,
 * not a unit test of the scheduler/router methods in isolation.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { AddressInfo } from 'net';
import { ProjectEngine } from '../../gateway/src/services/projects.js';
import { DriveScheduler } from '../../gateway/src/services/pipeline/scheduler.js';
import { mountSettings } from '../../gateway/src/api/routes/settings.routes.js';

/** A minimal in-memory config store implementing the .get/.setAndPersist surface settings.routes.ts uses. */
function fakeConfig(initial: Record<string, any> = {}) {
  const store: Record<string, any> = { ...initial };
  return {
    store,
    get(path: string, def?: any) {
      return path in store ? store[path] : def;
    },
    async setAndPersist(path: string, value: any) {
      store[path] = value;
    },
  };
}

function makeHarness() {
  const baseDir = mkdtempSync(join(tmpdir(), 'settings-pipeline-'));
  const engine = new ProjectEngine(undefined, baseDir);
  const scheduler = new DriveScheduler(engine, 3);
  const throttleCalls: Array<Record<string, number>> = [];
  const config = fakeConfig({ 'pipeline.maxConcurrentDrives': 3, 'pipeline.providerThrottle': { default: 2 } });
  const gateway: any = {
    getServices: () => ({
      config,
      driveScheduler: scheduler,
      aiRouter: { setThrottleLimits: (limits: Record<string, number>) => throttleCalls.push(limits) },
      vault: { list: async () => [] },
      audit: { log: async () => {} },
    }),
  };
  const app = express();
  app.use(express.json());
  mountSettings(app as any, gateway, baseDir);
  const server = app.listen(0);
  return { server, scheduler, config, throttleCalls };
}

async function urlOf(server: import('http').Server): Promise<string> {
  await new Promise<void>((r) => server.once('listening', () => r()));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

test('POSTing pipeline.maxConcurrentDrives updates the live scheduler without a restart', async () => {
  const { server, scheduler } = makeHarness();
  const url = await urlOf(server);
  try {
    // Fill the current 3-slot cap so the effect of raising it is observable.
    await scheduler.acquire('a'); await scheduler.acquire('b'); await scheduler.acquire('c');
    let dResolved = false;
    const dPromise = scheduler.acquire('d').then((v) => { dResolved = true; return v; });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(dResolved, false, 'queued before the config change');

    const res = await fetch(`${url}/api/config/update`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'pipeline.maxConcurrentDrives', value: 4 }),
    });
    assert.equal(res.status, 200);

    const d = await dPromise;
    assert.equal(d, true, 'raising the cap live drained the queued project immediately — no restart needed');
    assert.equal(dResolved, true);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test('pipeline.maxConcurrentDrives rejects a non-positive-integer value', async () => {
  const { server } = makeHarness();
  const url = await urlOf(server);
  try {
    for (const bad of [0, -1, 1.5, 'three', null]) {
      const res = await fetch(`${url}/api/config/update`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'pipeline.maxConcurrentDrives', value: bad }),
      });
      assert.equal(res.status, 400, `expected 400 for value ${JSON.stringify(bad)}`);
    }
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test('POSTing pipeline.providerThrottle live-syncs the AIRouter throttle', async () => {
  const { server, throttleCalls } = makeHarness();
  const url = await urlOf(server);
  try {
    const res = await fetch(`${url}/api/config/update`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'pipeline.providerThrottle', value: { grok: 1, default: 3 } }),
    });
    assert.equal(res.status, 200);
    assert.deepEqual(throttleCalls, [{ grok: 1, default: 3 }]);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test('pipeline.providerThrottle rejects a non-object / non-positive-integer-valued value', async () => {
  const { server } = makeHarness();
  const url = await urlOf(server);
  try {
    for (const bad of ['nope', 5, null, { grok: 0 }, { grok: -1 }, { grok: 1.5 }, { grok: 'a lot' }]) {
      const res = await fetch(`${url}/api/config/update`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'pipeline.providerThrottle', value: bad }),
      });
      assert.equal(res.status, 400, `expected 400 for value ${JSON.stringify(bad)}`);
    }
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
