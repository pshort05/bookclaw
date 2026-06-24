import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConsistencyJobRegistry } from '../../gateway/src/services/consistency/job-registry.js';

test('start() registers a job and returns true the first time', () => {
  const r = new ConsistencyJobRegistry();
  assert.equal(r.isRunning('book-a'), false);
  assert.equal(r.start('book-a'), true);
  assert.equal(r.isRunning('book-a'), true);
});

test('start() returns false while a job for the same slug is already running', () => {
  const r = new ConsistencyJobRegistry();
  assert.equal(r.start('book-a'), true);
  assert.equal(r.start('book-a'), false); // concurrency guard
  // A different book is independent.
  assert.equal(r.start('book-b'), true);
});

test('get() exposes the running job state (slug + startedAt), null when idle', () => {
  const r = new ConsistencyJobRegistry();
  assert.equal(r.get('book-a'), null);
  r.start('book-a');
  const job = r.get('book-a');
  assert.ok(job);
  assert.equal(job!.slug, 'book-a');
  assert.match(job!.startedAt, /^\d{4}-\d{2}-\d{2}T/); // ISO timestamp
  assert.equal(job!.lastMessage, null);
});

test('progress() updates lastMessage on the running job; no-op when idle', () => {
  const r = new ConsistencyJobRegistry();
  r.progress('book-a', 'ignored — not running'); // must not throw
  assert.equal(r.get('book-a'), null);
  r.start('book-a');
  r.progress('book-a', 'Scanning chapter-3...');
  assert.equal(r.get('book-a')!.lastMessage, 'Scanning chapter-3...');
});

test('finish() clears the job so a new run can start', () => {
  const r = new ConsistencyJobRegistry();
  r.start('book-a');
  r.finish('book-a');
  assert.equal(r.isRunning('book-a'), false);
  assert.equal(r.get('book-a'), null);
  assert.equal(r.start('book-a'), true); // can run again after finish
  r.finish('book-a'); // idempotent — finishing again must not throw
  r.finish('book-a');
});
