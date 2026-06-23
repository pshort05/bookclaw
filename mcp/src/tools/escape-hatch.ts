import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { BookClawClient } from '../bookclaw-client.js';
import { toToolResult } from './_shared.js';
import { ENDPOINT_CATALOG } from '../endpoints.js';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

export function validatePath(path: string): string | null {
  if (!path.startsWith('/api/')) return 'path must start with /api/';
  if (path.includes('://')) return 'path must be a relative /api/ path, not a full URL';
  // fetch() normalizes dot-segments, so '/api/../admin' would escape the /api/ namespace.
  if (path.split('/').includes('..')) return 'path must not contain ".." segments';
  return null;
}

export function registerEscapeHatch(server: McpServer, client: BookClawClient): void {
  server.registerTool('list_endpoints',
    {
      title: 'List BookClaw endpoints',
      description: 'A curated catalog of BookClaw REST endpoints reachable via bookclaw_request.',
      inputSchema: {},
    },
    async () => ({ content: [{ type: 'text' as const, text: JSON.stringify(ENDPOINT_CATALOG, null, 2) }] }),
  );

  server.registerTool('bookclaw_request',
    {
      title: 'Call any BookClaw endpoint',
      description:
        'Escape hatch: call any /api/ endpoint not covered by a dedicated tool. ' +
        'Irreversible actions (publish/send/submit/upload/purchase) return a pending-confirmation ' +
        'response that a human must approve in BookClaw — this tool never auto-approves.',
      inputSchema: {
        method: z.enum(METHODS),
        path: z.string().describe('A path beginning with /api/'),
        body: z.record(z.unknown()).optional().describe('JSON body for POST/PUT/PATCH'),
      },
    },
    async ({ method, path, body }) => {
      const err = validatePath(path);
      if (err) return { isError: true, content: [{ type: 'text' as const, text: `bookclaw_request rejected: ${err}` }] };
      return toToolResult('bookclaw_request', await client.request(method, path, body));
    },
  );
}
