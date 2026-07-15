import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { canonDriftAudit, canonAuditAnchorBlock } from '../../gateway/src/services/canon-drift.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const ANCHOR = `Set in Surf City. The main road is Long Beach Boulevard.`;

test('merges deterministic entity edits with LLM edits (union)', () => {
  const doc = 'They met on the Bay Haven boardwalk nine years ago.';
  const llm = '[{"op":"rewrite","find":"nine years ago","instruction":"they met this June per the nine-week timeline","reason":"timeline"}]';
  const r = canonDriftAudit(doc, [ANCHOR], llm);
  const finds = r.edits.map(e => e.find).sort();
  assert.deepEqual(finds, ['Bay Haven boardwalk', 'nine years ago']);
});

test('dedupes by find — the deterministic entity edit wins over an LLM edit on the same span', () => {
  const doc = 'They walked the Bay Haven boardwalk.';
  const llm = '[{"op":"swap","find":"Bay Haven boardwalk","replace":"Surf City pier","reason":"guess"}]';
  const r = canonDriftAudit(doc, [ANCHOR], llm);
  const bh = r.edits.filter(e => e.find === 'Bay Haven boardwalk');
  assert.equal(bh.length, 1);
  assert.equal(bh[0].replace, 'Long Beach Boulevard'); // entity edit, not the LLM guess
});

test('ambiguous conflict surfaces in .ambiguous, NOT as an edit', () => {
  const anchor = 'Set in Surf City and neighboring Beach Haven.'; // two towns
  const doc = 'They drove to Cedar Cove for the weekend.';        // unknown town, 2 candidates
  const r = canonDriftAudit(doc, [anchor], '[]');
  assert.equal(r.edits.length, 0);
  assert.equal(r.ambiguous.length, 1);
  assert.equal(r.ambiguous[0].phrase, 'Cedar Cove');
});

test('a place repeated with identical whitespace yields one edit PER occurrence (not collapsed)', () => {
  // Both mentions of the invented town must be swapped; dedupe-by-find would drop
  // the second edit and leave the second "Bay Haven" un-reconciled.
  const doc = 'Bay Haven was home. She always came back to Bay Haven.';
  const r = canonDriftAudit(doc, [ANCHOR], '[]');
  const bh = r.edits.filter(e => e.find === 'Bay Haven');
  assert.equal(bh.length, 2, 'one entity edit per occurrence');
});

test('garbage LLM output degrades to entity edits only (fail-soft)', () => {
  const doc = 'They walked the Bay Haven boardwalk.';
  const r = canonDriftAudit(doc, [ANCHOR], 'not json at all');
  assert.equal(r.edits.length, 1);
  assert.equal(r.edits[0].find, 'Bay Haven boardwalk');
});

test('#5: canonAuditAnchorBlock injects verified-canon.md ONLY for a canon-audit step, fail-soft otherwise', async () => {
  const root = mkdtempSync(join(tmpdir(), 'canon-anchor-'));
  try {
    const dataDir = join(root, 'data');
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, 'verified-canon.md'), '# Verified Canon\n\nSurf City on LBI; Long Beach Boulevard.', 'utf-8');
    const dataDirOf = (_slug: string) => dataDir;

    // A canon-audit step gets the anchor text in its context block.
    const block = await canonAuditAnchorBlock('romance-canon-audit', 'my-book', dataDirOf);
    assert.match(block, /Verified Canon Anchor/);
    assert.match(block, /Long Beach Boulevard/);

    // A non-audit step gets nothing (no accidental injection into generation steps).
    assert.equal(await canonAuditAnchorBlock('book-bible', 'my-book', dataDirOf), '');
    // Missing slug / resolver / file → '' (fail-soft, never throws).
    assert.equal(await canonAuditAnchorBlock('romance-canon-audit', undefined, dataDirOf), '');
    assert.equal(await canonAuditAnchorBlock('romance-canon-audit', 'my-book', () => null), '');
    assert.equal(await canonAuditAnchorBlock('romance-canon-audit', 'no-such', () => join(root, 'missing')), '');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('romance-canon-audit skill exists with the expected frontmatter name', () => {
  const md = readFileSync(join(ROOT, 'skills', 'author', 'romance-canon-audit', 'SKILL.md'), 'utf8');
  assert.match(md, /^name:\s*romance-canon-audit$/m);
  assert.match(md, /JSON/); // instructs edit-list output
});
