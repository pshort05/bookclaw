import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { BookClawClient } from '../bookclaw-client.js';
import { toToolResult } from './_shared.js';

const KIND = z.enum(['author', 'voice', 'genre', 'pipeline', 'section', 'skill']);

export function registerLibraryTools(server: McpServer, client: BookClawClient): void {
  server.registerTool('list_library',
    {
      title: 'List library',
      description: 'List reusable library assets. Omit kind for an overview, or pass a kind to list its entries.',
      inputSchema: { kind: KIND.optional() },
    },
    async ({ kind }) =>
      toToolResult('list_library', await client.request('GET', kind ? `/api/library/${kind}` : '/api/library')),
  );

  server.registerTool('get_library_entry',
    { title: 'Get library entry', description: 'Get one library entry by kind and name.', inputSchema: { kind: KIND, name: z.string() } },
    async ({ kind, name }) =>
      toToolResult('get_library_entry', await client.request('GET', `/api/library/${kind}/${encodeURIComponent(name)}`)),
  );
}
