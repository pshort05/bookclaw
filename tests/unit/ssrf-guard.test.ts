import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPrivateIp, assertPublicUrl } from '../../gateway/src/security/ssrf-guard.js';

test('isPrivateIp flags internal IPv4/IPv6 ranges', () => {
  for (const ip of ['127.0.0.1', '10.0.0.5', '192.168.1.1', '172.16.0.1', '172.31.255.255',
                     '169.254.169.254', '0.0.0.0', '100.64.0.1', '::1', '::', '::ffff:127.0.0.1',
                     '::ffff:7f00:1', '::ffff:a9fe:a9fe', 'fd00::1', 'fe80::1']) {
    assert.equal(isPrivateIp(ip), true, `${ip} should be private`);
  }
});

test('isPrivateIp allows public addresses', () => {
  for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700::1111']) {
    assert.equal(isPrivateIp(ip), false, `${ip} should be public`);
  }
});

test('assertPublicUrl rejects private literals, numeric encodings, and bad protocols (no DNS needed)', async () => {
  for (const u of ['http://127.0.0.1/', 'http://169.254.169.254/latest/meta-data/',
                   'http://192.168.1.10:8080/', 'http://[::1]/',
                   'http://[::ffff:127.0.0.1]/', 'http://[::ffff:169.254.169.254]/',
                   'http://2130706433/', 'http://0x7f000001/', 'ftp://example.com/',
                   'file:///etc/passwd', 'not-a-url']) {
    const r = await assertPublicUrl(u);
    assert.equal(r.ok, false, `${u} should be blocked`);
    assert.ok(r.reason, `${u} should carry a reason`);
  }
});

test('assertPublicUrl allows a public IP literal without DNS', async () => {
  const r = await assertPublicUrl('http://8.8.8.8/');
  assert.equal(r.ok, true, r.reason);
});
