/**
 * Unit tests for the /version command formatting helpers: formatUptime (humanizes
 * a seconds count) and formatVersionInfo (the message body — version, breaking
 * version, server boot time, and uptime). Both pure so /version is identical
 * across the chat and Telegram surfaces.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatUptime, formatVersionInfo } from '../../gateway/src/version.ts';

test('formatUptime humanizes seconds, omitting zero units', () => {
  assert.equal(formatUptime(0), '0s');
  assert.equal(formatUptime(65), '1m 5s');
  assert.equal(formatUptime(3700), '1h 1m 40s');
  assert.equal(formatUptime(90061), '1d 1h 1m 1s');
});

test('formatVersionInfo includes version, breaking version, boot time, and uptime', () => {
  const now = new Date('2026-06-19T12:30:45');
  const out = formatVersionInfo({ version: 'V26.06.19', breakingVersion: 1, uptimeSeconds: 312, now });
  assert.ok(out.includes('V26.06.19'), 'version present');
  assert.ok(/breaking version[:\s]/i.test(out), 'breaking version label present');
  assert.ok(out.includes('1'), 'breaking version value present');
  assert.ok(out.includes('5m 12s'), 'uptime present');
  // boot = now - 312s = 12:25:33 on the same day
  assert.ok(out.includes('2026-06-19 12:25:33'), 'computed boot time present');
});
