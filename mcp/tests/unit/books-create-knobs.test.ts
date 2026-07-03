import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { createClient } from '../../src/bookclaw-client.js';
import { registerBookTools } from '../../src/tools/books.js';

// Lockstep guard: the flagship engine (Plans 2/5/6/8) added per-book knobs to
// POST /api/books — contentCeiling, uncensoredProvider, reviewCadence,
// costBudget, ensemble, preferredProvider/Model. The MCP SDK strips any input
// not declared in a tool's inputSchema, so create_book must declare each knob
// or it is silently undroppable via the first-class tool.

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

test('create_book exposes every flagship per-book knob in its input schema', () => {
  const client = createClient({ baseUrl, token: 't' });
  const { srv, tools } = fakeServer();
  registerBookTools(srv as any, client);

  const schema = tools.create_book?.schema;
  assert.ok(schema, 'create_book must be registered');
  for (const key of ['contentCeiling', 'uncensoredProvider', 'reviewCadence', 'costBudget', 'ensemble', 'preferredProvider', 'preferredModel']) {
    assert.ok(schema[key], `create_book must expose the "${key}" knob (POST /api/books reads body.${key})`);
  }
});

test('create_book forwards the flagship knobs in the POST /api/books body', async () => {
  const client = createClient({ baseUrl, token: 't' });
  const { srv, tools } = fakeServer();
  registerBookTools(srv as any, client);

  await tools.create_book.handler({
    title: 'Flagship Book',
    genre: 'romance',
    contentCeiling: { spice: 8, violence: 4 },
    uncensoredProvider: 'venice',
    reviewCadence: 'per_act',
    costBudget: 25,
    ensemble: { enabled: true, panel: ['gpt', 'claude'] },
    preferredProvider: 'openrouter',
    preferredModel: 'anthropic/claude-sonnet-4.6',
  });

  assert.equal(lastReq.method, 'POST');
  assert.equal(lastReq.url, '/api/books');
  const sent = JSON.parse(lastReq.body || '{}');
  assert.deepEqual(sent.contentCeiling, { spice: 8, violence: 4 });
  assert.equal(sent.uncensoredProvider, 'venice');
  assert.equal(sent.reviewCadence, 'per_act');
  assert.equal(sent.costBudget, 25);
  assert.deepEqual(sent.ensemble, { enabled: true, panel: ['gpt', 'claude'] });
  assert.equal(sent.preferredProvider, 'openrouter');
  assert.equal(sent.preferredModel, 'anthropic/claude-sonnet-4.6');
});
