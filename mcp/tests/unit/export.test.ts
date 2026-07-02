import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { createClient } from '../../src/bookclaw-client.js';
import { registerExportTools } from '../../src/tools/export.js';

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
      res.end(JSON.stringify({ success: true }));
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

test('export_docx sends the required filename body param (finding 19)', async () => {
  const client = createClient({ baseUrl, token: 't' });
  const { srv, tools } = fakeServer();
  registerExportTools(srv as any, client);

  assert.ok(tools.export_docx, 'export_docx tool must be registered');
  assert.ok(tools.export_docx.schema.filename, 'export_docx must expose a filename input');

  await tools.export_docx.handler({ id: 'p1', filename: 'p1-chapter.md' });
  assert.equal(lastReq.method, 'POST');
  assert.equal(lastReq.url, '/api/projects/p1/export-docx');
  assert.deepEqual(JSON.parse(lastReq.body || '{}'), { filename: 'p1-chapter.md' });
});
