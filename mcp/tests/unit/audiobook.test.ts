import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createClient } from '../../src/bookclaw-client.js';
import { registerAudiobookTools } from '../../src/tools/audiobook.js';

let server: Server;
let baseUrl: string;
let lastReq: { method?: string; url?: string } = {};

before(async () => {
  server = createServer((req, res) => {
    lastReq = { method: req.method, url: req.url };
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  if (typeof addr === 'object' && addr) baseUrl = `http://127.0.0.1:${addr.port}`;
});
after(() => server.close());

test('registerAudiobookTools compiles and wires audiobook_cleanup to the project path', async () => {
  const client = createClient({ baseUrl, token: 't' });
  const mcp = new McpServer({ name: 'test', version: '0' });
  registerAudiobookTools(mcp, client);
  const res = await client.request('POST', '/api/projects/p1/audiobook/cleanup');
  assert.equal(lastReq.url, '/api/projects/p1/audiobook/cleanup');
  assert.equal(res.ok, true);
});
