import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createClient } from '../../src/bookclaw-client.js';
import { registerCraftTools } from '../../src/tools/craft.js';

let server: Server;
let baseUrl: string;
let lastReq: { method?: string; url?: string } = {};

before(async () => {
  server = createServer((req, res) => {
    lastReq = { method: req.method, url: req.url };
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ structures: [] }));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  if (typeof addr === 'object' && addr) baseUrl = `http://127.0.0.1:${addr.port}`;
});
after(() => server.close());

test('registerCraftTools compiles and wires list_structures to GET /api/structures', async () => {
  const client = createClient({ baseUrl, token: 't' });
  const mcp = new McpServer({ name: 'test', version: '0' });
  registerCraftTools(mcp, client);
  const res = await client.request('GET', '/api/structures');
  assert.equal(lastReq.url, '/api/structures');
  assert.equal(res.ok, true);
});

test('craft wires the new per-book analysis endpoints (forms + consistency audit)', async () => {
  const client = createClient({ baseUrl, token: 't' });
  await client.request('GET', '/api/forms');
  assert.equal(lastReq.url, '/api/forms');
  await client.request('POST', '/api/books/demo/consistency-audit', {});
  assert.equal(lastReq.method, 'POST');
  assert.equal(lastReq.url, '/api/books/demo/consistency-audit');
});
