/**
 * Unit tests for the SSRF egress guard in gateway/src/services/research.ts
 * (the 2026-06-12 private-IP-literal rejection).
 *
 * isPrivateIpLiteral is private, so we test through the public isAllowed(url)
 * gate. ResearchGate is constructed with a temp allowlist path + a stub audit
 * (a plain object exposing an async log()) — no real AuditLog/network needed.
 * We deliberately allowlist the host literals so that, if the SSRF guard were
 * absent, isAllowed would return true; the guard must override that to false.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { ResearchGate } from '../../gateway/src/services/research.js';

const stubAudit = { log: async () => {} } as any;

function makeGate(domains: string[]): { gate: ResearchGate; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'bookclaw-research-'));
  const gate = new ResearchGate(join(dir, 'allowlist.json'), stubAudit);
  return { gate, dir };
}

test('private/loopback/link-local IP literals are rejected even when allowlisted', async () => {
  // Allowlist the bare IP literals so a missing guard would otherwise permit them.
  const { gate, dir } = makeGate([
    '127.0.0.1', '10.0.0.5', '192.168.1.1', '169.254.169.254', '172.16.0.1', '::1',
  ]);
  try {
    await gate.setDomains([
      '127.0.0.1', '10.0.0.5', '192.168.1.1', '169.254.169.254', '172.16.0.1', '::1',
    ]);

    assert.equal(gate.isAllowed('http://127.0.0.1/'), false, 'loopback rejected');
    assert.equal(gate.isAllowed('http://10.0.0.5/'), false, '10/8 rejected');
    assert.equal(gate.isAllowed('http://192.168.1.1/'), false, '192.168/16 rejected');
    assert.equal(gate.isAllowed('http://169.254.169.254/'), false, 'cloud-metadata link-local rejected');
    assert.equal(gate.isAllowed('http://172.16.0.1/'), false, '172.16/12 rejected');
    assert.equal(gate.isAllowed('http://[::1]/'), false, 'IPv6 loopback rejected');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a non-private public IP literal is NOT auto-rejected by the SSRF guard', async () => {
  // 8.8.8.8 is public; if it's on the allowlist it should be allowed.
  const { gate, dir } = makeGate(['8.8.8.8']);
  try {
    await gate.setDomains(['8.8.8.8']);
    assert.equal(gate.isAllowed('http://8.8.8.8/'), true, 'public IP literal allowed when allowlisted');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a normal allowlisted public domain is still allowed', async () => {
  const { gate, dir } = makeGate(['en.wikipedia.org']);
  try {
    await gate.setDomains(['en.wikipedia.org']);
    assert.equal(gate.isAllowed('https://en.wikipedia.org/wiki/Foo'), true);
    // www-prefix is stripped on both sides.
    assert.equal(gate.isAllowed('https://www.en.wikipedia.org/wiki/Foo'), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('wildcard parent-domain allowlist still matches a public subdomain', async () => {
  const { gate, dir } = makeGate(['*.google.com']);
  try {
    await gate.setDomains(['*.google.com']);
    assert.equal(gate.isAllowed('https://books.google.com/foo'), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a public domain NOT on the allowlist is rejected (baseline)', async () => {
  const { gate, dir } = makeGate(['en.wikipedia.org']);
  try {
    await gate.setDomains(['en.wikipedia.org']);
    assert.equal(gate.isAllowed('https://evil.example.com/'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a malformed URL is rejected (parse failure → false)', async () => {
  const { gate, dir } = makeGate(['en.wikipedia.org']);
  try {
    await gate.setDomains(['en.wikipedia.org']);
    assert.equal(gate.isAllowed('not a url'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the SSRF guard wins over the allowlist regardless of scheme/port', async () => {
  const { gate, dir } = makeGate(['10.0.0.5']);
  try {
    await gate.setDomains(['10.0.0.5']);
    assert.equal(gate.isAllowed('http://10.0.0.5:8080/admin'), false);
    assert.equal(gate.isAllowed('https://10.0.0.5/secret'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
