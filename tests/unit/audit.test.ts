/**
 * Unit tests for AuditLog (gateway/src/security/audit.ts): tamper-resistant JSONL
 * logging with a per-line hash chain. Covers: entries written as JSONL to the
 * day's file; the hash chain links (each entry's previousHash == the prior
 * entry's hash); and seed-from-last-line on init (a fresh AuditLog over the same
 * dir continues the chain from the last persisted hash, not the '0' genesis).
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { AuditLog } from '../../gateway/src/security/audit.js';

const dayFile = (dir: string) =>
  join(dir, `${new Date().toISOString().split('T')[0]}.jsonl`);

function readEntries(dir: string): any[] {
  return readFileSync(dayFile(dir), 'utf-8')
    .trimEnd()
    .split('\n')
    .map((l) => JSON.parse(l));
}

describe('AuditLog', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bc-audit-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('a logged entry is written as JSONL to the day file with the expected fields', async () => {
    const a = new AuditLog(dir);
    await a.initialize();
    await a.log('security', 'login', { user: 'paul' });
    assert.ok(existsSync(dayFile(dir)));
    const [entry] = readEntries(dir);
    assert.equal(entry.category, 'security');
    assert.equal(entry.action, 'login');
    assert.deepEqual(entry.data, { user: 'paul' });
    assert.ok(typeof entry.timestamp === 'string');
    assert.ok(typeof entry.hash === 'string' && entry.hash.length > 0);
    assert.equal(entry.previousHash, '0'); // genesis
  });

  test('multiple entries are appended as separate JSONL lines', async () => {
    const a = new AuditLog(dir);
    await a.initialize();
    await a.log('c', 'one', {});
    await a.log('c', 'two', {});
    await a.log('c', 'three', {});
    const entries = readEntries(dir);
    assert.equal(entries.length, 3);
    assert.deepEqual(entries.map((e) => e.action), ['one', 'two', 'three']);
  });

  test('the hash chain links: each previousHash equals the prior entry hash', async () => {
    const a = new AuditLog(dir);
    await a.initialize();
    await a.log('c', 'one', {});
    await a.log('c', 'two', {});
    await a.log('c', 'three', {});
    const [e1, e2, e3] = readEntries(dir);
    assert.equal(e1.previousHash, '0');
    assert.equal(e2.previousHash, e1.hash);
    assert.equal(e3.previousHash, e2.hash);
    // Hashes are distinct (chain advances with each entry).
    assert.notEqual(e1.hash, e2.hash);
    assert.notEqual(e2.hash, e3.hash);
  });

  test('the recorded hash matches sha256(entry-without-hash) truncated to 16 hex', async () => {
    const { createHash } = await import('crypto');
    const a = new AuditLog(dir);
    await a.initialize();
    await a.log('c', 'verify', { n: 1 });
    const [e] = readEntries(dir);
    const { hash, ...rest } = e;
    const expected = createHash('sha256').update(JSON.stringify(rest)).digest('hex').substring(0, 16);
    assert.equal(hash, expected);
  });

  test('seed-from-last-line on init: a new AuditLog continues the chain, not genesis', async () => {
    const first = new AuditLog(dir);
    await first.initialize();
    await first.log('c', 'before-restart-1', {});
    await first.log('c', 'before-restart-2', {});
    const persisted = readEntries(dir);
    const lastHash = persisted[persisted.length - 1].hash;

    // Simulate a restart: brand-new instance over the same dir.
    const second = new AuditLog(dir);
    await second.initialize();
    await second.log('c', 'after-restart', {});

    const all = readEntries(dir);
    const afterEntry = all.find((e) => e.action === 'after-restart');
    assert.ok(afterEntry);
    assert.notEqual(afterEntry.previousHash, '0', 'must not reset to genesis on restart');
    assert.equal(afterEntry.previousHash, lastHash, 'must continue from the last persisted hash');
  });

  test('init on an empty dir starts the chain at the genesis hash', async () => {
    const a = new AuditLog(dir);
    await a.initialize(); // no prior file
    await a.log('c', 'first-ever', {});
    const [e] = readEntries(dir);
    assert.equal(e.previousHash, '0');
  });

  test('init is fail-soft on a corrupt last line (falls back to genesis)', async () => {
    const { appendFile } = await import('fs/promises');
    await appendFile(dayFile(dir), 'not-json-at-all\n');
    const a = new AuditLog(dir);
    await a.initialize(); // corrupt last line must not throw
    await a.log('c', 'after-corrupt', {});
    // Parse only the valid JSONL lines — the file deliberately has a bad first line.
    const parsed = readFileSync(dayFile(dir), 'utf-8')
      .trimEnd()
      .split('\n')
      .map((l) => { try { return JSON.parse(l); } catch { return null; } });
    const afterEntry = parsed.find((e) => e?.action === 'after-corrupt');
    assert.ok(afterEntry);
    assert.equal(afterEntry.previousHash, '0'); // could not parse a prior hash → genesis
  });
});
