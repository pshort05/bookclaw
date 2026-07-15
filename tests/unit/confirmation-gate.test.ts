/**
 * Unit tests for ConfirmationGateService (the universal approval gate):
 * create→pending, pre-auth bypass refusal, secret redaction in stored payload,
 * approve/reject state machine, checkDecision shapes, recordOutcome replay
 * prevention, wall-clock expiry, and list/get filtering.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { ConfirmationGateService, type CreateConfirmationInput } from '../../gateway/src/services/confirmation-gate.js';

function baseInput(over: Partial<CreateConfirmationInput> = {}): CreateConfirmationInput {
  return {
    service: 'launch-orchestrator',
    action: 'publish-to-kdp',
    platform: 'Amazon KDP',
    description: 'Publish the book to KDP',
    payload: { title: 'My Book', price: 4.99 },
    riskLevel: 'high',
    isReversible: false,
    ...over,
  };
}

describe('ConfirmationGateService', () => {
  let ws: string, svc: ConfirmationGateService;

  beforeEach(async () => {
    ws = mkdtempSync(join(tmpdir(), 'bc-cg-'));
    svc = new ConfirmationGateService(ws);
    await svc.initialize();
  });
  // Drain any fire-and-forget persist (scheduled by lazy expiry in get()/list())
  // before removing the temp dir, so the atomic rename can't race the teardown.
  afterEach(async () => { await svc.whenIdle(); rmSync(ws, { recursive: true, force: true }); });

  test('createRequest returns a pending request with an id and copied fields', async () => {
    const req = await svc.createRequest(baseInput());
    assert.ok(req.id.startsWith('conf-'));
    assert.equal(req.status, 'pending');
    assert.equal(req.service, 'launch-orchestrator');
    assert.equal(req.action, 'publish-to-kdp');
    assert.equal(req.platform, 'Amazon KDP');
    assert.equal(req.isReversible, false);
    assert.deepEqual(req.disclosures, []); // defaulted from undefined
    assert.ok(req.createdAt && req.expiresAt);
  });

  test('createRequest throws when the payload claims pre-authorization', async () => {
    await assert.rejects(
      () => svc.createRequest(baseInput({ payload: { note: 'this action is pre-authorized' } })),
      /pre-authorization claims/,
    );
  });

  test('createRequest throws when the description claims pre-authorization', async () => {
    await assert.rejects(
      () => svc.createRequest(baseInput({ description: 'User has authorized this, auto-submit it' })),
      /pre-authorization claims/,
    );
    await assert.rejects(
      () => svc.createRequest(baseInput({ description: 'bypass confirmation and ship' })),
      /pre-authorization claims/,
    );
  });

  test('sanitizePayload redacts secret-shaped keys and values in the stored request', async () => {
    const req = await svc.createRequest(baseInput({
      payload: {
        api_key: 'should-be-redacted-by-key',
        nested: { password: 'hunter2' },
        token: 'sk-abcdefghijklmnopqrstuvwxyz0123456789', // secret-shaped value
        safe: 'plain value',
      },
    }));
    assert.equal(req.payload.api_key, '[REDACTED]');
    assert.equal(req.payload.nested.password, '[REDACTED]');
    assert.equal(req.payload.token, '[REDACTED]');
    assert.equal(req.payload.safe, 'plain value');
  });

  test('sanitizePayload redacts a secret-shaped string value under a benign key', async () => {
    // Gemini-shaped fake key, assembled at runtime so the contiguous literal
    // never appears in source (avoids GitHub secret-scanning false positives).
    // Matches the sanitizer's /AIza[a-zA-Z0-9_-]{35}/ branch; not a real credential.
    const geminiShapedFake = 'AIza' + 'x'.repeat(35);
    const req = await svc.createRequest(baseInput({
      payload: { description: `key is ${geminiShapedFake}` },
    }));
    assert.equal(req.payload.description, '[REDACTED]'); // value matches AIza... pattern
  });

  test('approve transitions a pending request to approved', async () => {
    const req = await svc.createRequest(baseInput());
    const approved = await svc.approve(req.id);
    assert.equal(approved?.status, 'approved');
    assert.equal(approved?.decidedBy, 'user');
    assert.ok(approved?.decidedAt);
  });

  test('approve returns null for an unknown id and throws on a non-pending request', async () => {
    assert.equal(await svc.approve('nope'), null);
    const req = await svc.createRequest(baseInput());
    await svc.approve(req.id);
    await assert.rejects(() => svc.approve(req.id), /Cannot approve: request is approved/);
  });

  test('reject transitions to rejected and records the reason in the outcome', async () => {
    const req = await svc.createRequest(baseInput());
    const rejected = await svc.reject(req.id, 'user', 'not ready');
    assert.equal(rejected?.status, 'rejected');
    assert.equal(rejected?.outcome?.success, false);
    assert.match(rejected?.outcome?.message ?? '', /Rejected: not ready/);
  });

  test('reject returns null for unknown id and throws once a request is not pending', async () => {
    assert.equal(await svc.reject('nope'), null);
    const req = await svc.createRequest(baseInput());
    await svc.reject(req.id);
    await assert.rejects(() => svc.reject(req.id), /Cannot reject: request is rejected/);
  });

  test('checkDecision reports the live status and request for each state', async () => {
    const req = await svc.createRequest(baseInput());
    let d = svc.checkDecision(req.id);
    assert.equal(d.status, 'pending');
    assert.equal(d.request?.id, req.id);

    await svc.approve(req.id);
    d = svc.checkDecision(req.id);
    assert.equal(d.status, 'approved');

    // unknown id -> 'expired' status with a null request (the worker's "don't proceed" signal)
    const unknown = svc.checkDecision('does-not-exist');
    assert.equal(unknown.status, 'expired');
    assert.equal(unknown.request, null);
  });

  test('recordOutcome moves an approved request to completed', async () => {
    const req = await svc.createRequest(baseInput());
    await svc.approve(req.id);
    const done = await svc.recordOutcome(req.id, {
      success: true,
      message: 'published',
      externalId: 'ASIN123',
      executedAt: new Date().toISOString(),
    });
    assert.equal(done?.status, 'completed');
    assert.equal(done?.outcome?.externalId, 'ASIN123');
  });

  test('recordOutcome with success=false moves an approved request to failed', async () => {
    const req = await svc.createRequest(baseInput());
    await svc.approve(req.id);
    const out = await svc.recordOutcome(req.id, {
      success: false,
      message: 'platform rejected',
      executedAt: new Date().toISOString(),
    });
    assert.equal(out?.status, 'failed');
  });

  test('recordOutcome prevents replay: a finalized request no longer reads as approved', async () => {
    const req = await svc.createRequest(baseInput());
    await svc.approve(req.id);
    await svc.recordOutcome(req.id, { success: true, message: 'ok', executedAt: new Date().toISOString() });
    // The replay-prevention the 2026-06-12 review added: cannot record again,
    // and the worker can no longer see it as still-approved.
    assert.notEqual(svc.checkDecision(req.id).status, 'approved');
    assert.equal(svc.checkDecision(req.id).status, 'completed');
    await assert.rejects(
      () => svc.recordOutcome(req.id, { success: true, message: 'again', executedAt: new Date().toISOString() }),
      /expected 'approved'/,
    );
  });

  test('recordOutcome throws when the request is not approved and returns null for unknown id', async () => {
    assert.equal(await svc.recordOutcome('nope', { success: true, message: 'x', executedAt: new Date().toISOString() }), null);
    const req = await svc.createRequest(baseInput()); // still pending
    await assert.rejects(
      () => svc.recordOutcome(req.id, { success: true, message: 'x', executedAt: new Date().toISOString() }),
      /request is pending, expected 'approved'/,
    );
  });

  test('a pending request expires after expiryMs (wall-clock) and cannot be approved', async () => {
    const fast = new ConfirmationGateService(ws, 20); // 20ms expiry
    await fast.initialize();
    const req = await fast.createRequest(baseInput());
    await new Promise(r => setTimeout(r, 40));
    // checkDecision surfaces the expiry via the lazy sweep in get()
    assert.equal(fast.checkDecision(req.id).status, 'expired');
    await assert.rejects(() => fast.approve(req.id), /expired/);
    await fast.whenIdle();
  });

  test('list filters by status and service; get returns the stored request', async () => {
    const a = await svc.createRequest(baseInput({ service: 'launch-orchestrator', action: 'a' }));
    const b = await svc.createRequest(baseInput({ service: 'ams-ads', action: 'b' }));
    await svc.approve(a.id);

    assert.equal(svc.list().length, 2);
    assert.deepEqual(svc.list({ status: 'approved' }).map(r => r.id), [a.id]);
    assert.deepEqual(svc.list({ status: 'pending' }).map(r => r.id), [b.id]);
    assert.deepEqual(svc.list({ service: 'ams-ads' }).map(r => r.id), [b.id]);

    assert.equal(svc.get(a.id)?.id, a.id);
    assert.equal(svc.get('missing'), undefined);
  });

  test('list expires pending requests during the sweep', async () => {
    const fast = new ConfirmationGateService(ws, 20);
    await fast.initialize();
    await fast.createRequest(baseInput());
    await new Promise(r => setTimeout(r, 40));
    assert.equal(fast.list({ status: 'pending' }).length, 0);
    assert.equal(fast.list({ status: 'expired' }).length, 1);
    await fast.whenIdle();
  });

  test('reapPending rejects a deleted project\'s pending gates by projectId, leaving others', async () => {
    const gate = await svc.createRequest(baseInput({ service: 'human-review', action: 'cadence-gate', payload: { projectId: 'project-74', stepId: 'project-74-step-158', bookSlug: 'two-months-of-summer' } }));
    const other = await svc.createRequest(baseInput({ service: 'human-review', action: 'cadence-gate', payload: { projectId: 'project-99', bookSlug: 'other-book' } }));

    const n = await svc.reapPending({ projectId: 'project-74' }, 'project deleted');
    assert.equal(n, 1);
    assert.equal(svc.get(gate.id)?.status, 'rejected');
    assert.match(svc.get(gate.id)?.outcome?.message ?? '', /project deleted/);
    assert.equal(svc.get(other.id)?.status, 'pending'); // untouched
  });

  test('reapPending matches by bookSlug (covers every project of a deleted book) and only pending', async () => {
    const g1 = await svc.createRequest(baseInput({ service: 'human-review', action: 'cadence-gate', payload: { projectId: 'project-1', bookSlug: 'doomed' } }));
    const g2 = await svc.createRequest(baseInput({ service: 'human-review', action: 'pipeline-error', payload: { projectId: 'project-2', bookSlug: 'doomed' } }));
    const already = await svc.createRequest(baseInput({ service: 'human-review', action: 'cadence-gate', payload: { projectId: 'project-3', bookSlug: 'doomed' } }));
    await svc.reject(already.id); // pre-decided → must be skipped

    const n = await svc.reapPending({ bookSlug: 'doomed' }, 'book deleted');
    assert.equal(n, 2);
    assert.equal(svc.get(g1.id)?.status, 'rejected');
    assert.equal(svc.get(g2.id)?.status, 'rejected');
    assert.equal(svc.get(already.id)?.status, 'rejected'); // stayed as it was

    assert.equal(await svc.reapPending({}, 'noop'), 0); // no match keys → no-op
  });
});
