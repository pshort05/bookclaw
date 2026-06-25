import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReportsService, REPORT_KEEP } from '../../gateway/src/services/reports.js';

function svc() {
  const root = mkdtempSync(join(tmpdir(), 'reports-'));
  const dataDir = join(root, 'data');
  mkdirSync(dataDir, { recursive: true });
  const s = new ReportsService({ dataDirOf: (slug) => (slug === 'b1' ? dataDir : null) });
  return { s, root, reportsDir: join(dataDir, 'reports') };
}

test('write creates .md + .json + index entry; list returns it', () => {
  const { s, root, reportsDir } = svc();
  try {
    const r = s.write('b1', 'consistency', { title: 'Consistency', markdown: '# C', json: { findings: [] }, summary: '0 findings' }, '20260625T010000Z');
    assert.deepEqual(r, { id: 'consistency-20260625T010000Z' });
    assert.ok(existsSync(join(reportsDir, 'consistency-20260625T010000Z.md')));
    assert.ok(existsSync(join(reportsDir, 'consistency-20260625T010000Z.json')));
    const list = s.list('b1');
    assert.equal(list.length, 1);
    assert.equal(list[0].kind, 'consistency');
    assert.equal(list[0].summary, '0 findings');
    assert.deepEqual(list[0].formats.slice().sort(), ['json', 'md']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('prune keeps newest REPORT_KEEP per kind', () => {
  const { s, root, reportsDir } = svc();
  try {
    for (let i = 0; i < REPORT_KEEP + 4; i++) {
      const stamp = `202606${String(10 + i).padStart(2, '0')}T010000Z`;
      s.write('b1', 'consistency', { title: 'C', markdown: 'x', json: {} }, stamp);
    }
    s.write('b1', 'beta-reader', { title: 'B', markdown: 'y', json: {} }, '20260625T020000Z');
    const cons = s.list('b1').filter((m) => m.kind === 'consistency');
    assert.equal(cons.length, REPORT_KEEP);
    const mdFiles = readdirSync(reportsDir).filter((f) => f.startsWith('consistency-') && f.endsWith('.md'));
    assert.equal(mdFiles.length, REPORT_KEEP);
    assert.ok(s.list('b1').some((m) => m.kind === 'beta-reader'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('resolvePath guards traversal + bad format; null for missing', () => {
  const { s, root } = svc();
  try {
    s.write('b1', 'consistency', { title: 'C', markdown: 'x', json: {} }, '20260625T010000Z');
    assert.ok(s.resolvePath('b1', 'consistency-20260625T010000Z', 'md'));
    assert.equal(s.resolvePath('b1', '../../etc/passwd', 'md'), null);
    assert.equal(s.resolvePath('b1', 'consistency-20260625T010000Z', 'txt' as any), null);
    assert.equal(s.resolvePath('b1', 'nope-20260625T010000Z', 'json'), null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('list reconstructs from filenames when index.json is missing', () => {
  const { s, root, reportsDir } = svc();
  try {
    s.write('b1', 'consistency', { title: 'C', markdown: 'x', json: {} }, '20260625T010000Z');
    rmSync(join(reportsDir, 'index.json'), { force: true });
    const list = s.list('b1');
    assert.equal(list.length, 1);
    assert.equal(list[0].id, 'consistency-20260625T010000Z');
    assert.equal(list[0].kind, 'consistency');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
