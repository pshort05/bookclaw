import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DisclosuresService } from '../../gateway/src/services/disclosures.ts';

const svc = new DisclosuresService();

test('banned scope (scraped_quotes) => passed:false + mustReject populated', () => {
  const r = svc.checkCompliance({
    platform: 'Any',
    scopes: ['scraped_quotes'],
    acknowledgedScopes: ['scraped_quotes'], // ack does NOT clear a ban
  });
  assert.equal(r.passed, false);
  assert.equal(r.mustReject.length, 1);
  assert.match(r.mustReject[0], /^Any:/);
  assert.equal(r.missingAcknowledgments.length, 0);
});

test('required scope unacknowledged => passed:false + listed in missingAcknowledgments', () => {
  const r = svc.checkCompliance({
    platform: 'Amazon KDP',
    scopes: ['ai_generated_text'],
    acknowledgedScopes: [],
  });
  assert.equal(r.passed, false);
  assert.deepEqual(r.missingAcknowledgments, ['ai_generated_text']);
  assert.equal(r.mustReject.length, 0);
});

test('required scope acknowledged => passed:true', () => {
  const r = svc.checkCompliance({
    platform: 'Amazon KDP',
    scopes: ['ai_generated_text'],
    acknowledgedScopes: ['ai_generated_text'],
  });
  assert.equal(r.passed, true);
  assert.equal(r.missingAcknowledgments.length, 0);
  assert.equal(r.mustReject.length, 0);
});

test('recommended scope => warning, not a blocker (passed:true)', () => {
  // ai_translated on "Amazon" matches the 'recommended' rule (platform "Amazon").
  // It must NOT also pull in a required rule, so use a platform that only hits recommended.
  const r = svc.checkCompliance({
    platform: 'Amazon',
    scopes: ['ai_translated'],
    acknowledgedScopes: [],
  });
  assert.equal(r.passed, true);
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /Amazon \(ai_translated\)/);
  assert.equal(r.missingAcknowledgments.length, 0);
  assert.equal(r.mustReject.length, 0);
});

test('platform fuzzy-match: "Amazon KDP" hits the KDP ai_generated_text required rule', () => {
  const reqs = svc.getRequirements('Amazon KDP', ['ai_generated_text']);
  // Both the KDP rule (platform "Amazon KDP") and the EU rule should be filtered:
  // EU markets rule has platform "EU markets" — words "eu","markets" not in "amazon kdp" → excluded.
  const platforms = reqs.map(r => r.platform);
  assert.ok(platforms.includes('Amazon KDP'));
  assert.ok(!platforms.includes('EU markets'));
  assert.equal(reqs.length, 1);
});

test('platform fuzzy-match: a France target hits the ai_translated required rule', () => {
  const reqs = svc.getRequirements('France', ['ai_translated']);
  const platforms = reqs.map(r => r.platform);
  assert.ok(platforms.includes('France'));
  // "Amazon" recommended rule should NOT match a France platform.
  assert.ok(!platforms.includes('Amazon'));
  assert.equal(reqs.length, 1);
});

test('France ai_translated unacknowledged => passed:false', () => {
  const r = svc.checkCompliance({
    platform: 'France',
    scopes: ['ai_translated'],
    acknowledgedScopes: [],
  });
  assert.equal(r.passed, false);
  assert.deepEqual(r.missingAcknowledgments, ['ai_translated']);
});

test('getRequirements: "Any"-platform rule always matches regardless of platform string', () => {
  const reqs = svc.getRequirements('SomeRandomStore', ['financial_action']);
  assert.equal(reqs.length, 1);
  assert.equal(reqs[0].platform, 'Any');
  assert.equal(reqs[0].requirement, 'required');
});

test('missingAcknowledgments is de-duplicated across multiple matching required rules', () => {
  // "Amazon KDP EU markets" matches both KDP (Amazon KDP) and EU (EU markets) ai_generated_text
  // rules, each on the same scope. The result set must collapse to a single entry.
  const r = svc.checkCompliance({
    platform: 'Amazon KDP EU markets',
    scopes: ['ai_generated_text'],
    acknowledgedScopes: [],
  });
  assert.deepEqual(r.missingAcknowledgments, ['ai_generated_text']);
  // requirements list itself is NOT de-duped — two rules matched.
  assert.equal(r.requirements.length, 2);
});

test('empty scopes => no requirements, passed:true', () => {
  const r = svc.checkCompliance({
    platform: 'Amazon KDP',
    scopes: [],
    acknowledgedScopes: [],
  });
  assert.equal(r.passed, true);
  assert.equal(r.requirements.length, 0);
  assert.equal(r.warnings.length, 0);
  assert.equal(r.mustReject.length, 0);
});
