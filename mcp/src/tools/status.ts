import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { BookClawClient } from '../bookclaw-client.js';
import { toToolResult } from './_shared.js';

export function registerStatusTools(server: McpServer, client: BookClawClient): void {
  server.registerTool(
    'bookclaw_status',
    {
      title: 'BookClaw status',
      description: 'Liveness and runtime status of the BookClaw gateway (providers, version, active book).',
      inputSchema: {},
    },
    async () => toToolResult('bookclaw_status', await client.request('GET', '/api/status')),
  );
}
