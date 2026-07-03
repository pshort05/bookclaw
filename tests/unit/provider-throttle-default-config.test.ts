/**
 * M4 fix (Flagship Plan 6 code review): the global ProviderThrottle wraps
 * EVERY AIRouter.complete() call, including interactive chat — with the
 * shipped default of 2 in-flight calls per provider, 3 books saturating a
 * provider queues a chat message behind book generation. Bumped to 6 so
 * normal multi-book + interactive use isn't serialized; the throttle itself
 * (the storm guard) is unchanged.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(fileURLToPath(import.meta.url), '..', '..', '..');

test('config/default.json ships pipeline.providerThrottle.default >= 6', () => {
  const raw = readFileSync(join(REPO_ROOT, 'config', 'default.json'), 'utf-8');
  const config = JSON.parse(raw);
  assert.ok(config.pipeline?.providerThrottle?.default >= 6, `expected >= 6, got ${config.pipeline?.providerThrottle?.default}`);
});
