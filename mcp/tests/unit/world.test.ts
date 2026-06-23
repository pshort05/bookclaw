import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createClient } from '../../src/bookclaw-client.js';
import { registerWorldTools } from '../../src/tools/world.js';

let server: Server;
let baseUrl: string;
let lastReq: { method?: string; url?: string } = {};

before(async () => {
  server = createServer((req, res) => {
    lastReq = { method: req.method, url: req.url };
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ worlds: [] }));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  if (typeof addr === 'object' && addr) baseUrl = `http://127.0.0.1:${addr.port}`;
});
after(() => server.close());

test('registerWorldTools compiles and wires list_worlds to GET /api/worlds', async () => {
  const client = createClient({ baseUrl, token: 't' });
  const mcp = new McpServer({ name: 'test', version: '0' });
  registerWorldTools(mcp, client);
  const res = await client.request('GET', '/api/worlds');
  assert.equal(lastReq.method, 'GET');
  assert.equal(lastReq.url, '/api/worlds');
  assert.equal(res.ok, true);
});

test('bind_book_world path encodes the slug and uses PUT', async () => {
  const client = createClient({ baseUrl, token: 't' });
  await client.request('PUT', '/api/books/my-book/world', { world: 'shattered-cradle' });
  assert.equal(lastReq.method, 'PUT');
  assert.equal(lastReq.url, '/api/books/my-book/world');
});
