// Stdio smoke: launch the server in stdio mode (pointed at a stub BookClaw),
// then list tools over stdio and assert the round-trip works. Exit non-zero on
// failure so the bash wrapper / npm script can gate on it.
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Stub BookClaw on an ephemeral port.
const stub = createServer((_req, res) => {
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ ok: true, stub: true }));
});
await new Promise((r) => stub.listen(0, '127.0.0.1', r));
const stubPort = stub.address().port;

const transport = new StdioClientTransport({
  command: 'node',
  args: ['--import', 'tsx', join(root, 'src', 'index.ts')],
  env: {
    ...process.env,
    BOOKCLAW_MCP_TRANSPORT: 'stdio',
    BOOKCLAW_BASE_URL: `http://127.0.0.1:${stubPort}`,
    BOOKCLAW_AUTH_TOKEN: 'stub-token',
    BOOKCLAW_MCP_PROFILE: 'core',
  },
  stderr: 'ignore',
});

const client = new Client({ name: 'stdio-smoke', version: '0' });
let failed = false;
try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  const names = new Set(tools.map((t) => t.name));
  if (tools.length === 0) throw new Error('no tools listed over stdio');
  if (!names.has('bookclaw_status')) throw new Error('expected bookclaw_status in core profile');
  if (!names.has('bookclaw_request')) throw new Error('escape hatch must always be present');
  console.log(`PASS: stdio transport listed ${tools.length} tools (core profile)`);
} catch (err) {
  failed = true;
  console.error('FAIL:', err instanceof Error ? err.message : String(err));
} finally {
  await client.close().catch(() => {});
  stub.close();
}
process.exit(failed ? 1 : 0);
