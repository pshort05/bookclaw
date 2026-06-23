import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { createClient } from '../../src/bookclaw-client.js';

// A tiny stub BookClaw that echoes auth + path and can be told to return a status.
let server: Server;
let baseUrl: string;
let lastAuth: string | undefined;
let nextStatus = 200;
let nextBody: unknown = { ok: true };

before(async () => {
  server = createServer((req, res) => {
    lastAuth = req.headers['authorization'];
    res.statusCode = nextStatus;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(nextBody));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  if (typeof addr === 'object' && addr) baseUrl = `http://127.0.0.1:${addr.port}`;
});

after(() => server.close());

test('injects the bearer token', async () => {
  nextStatus = 200; nextBody = { hello: 'world' };
  const client = createClient({ baseUrl, token: 'secret-token' });
  const res = await client.request('GET', '/api/status');
  assert.equal(lastAuth, 'Bearer secret-token');
  assert.deepEqual(res, { ok: true, status: 200, data: { hello: 'world' } });
});

test('maps 401 to a friendly auth error', async () => {
  nextStatus = 401; nextBody = { error: 'unauthorized' };
  const client = createClient({ baseUrl, token: 'bad' });
  const res = await client.request('GET', '/api/status');
  assert.equal(res.ok, false);
  if (!res.ok) assert.match(res.error, /BOOKCLAW_AUTH_TOKEN/);
});

test('maps 503 to a no-providers error', async () => {
  nextStatus = 503; nextBody = { error: 'no providers' };
  const client = createClient({ baseUrl, token: 'x' });
  const res = await client.request('POST', '/api/chat', { message: 'hi' });
  assert.equal(res.ok, false);
  if (!res.ok) assert.match(res.error, /no AI providers/i);
});

test('maps a connection failure to a retryable error', async () => {
  const client = createClient({ baseUrl: 'http://127.0.0.1:1', token: 'x', timeoutMs: 500 });
  const res = await client.request('GET', '/api/status');
  assert.equal(res.ok, false);
  if (!res.ok) assert.match(res.error, /127\.0\.0\.1:1/);
});
