/**
 * Unit tests for Vault (gateway/src/security/vault.ts): AES-256-GCM credential
 * store. Covers set/get round-trip, missing key, delete, list, encryption-at-rest
 * (plaintext absent from vault.enc), wrong-key non-leak, and GCM tamper detection.
 *
 * The master key comes from process.env.BOOKCLAW_VAULT_KEY; we set a known key
 * per test and restore the original in `after`.
 */
import { test, describe, beforeEach, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Vault } from '../../gateway/src/security/vault.js';

const KEY_A = 'a'.repeat(64); // 32 bytes hex
const KEY_B = 'b'.repeat(64); // a different 32-byte hex key

describe('Vault', () => {
  let dir: string;
  const originalKey = process.env.BOOKCLAW_VAULT_KEY;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bc-vault-'));
    process.env.BOOKCLAW_VAULT_KEY = KEY_A;
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  after(() => {
    if (originalKey === undefined) delete process.env.BOOKCLAW_VAULT_KEY;
    else process.env.BOOKCLAW_VAULT_KEY = originalKey;
  });

  async function newVault(): Promise<Vault> {
    const v = new Vault(dir);
    await v.initialize();
    return v;
  }

  test('set then get round-trips a value', async () => {
    const v = await newVault();
    await v.set('openai', 'sk-secret-value');
    assert.equal(await v.get('openai'), 'sk-secret-value');
  });

  test('get of a missing key returns null', async () => {
    const v = await newVault();
    assert.equal(await v.get('does-not-exist'), null);
  });

  test('delete removes a key (and returns false for an absent one)', async () => {
    const v = await newVault();
    await v.set('gemini', 'g-key');
    assert.equal(await v.delete('gemini'), true);
    assert.equal(await v.get('gemini'), null);
    assert.equal(await v.delete('gemini'), false);
  });

  test('list returns all stored keys', async () => {
    const v = await newVault();
    await v.set('one', '1');
    await v.set('two', '2');
    assert.deepEqual((await v.list()).sort(), ['one', 'two']);
  });

  test('encryption-at-rest: plaintext is absent from vault.enc (ciphertext only)', async () => {
    const v = await newVault();
    const secret = 'PLAINTEXT-SHOULD-NOT-APPEAR';
    await v.set('cred', secret);
    const onDisk = readFileSync(join(dir, 'vault.enc'), 'utf-8');
    assert.ok(!onDisk.includes(secret), 'plaintext leaked into vault.enc');
    // The structure is JSON with hex ciphertext/iv/tag, not the cleartext value.
    const parsed = JSON.parse(onDisk);
    assert.ok(parsed.entries.cred.ciphertext);
    assert.ok(parsed.entries.cred.iv);
    assert.ok(parsed.entries.cred.tag);
  });

  test('survives a re-open with the same key (data persists across instances)', async () => {
    const v1 = await newVault();
    await v1.set('persisted', 'still-here');
    const v2 = await newVault(); // re-reads vault.enc, re-derives the same key
    assert.equal(await v2.get('persisted'), 'still-here');
  });

  test('wrong key fails closed: get returns null rather than leaking plaintext', async () => {
    const v1 = await newVault();
    await v1.set('cred', 'real-secret');
    // Re-open the same file with a DIFFERENT master key.
    process.env.BOOKCLAW_VAULT_KEY = KEY_B;
    const v2 = await newVault();
    const got = await v2.get('cred');
    assert.equal(got, null, 'wrong key must not decrypt; expected null');
    assert.notEqual(got, 'real-secret');
  });

  test('GCM tamper detection: corrupting the ciphertext makes get return null', async () => {
    const v1 = await newVault();
    await v1.set('cred', 'integrity-protected');
    const filePath = join(dir, 'vault.enc');
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8'));
    // Flip one hex char of the ciphertext (deterministically to a different value).
    const ct = parsed.entries.cred.ciphertext as string;
    const first = ct[0];
    const flipped = first === '0' ? '1' : '0';
    parsed.entries.cred.ciphertext = flipped + ct.slice(1);
    writeFileSync(filePath, JSON.stringify(parsed, null, 2));
    // Re-open with the CORRECT key — only the data is corrupt.
    const v2 = await newVault();
    const got = await v2.get('cred');
    assert.equal(got, null, 'tampered ciphertext must fail the GCM auth tag, not return garbage');
    assert.notEqual(got, 'integrity-protected');
  });

  test('non-JSON vault.enc is quarantined and a fresh vault starts (no boot crash)', async () => {
    const filePath = join(dir, 'vault.enc');
    writeFileSync(filePath, 'this is not json{{');
    const v = new Vault(dir);
    await assert.doesNotReject(v.initialize());
    // The corrupt file is preserved under a quarantine sibling, not overwritten.
    const quarantined = readdirSync(dir).filter((f) => f.startsWith('vault.enc.corrupt-'));
    assert.equal(quarantined.length, 1, 'expected exactly one quarantined vault file');
    // A fresh vault is usable and round-trips.
    await v.set('openai', 'sk-fresh');
    assert.equal(await v.get('openai'), 'sk-fresh');
  });

  test('valid JSON missing salt is quarantined and a fresh vault starts', async () => {
    const filePath = join(dir, 'vault.enc');
    writeFileSync(filePath, JSON.stringify({ entries: {} }));
    const v = new Vault(dir);
    await assert.doesNotReject(v.initialize());
    const quarantined = readdirSync(dir).filter((f) => f.startsWith('vault.enc.corrupt-'));
    assert.equal(quarantined.length, 1, 'expected exactly one quarantined vault file');
    await v.set('gemini', 'g-fresh');
    assert.equal(await v.get('gemini'), 'g-fresh');
  });
});
