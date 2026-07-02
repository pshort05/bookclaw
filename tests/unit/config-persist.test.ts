/**
 * Unit tests for ConfigService override persistence (gateway/src/services/config.ts).
 *
 * Regression: settings changed at runtime (e.g. ai.openrouter.model) were written
 * to config/user.json, which is baked into the Docker image and NOT on a
 * persistent mount — so every image rebuild / container recreate reset the file to
 * its baked copy, reverting the value (observed as "reverts back to gemma").
 *
 * The fix routes runtime overrides to a separate, persistent overrides path (under
 * the workspace bind-mount). These tests pin: writes land in the overrides path and
 * NOT the baked user.json; and a value survives a simulated rebuild where the baked
 * config dir is reset but the overrides file persists.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { ConfigService } from '../../gateway/src/services/config.js';

const DEFAULTS = { ai: { openrouter: { model: 'anthropic/claude-sonnet-4-5' } } };
const BAKED = { ai: { preferredProvider: 'openrouter', openrouter: { model: 'google/gemma-3-4b-it' } } };

describe('ConfigService override persistence', () => {
  let root: string;
  let cfgDir: string;
  let overridesPath: string;

  const writeBaked = () => {
    writeFileSync(join(cfgDir, 'default.json'), JSON.stringify(DEFAULTS), 'utf-8');
    writeFileSync(join(cfgDir, 'user.json'), JSON.stringify(BAKED), 'utf-8');
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'bookclaw-cfg-'));
    cfgDir = join(root, 'config');
    mkdirSync(cfgDir, { recursive: true });
    overridesPath = join(root, 'workspace', '.config', 'config-overrides.json');
    writeBaked();
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  test('setAndPersist writes to the overrides path, not the baked user.json', async () => {
    const c = new ConfigService(cfgDir, overridesPath);
    await c.load();
    assert.equal(c.get('ai.openrouter.model'), 'google/gemma-3-4b-it'); // baked seed active

    await c.setAndPersist('ai.openrouter.model', 'openai/gpt-4o-mini');

    // Override landed in the persistent overrides file...
    assert.ok(existsSync(overridesPath), 'overrides file should be created');
    assert.equal(
      JSON.parse(readFileSync(overridesPath, 'utf-8')).ai.openrouter.model,
      'openai/gpt-4o-mini',
    );
    // ...and the baked user.json is untouched (it is image-baked, not the store of truth).
    assert.equal(
      JSON.parse(readFileSync(join(cfgDir, 'user.json'), 'utf-8')).ai.openrouter.model,
      'google/gemma-3-4b-it',
    );
    assert.equal(c.get('ai.openrouter.model'), 'openai/gpt-4o-mini'); // live value updated
  });

  test('override survives a rebuild that resets the baked config dir', async () => {
    const c1 = new ConfigService(cfgDir, overridesPath);
    await c1.load();
    await c1.setAndPersist('ai.openrouter.model', 'openai/gpt-4o-mini');

    // Simulate a Docker rebuild: baked config dir is recreated from the image
    // (user.json back to gemma); the workspace overrides file persists.
    writeBaked();

    const c2 = new ConfigService(cfgDir, overridesPath);
    await c2.load();
    assert.equal(c2.get('ai.openrouter.model'), 'openai/gpt-4o-mini');
  });
});
