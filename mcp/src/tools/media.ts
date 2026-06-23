import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { BookClawClient } from '../bookclaw-client.js';
import { toToolResult } from './_shared.js';

// Shared cover-brief fields used by both generate_book_cover and the cover-set
// tools — the same visual brief BookClaw's handlers accept.
const coverBrief = {
  title: z.string().optional(),
  author: z.string().optional(),
  genre: z.string().optional(),
  style: z.string().optional(),
  subgenre: z.string().optional(),
  mood: z.string().optional(),
  era: z.string().optional(),
  setting: z.string().optional(),
  keyImagery: z.string().optional(),
  palette: z.string().optional(),
  avoidImagery: z.string().optional(),
  includeText: z.boolean().optional(),
  typographyNote: z.string().optional(),
  quality: z.string().optional(),
  provider: z.string().optional(),
};

// Internet research, image/cover generation, and TTS/audio. Binary file-serving
// endpoints (GET /api/images/:filename, /api/audio/file/:filename) stay on the
// escape hatch — they return bytes, not JSON.
export function registerMediaTools(server: McpServer, client: BookClawClient): void {
  // ── Research ──
  server.registerTool('research',
    {
      title: 'Internet research',
      description: 'Search allowlisted domains and extract content for a query.',
      inputSchema: { query: z.string().describe('Search query (required)'), maxResults: z.number().optional() },
    },
    async (args) => toToolResult('research', await client.request('POST', '/api/research', args)),
  );

  server.registerTool('list_research_domains',
    { title: 'List research domains', description: 'List the allowlisted research domains.', inputSchema: {} },
    async () => toToolResult('list_research_domains', await client.request('GET', '/api/research/domains')),
  );

  server.registerTool('set_research_domains',
    {
      title: 'Set research domains',
      description: 'Replace the research domain allowlist.',
      inputSchema: { domains: z.array(z.string()).describe('Allowed domains') },
    },
    async (args) => toToolResult('set_research_domains', await client.request('POST', '/api/research/domains', args)),
  );

  // ── Images / covers ──
  server.registerTool('generate_image',
    {
      title: 'Generate image',
      description: 'Generate an image from a text prompt.',
      inputSchema: {
        prompt: z.string().describe('Image prompt (required)'),
        provider: z.string().optional(),
        width: z.number().optional(),
        height: z.number().optional(),
        style: z.string().optional(),
      },
    },
    async (args) => toToolResult('generate_image', await client.request('POST', '/api/images/generate', args)),
  );

  server.registerTool('generate_book_cover',
    {
      title: 'Generate book cover',
      description: 'Generate a single book cover from a visual brief.',
      inputSchema: { description: z.string().describe('Visual description (required)'), ...coverBrief },
    },
    async (args) => toToolResult('generate_book_cover', await client.request('POST', '/api/images/book-cover', args)),
  );

  server.registerTool('generate_cover_set',
    {
      title: 'Generate cover set',
      description: 'Generate the full set of cover sizes (ebook/print/audiobook/social) from one brief.',
      inputSchema: {
        description: z.string().describe('Visual description (required)'),
        variants: z.array(z.string()).optional().describe('Subset of variant ids; omit for all'),
        ...coverBrief,
      },
    },
    async (args) => toToolResult('generate_cover_set', await client.request('POST', '/api/images/cover-set', args)),
  );

  server.registerTool('generate_project_cover_set',
    {
      title: 'Generate project cover set',
      description: 'Generate a cover set for a project (auto-fills title/author/genre/description).',
      inputSchema: {
        id: z.string().describe('Project id'),
        description: z.string().optional(),
        variants: z.array(z.string()).optional(),
        ...coverBrief,
      },
    },
    async ({ id, ...body }) =>
      toToolResult('generate_project_cover_set', await client.request('POST', `/api/projects/${encodeURIComponent(id)}/cover-set`, body)),
  );

  server.registerTool('list_cover_variants',
    { title: 'List cover variants', description: 'List the available cover-variant specs.', inputSchema: {} },
    async () => toToolResult('list_cover_variants', await client.request('GET', '/api/images/cover-variants')),
  );

  server.registerTool('list_image_providers',
    { title: 'List image providers', description: 'List available image-generation providers.', inputSchema: {} },
    async () => toToolResult('list_image_providers', await client.request('GET', '/api/images/providers')),
  );

  // ── Audio / TTS ──
  server.registerTool('generate_audio',
    {
      title: 'Generate audio (TTS)',
      description: 'Generate speech audio from text. Voice resolves from explicit voice, persona, or default.',
      inputSchema: {
        text: z.string().max(50_000).describe('Text to speak (max 50,000 chars)'),
        voice: z.string().optional().describe('Voice id or preset name'),
        provider: z.enum(['edge', 'elevenlabs']).optional(),
        rate: z.string().optional(),
        pitch: z.string().optional(),
        volume: z.string().optional(),
        personaId: z.string().optional(),
        projectId: z.string().optional(),
        elevenLabsModel: z.string().optional(),
      },
    },
    async (args) => toToolResult('generate_audio', await client.request('POST', '/api/audio/generate', args)),
  );

  server.registerTool('list_voices',
    { title: 'List voices', description: 'List TTS voices (Edge presets always; ElevenLabs when keyed) and the active voice/provider.', inputSchema: {} },
    async () => toToolResult('list_voices', await client.request('GET', '/api/audio/voices')),
  );

  server.registerTool('set_audio_config',
    {
      title: 'Set audio config',
      description: 'Set the global default TTS voice and/or provider.',
      inputSchema: { voice: z.string().optional(), provider: z.enum(['edge', 'elevenlabs']).optional() },
    },
    async (args) => toToolResult('set_audio_config', await client.request('POST', '/api/audio/config', args)),
  );
}
