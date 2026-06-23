import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { BookClawClient } from '../bookclaw-client.js';
import { toToolResult } from './_shared.js';

export function registerChatTools(server: McpServer, client: BookClawClient): void {
  server.registerTool('chat',
    {
      title: 'Chat with BookClaw',
      description: 'Send a message to the BookClaw agent (free chat or a /command). Returns the full response.',
      inputSchema: {
        message: z.string().max(10_000).describe('Message or /command (max 10,000 chars)'),
        skipHistory: z.boolean().optional().describe('Do not record this turn in conversation history'),
      },
    },
    async (args) => toToolResult('chat', await client.request('POST', '/api/chat', args)),
  );
}
