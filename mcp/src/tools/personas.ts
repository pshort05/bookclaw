import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { BookClawClient } from '../bookclaw-client.js';
import { toToolResult } from './_shared.js';

export function registerPersonaTools(server: McpServer, client: BookClawClient): void {
  server.registerTool('list_personas',
    { title: 'List personas', description: 'List all author personas (pen names).', inputSchema: {} },
    async () => toToolResult('list_personas', await client.request('GET', '/api/personas')),
  );

  server.registerTool('get_persona',
    { title: 'Get persona', description: 'Get one author persona by id.', inputSchema: { id: z.string() } },
    async ({ id }) => toToolResult('get_persona', await client.request('GET', `/api/personas/${encodeURIComponent(id)}`)),
  );

  server.registerTool('create_persona',
    {
      title: 'Create persona',
      description: 'Create an author persona (pen name) with an explicit voice and style.',
      inputSchema: {
        penName: z.string().describe('The pen name (required)'),
        genre: z.string().optional(),
        subGenre: z.string().optional(),
        voiceDescription: z.string().optional().describe('1-2 sentences on the writing voice'),
        styleMarkers: z.array(z.string()).optional().describe('Style descriptors, e.g. "witty dialogue"'),
        bio: z.string().optional().describe('Author bio, third person'),
      },
    },
    async (args) => toToolResult('create_persona', await client.request('POST', '/api/personas', args)),
  );

  server.registerTool('generate_persona',
    {
      title: 'Generate persona (AI)',
      description: 'AI-generate a full author persona for a genre and create it.',
      inputSchema: {
        genre: z.string().describe('The genre to build a persona for (required)'),
        description: z.string().optional().describe('Extra guidance for the persona'),
      },
    },
    async (args) => toToolResult('generate_persona', await client.request('POST', '/api/personas/generate', args)),
  );

  server.registerTool('update_persona',
    {
      title: 'Update persona',
      description: 'Update fields of an existing author persona by id.',
      inputSchema: {
        id: z.string(),
        penName: z.string().optional(),
        genre: z.string().optional(),
        subGenre: z.string().optional(),
        voiceDescription: z.string().optional(),
        styleMarkers: z.array(z.string()).optional(),
        bio: z.string().optional(),
      },
    },
    async ({ id, ...patch }) =>
      toToolResult('update_persona', await client.request('PUT', `/api/personas/${encodeURIComponent(id)}`, patch)),
  );

  server.registerTool('delete_persona',
    { title: 'Delete persona', description: 'Delete an author persona by id.', inputSchema: { id: z.string() } },
    async ({ id }) => toToolResult('delete_persona', await client.request('DELETE', `/api/personas/${encodeURIComponent(id)}`)),
  );

  server.registerTool('generate_persona_bio',
    {
      title: 'Generate persona bio (AI)',
      description: 'AI-generate and save a back-of-book bio for an existing persona.',
      inputSchema: { id: z.string() },
    },
    async ({ id }) =>
      toToolResult('generate_persona_bio', await client.request('POST', `/api/personas/${encodeURIComponent(id)}/generate-bio`)),
  );
}
