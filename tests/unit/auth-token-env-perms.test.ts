/**
 * Unit tests for persistAuthToken (gateway/src/init/phase-02-security.ts).
 *
 * The auth token grants full API access, so the .env file it lands in must be
 * 0600 — not the 0644 that appendFile creates a fresh file at. Covers both the
 * create-fresh path and the tighten-an-existing-loose-file path. The perm
 * assertions are guarded by platform === 'win32' since chmod is a no-op there.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync, writeFileSync, chmodSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { persistAuthToken } from '../../gateway/src/init/phase-02-security.js';

const TOKEN = 'deadbeef'.repeat(8); // 64 hex chars, like randomBytes(32)

describe('persistAuthToken', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bc-auth-env-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('creates a fresh .env at 0600 and writes the token', async () => {
    const envPath = join(dir, '.env');
    await persistAuthToken(envPath, TOKEN);
    const contents = readFileSync(envPath, 'utf-8');
    assert.ok(contents.includes(`BOOKCLAW_AUTH_TOKEN=${TOKEN}`), 'token not written to .env');
    if (process.platform !== 'win32') {
      assert.equal(statSync(envPath).mode & 0o777, 0o600, '.env must be 0600');
    }
  });

  test('tightens an existing world-readable .env to 0600', async () => {
    const envPath = join(dir, '.env');
    writeFileSync(envPath, 'BOOKCLAW_VAULT_KEY=preexisting\n');
    chmodSync(envPath, 0o644);
    await persistAuthToken(envPath, TOKEN);
    const contents = readFileSync(envPath, 'utf-8');
    assert.ok(contents.includes('BOOKCLAW_VAULT_KEY=preexisting'), 'appended, not overwrote');
    assert.ok(contents.includes(`BOOKCLAW_AUTH_TOKEN=${TOKEN}`), 'token not appended');
    if (process.platform !== 'win32') {
      assert.equal(statSync(envPath).mode & 0o777, 0o600, '.env must be tightened to 0600');
    }
  });
});
