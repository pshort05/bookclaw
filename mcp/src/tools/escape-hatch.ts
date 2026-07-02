import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { BookClawClient } from '../bookclaw-client.js';
import { toToolResult } from './_shared.js';
import { ENDPOINT_CATALOG } from '../endpoints.js';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

export function validatePath(path: string): string | null {
  if (!path.startsWith('/api/')) return 'path must start with /api/';
  if (path.includes('://')) return 'path must be a relative /api/ path, not a full URL';
  // Validate the path fetch will ACTUALLY request, not the raw string. WHATWG-URL
  // (used by fetch in bookclaw-client) decodes percent-encoding, converts
  // backslashes, and collapses dot-segments AFTER any raw-string guard — so
  // '/api/confirmations/ID/x/%2e%2e/approve' or '...\approve' would slip past a
  // raw check yet normalize to the approve route on the wire (bug-review #11).
  // Normalize here so the guard sees the same pathname.
  let normalized: string;
  try {
    normalized = new URL(path, 'http://x').pathname;
  } catch {
    return 'path is not a valid /api/ path';
  }
  const lowerPath = normalized.toLowerCase();
  // After normalization the path must still live inside /api/ — a dot-segment
  // escape (/api/../admin → /admin) is rejected here.
  if (!lowerPath.startsWith('/api/')) {
    return 'path must resolve within the /api/ namespace (no ".." escapes)';
  }
  // The confirmation gate is the human-in-the-loop safety rail. The escape hatch
  // must never be able to approve/reject a gated action — otherwise an LLM
  // driving this tool (on possibly injected content) could self-approve its own
  // irreversible external actions. Approvals must come from the dashboard.
  // Lower-case the path: Express routes are case-insensitive, so a guard that is
  // not would be trivially bypassed (.../APPROVE, /api/Confirmations/...).
  if (/^\/api\/confirmations\/[^/]+\/(approve|reject)\b/.test(lowerPath)) {
    return 'confirmation approve/reject is not allowed via the MCP escape hatch — a human must approve gated actions in the BookClaw dashboard';
  }
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
