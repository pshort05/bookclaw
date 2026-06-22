import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWorldJson, parseWorldDoc, serializeWorldDoc, nextClassification } from '../../gateway/src/services/world-parse.js';

const VALID = JSON.stringify({
  schemaVersion: 1,
  name: 'shattered-cradle',
  label: 'The Shattered Cradle',
  description: 'Earth, three million years on.',
  documentTypes: [{ id: 'field-guide', label: 'Field Guide', note: 'practical' }],
  domains: ['GEO', 'MAG'],
  clearanceLevels: ['General Access', 'Restricted'],
  classificationScheme: '{TYPE}-{DOMAIN}-{NNNN}',
  formatDirective: 'Narrative prose only.',
  authoringEditor: 'luminarch-adept',
});

test('parseWorldJson accepts a valid config', () => {
  const w = parseWorldJson(VALID);
  assert.equal(w.name, 'shattered-cradle');
  assert.equal(w.schemaVersion, 1);
  assert.equal(w.documentTypes[0].id, 'field-guide');
  assert.deepEqual(w.domains, ['GEO', 'MAG']);
  assert.equal(w.classificationScheme, '{TYPE}-{DOMAIN}-{NNNN}');
  assert.equal(w.authoringEditor, 'luminarch-adept');
});

test('parseWorldJson throws on invalid JSON', () => {
  assert.throws(() => parseWorldJson('{ not json'), /valid JSON/);
});

test('parseWorldJson throws when documentTypes is missing', () => {
  const bad = JSON.stringify({ schemaVersion: 1, name: 'x', domains: ['GEO'], clearanceLevels: ['a'], classificationScheme: 's', formatDirective: 'd' });
  assert.throws(() => parseWorldJson(bad), /documentTypes/);
});

test('parseWorldJson throws when a documentType lacks id/label', () => {
  const bad = JSON.stringify({ schemaVersion: 1, name: 'x', documentTypes: [{ label: 'No id' }], domains: ['GEO'], clearanceLevels: ['a'], classificationScheme: 's', formatDirective: 'd' });
  assert.throws(() => parseWorldJson(bad), /documentType/);
});

test('parseWorldJson throws when schemaVersion is non-numeric', () => {
  const bad = JSON.stringify({ schemaVersion: 'one', name: 'x', documentTypes: [{ id: 'a', label: 'A' }], domains: ['GEO'], clearanceLevels: ['a'], classificationScheme: 's', formatDirective: 'd' });
  assert.throws(() => parseWorldJson(bad), /schemaVersion/);
});

const DOC = [
  '---',
  'title: The Geography of the Shattered Cradle',
  'type: field-guide',
  'classification: FG-GEO-0141',
  'clearance: General Access',
  'domain: GEO',
  'attribution: Compiled by Talen Windwalker',
  'tags: [geography, supercontinent, travel]',
  'summary: A traveler\'s guide to the transformed world.',
  'appendixEligible: true',
  '---',
  '',
  '### FIELD GUIDE',
  'Narrative prose body.',
  '',
].join('\n');

test('parseWorldDoc reads scalar fields and an inline tags array', () => {
  const { meta, body } = parseWorldDoc(DOC);
  assert.equal(meta.title, 'The Geography of the Shattered Cradle');
  assert.equal(meta.type, 'field-guide');
  assert.equal(meta.classification, 'FG-GEO-0141');
  assert.equal(meta.clearance, 'General Access');
  assert.equal(meta.domain, 'GEO');
  assert.equal(meta.attribution, 'Compiled by Talen Windwalker');
  assert.deepEqual(meta.tags, ['geography', 'supercontinent', 'travel']);
  assert.equal(meta.summary, "A traveler's guide to the transformed world.");
  assert.equal(meta.appendixEligible, true);
  assert.equal(body, '### FIELD GUIDE\nNarrative prose body.');
});

test('parseWorldDoc throws on missing frontmatter', () => {
  assert.throws(() => parseWorldDoc('no fence here\nbody'), /frontmatter/);
});

test('parseWorldDoc throws when a required field is missing', () => {
  const bad = ['---', 'type: field-guide', 'domain: GEO', '---', 'body'].join('\n');
  assert.throws(() => parseWorldDoc(bad), /title/);
});

test('serializeWorldDoc round-trips parseWorldDoc', () => {
  const { meta, body } = parseWorldDoc(DOC);
  const reparsed = parseWorldDoc(serializeWorldDoc(meta, body));
  assert.deepEqual(reparsed.meta, meta);
  assert.equal(reparsed.body, body);
});

test('serializeWorldDoc omits empty optional fields and round-trips minimal docs', () => {
  const meta = { title: 'T', type: 'codex', classification: 'CN-MAG-0001', clearance: 'Restricted', domain: 'MAG', tags: [], summary: 'S' };
  const out = serializeWorldDoc(meta, 'Body.');
  assert.ok(!out.includes('attribution:'), 'no attribution line when omitted');
  assert.ok(!out.includes('appendixEligible:'), 'no appendixEligible line when omitted');
  const reparsed = parseWorldDoc(out);
  assert.deepEqual(reparsed.meta, meta);
  assert.equal(reparsed.body, 'Body.');
});

test('nextClassification picks the next free serial', () => {
  const code = nextClassification('{TYPE}-{DOMAIN}-{NNNN}', 'field-guide', 'GEO', ['FG-GEO-0141']);
  assert.equal(code, 'FG-GEO-0142');
});

test('nextClassification starts at 0001 when none exist', () => {
  assert.equal(nextClassification('{TYPE}-{DOMAIN}-{NNNN}', 'codex', 'MAG', []), 'CO-MAG-0001');
});

test('nextClassification assigns max+1, never reusing a gap', () => {
  const existing = ['FG-GEO-0001', 'FG-GEO-0003'];
  assert.equal(nextClassification('{TYPE}-{DOMAIN}-{NNNN}', 'field-guide', 'GEO', existing), 'FG-GEO-0004');
});

test('nextClassification ignores serials of a different TYPE-DOMAIN pair', () => {
  const existing = ['CO-MAG-0001', 'FG-GEO-0001'];
  assert.equal(nextClassification('{TYPE}-{DOMAIN}-{NNNN}', 'field-guide', 'GEO', existing), 'FG-GEO-0002');
});

test('nextClassification zero-pads to 4 digits', () => {
  assert.equal(nextClassification('{TYPE}-{DOMAIN}-{NNNN}', 'codex', 'MAG', ['CO-MAG-0009']), 'CO-MAG-0010');
});
