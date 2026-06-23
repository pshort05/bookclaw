import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createClient, type BookClawClient } from './bookclaw-client.js';
import { makeAuthMiddleware } from './auth.js';
import { registerStatusTools } from './tools/status.js';
import { registerBookTools } from './tools/books.js';
import { registerProjectTools } from './tools/projects.js';
import { registerChatTools } from './tools/chat.js';
import { registerExportTools } from './tools/export.js';
import { registerLibraryTools } from './tools/library.js';
import { registerPersonaTools } from './tools/personas.js';
import { registerSeriesTools } from './tools/series.js';
import { registerCraftTools } from './tools/craft.js';
import { registerWorldTools } from './tools/world.js';
import { registerPublishingTools } from './tools/publishing.js';
import { registerMediaTools } from './tools/media.js';
import { registerAudiobookTools } from './tools/audiobook.js';
import { registerMarketingTools } from './tools/marketing.js';
import { registerWebsiteTools } from './tools/website.js';
import { registerEscapeHatch } from './tools/escape-hatch.js';
import { GROUP_NAMES, resolveToolGroups, type GroupName } from './tool-groups.js';

// Each per-module group maps to its register function. Iterated in GROUP_NAMES
// order so registration is deterministic.
const REGISTRARS: Record<GroupName, (s: McpServer, c: BookClawClient) => void> = {
  status: registerStatusTools,
  books: registerBookTools,
  projects: registerProjectTools,
  chat: registerChatTools,
  export: registerExportTools,
  library: registerLibraryTools,
  personas: registerPersonaTools,
  series: registerSeriesTools,
  craft: registerCraftTools,
  world: registerWorldTools,
  publishing: registerPublishingTools,
  media: registerMediaTools,
  audiobook: registerAudiobookTools,
  marketing: registerMarketingTools,
  website: registerWebsiteTools,
  'escape-hatch': registerEscapeHatch,
};

export function buildMcpServer(client: BookClawClient, groups: Iterable<string> = GROUP_NAMES): McpServer {
  const server = new McpServer({ name: 'bookclaw-mcp', version: '0.1.0' });
  const selected = new Set(groups);
  for (const name of GROUP_NAMES) {
    if (selected.has(name)) REGISTRARS[name](server, client);
  }
  return server;
}

/**
 * Run the MCP server over stdio (the client launches this process and speaks
 * JSON-RPC on stdin/stdout). stdout is the protocol channel, so EVERY log line
 * must go to stderr — never console.log here.
 */
export async function startStdioServer(): Promise<void> {
  const client = createClient();
  const groups = resolveToolGroups(process.env);
  for (const w of groups.warnings) console.error(`  ⚠ ${w}`);
  if (!process.env.BOOKCLAW_AUTH_TOKEN) {
    console.error('  ⚠ BOOKCLAW_AUTH_TOKEN is unset — calls to BookClaw will likely 401.');
  }
  const server = buildMcpServer(client, groups.names);
  await server.connect(new StdioServerTransport());
  console.error(
    `  ✓ bookclaw-mcp (stdio) ready → BookClaw ${process.env.BOOKCLAW_BASE_URL ?? 'http://127.0.0.1:3847'}`
    + ` | tool groups: ${groups.source}`,
  );
}

export function startHttpServer(): void {
  const bind = process.env.BOOKCLAW_MCP_BIND ?? '127.0.0.1';
  const port = Number(process.env.BOOKCLAW_MCP_PORT ?? '3849');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid BOOKCLAW_MCP_PORT: ${process.env.BOOKCLAW_MCP_PORT} (must be an integer 1–65535).`);
  }
  const mcpToken = process.env.BOOKCLAW_MCP_TOKEN ?? '';
  const client = createClient();

  if (!mcpToken) {
    console.warn('  ⚠ BOOKCLAW_MCP_TOKEN is unset — the MCP endpoint will deny all requests.');
  }
  if (!process.env.BOOKCLAW_AUTH_TOKEN) {
    console.warn('  ⚠ BOOKCLAW_AUTH_TOKEN is unset — calls to BookClaw will likely 401.');
  }

  const groups = resolveToolGroups(process.env);
  for (const w of groups.warnings) console.warn(`  ⚠ ${w}`);

  const app = express();
  app.use(express.json({ limit: '4mb' }));
  app.post('/mcp', makeAuthMiddleware(mcpToken), async (req, res) => {
    // Stateless mode: a fresh server + transport per request (no session reuse).
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => { transport.close(); });
    try {
      const server = buildMcpServer(client, groups.names);
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      // Express 4 does not catch async rejections; without this the process crashes.
      console.error('  ⚠ MCP request failed:', err instanceof Error ? err.message : String(err));
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
      }
    }
  });
  // Stateless transport does not support server-initiated GET/DELETE sessions.
  const reject = (_req: express.Request, res: express.Response) =>
    res.status(405).json({ error: 'Method Not Allowed (stateless server).' });
  app.get('/mcp', makeAuthMiddleware(mcpToken), reject);
  app.delete('/mcp', makeAuthMiddleware(mcpToken), reject);

  app.listen(port, bind, () => {
    console.log(`  ✓ bookclaw-mcp listening on http://${bind}:${port}/mcp`);
    console.log(`  ℹ proxying to BookClaw at ${process.env.BOOKCLAW_BASE_URL ?? 'http://127.0.0.1:3847'}`);
    console.log(`  ℹ tool groups: ${groups.source} → ${groups.names.join(', ')}`);
  });
}
