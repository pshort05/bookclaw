import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { createClient } from '../../src/bookclaw-client.js';
import { registerBookTools } from '../../src/tools/books.js';

// Lockstep guard: Task 1 added a `blueprint` seed to POST /api/books, and
// Task 4 added POST /api/books/intake (romance premise-file intake). The MCP
// SDK strips any input not declared in a tool's inputSchema, so create_book
// must declare `blueprint` and a premise_intake tool must exist to reach the
// new endpoint.

let server: Server;
let baseUrl: string;
let lastReq: { method?: string; url?: string; body?: string } = {};

before(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      lastReq = { method: req.method, url: req.url, body };
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ slug: 'demo', title: 'Demo' }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  if (typeof addr === 'object' && addr) baseUrl = `http://127.0.0.1:${addr.port}`;
});
after(() => server.close());

/** Minimal fake McpServer that captures each tool's (schema, handler) by name. */
function fakeServer() {
  const tools: Record<string, { schema: any; handler: (args: any) => Promise<any> }> = {};
  const srv = {
    registerTool(name: string, def: any, handler: (args: any) => Promise<any>) {
      tools[name] = { schema: def.inputSchema, handler };
    },
  };
  return { srv, tools };
}

test('create_book exposes the blueprint seed in its input schema', () => {
  const client = createClient({ baseUrl, token: 't' });
  const { srv, tools } = fakeServer();
  registerBookTools(srv as any, client);

  assert.ok(tools.create_book.schema.blueprint, 'create_book must expose the "blueprint" seed');
});

test('create_book forwards blueprint in the POST /api/books body', async () => {
  const client = createClient({ baseUrl, token: 't' });
  const { srv, tools } = fakeServer();
  registerBookTools(srv as any, client);

  await tools.create_book.handler({ title: 'X', blueprint: 'BP_MARKER' });

  assert.equal(lastReq.url, '/api/books');
  const sent = JSON.parse(lastReq.body || '{}');
  assert.equal(sent.blueprint, 'BP_MARKER');
});

test('premise_intake is registered and POSTs to /api/books/intake', async () => {
  const client = createClient({ baseUrl, token: 't' });
  const { srv, tools } = fakeServer();
  registerBookTools(srv as any, client);

  assert.ok(tools.premise_intake, 'premise_intake must be registered');
  await tools.premise_intake.handler({ premise: '# Test premise' });

  assert.equal(lastReq.method, 'POST');
  assert.equal(lastReq.url, '/api/books/intake');
  const sent = JSON.parse(lastReq.body || '{}');
  assert.equal(sent.premise, '# Test premise');
});
