import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LogBuffer } from '../../gateway/src/services/log-buffer.js';

test('push + getLogs returns entries newest-last with level and text', () => {
  const buf = new LogBuffer({ cap: 10, maxLen: 100 });
  buf.push('info', 'started');
  buf.push('warn', 'careful');
  const lines = buf.getLogs();
  assert.equal(lines.length, 2);
  assert.equal(lines[0].text, 'started');
  assert.equal(lines[1].level, 'warn');
  assert.ok(typeof lines[0].ts === 'number' && lines[0].ts > 0);
});

test('ring buffer evicts oldest beyond the cap', () => {
  const buf = new LogBuffer({ cap: 3, maxLen: 100 });
  for (const n of [1, 2, 3, 4, 5]) buf.push('info', `line ${n}`);
  const lines = buf.getLogs();
  assert.equal(lines.length, 3);
  assert.deepEqual(lines.map((l) => l.text), ['line 3', 'line 4', 'line 5']);
});

test('getLogs honours limit (returns the most recent N)', () => {
  const buf = new LogBuffer({ cap: 100, maxLen: 100 });
  for (const n of [1, 2, 3, 4, 5]) buf.push('info', `line ${n}`);
  const lines = buf.getLogs({ limit: 2 });
  assert.deepEqual(lines.map((l) => l.text), ['line 4', 'line 5']);
});

test('level=warn filter returns only warn + error', () => {
  const buf = new LogBuffer({ cap: 100, maxLen: 100 });
  buf.push('info', 'i'); buf.push('warn', 'w'); buf.push('error', 'e'); buf.push('log', 'l');
  const lines = buf.getLogs({ level: 'warn' });
  assert.deepEqual(lines.map((l) => l.level).sort(), ['error', 'warn']);
});

test('a single line is clamped to maxLen so one giant log cannot balloon memory', () => {
  const buf = new LogBuffer({ cap: 10, maxLen: 20 });
  buf.push('info', 'x'.repeat(1000));
  assert.ok(buf.getLogs()[0].text.length <= 20 + 2); // clamp + a small ellipsis marker
});

test('installLogCapture mirrors console output into the buffer and still forwards it', () => {
  const buf = new LogBuffer({ cap: 100, maxLen: 500 });
  const calls: string[] = [];
  const fakeConsole: any = { log: (...a: any[]) => calls.push('log:' + a.join(' ')), info: () => {}, warn: () => {}, error: () => {} };
  const restore = buf.installLogCapture(fakeConsole);
  fakeConsole.log('  ✓ hello');
  restore();
  assert.ok(buf.getLogs().some((l) => l.text.includes('hello')), 'captured into buffer');
  assert.ok(calls.some((c) => c.includes('hello')), 'still forwarded to the original console');
});
