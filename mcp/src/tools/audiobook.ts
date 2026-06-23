import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { BookClawClient } from '../bookclaw-client.js';
import { toToolResult } from './_shared.js';

// Audiobook narration prep for a project: clean the script, build a pronunciation
// dictionary, generate SSML, and attribute lines to voices. The per-segment audio
// is then produced with generate_audio (media tools).
export function registerAudiobookTools(server: McpServer, client: BookClawClient): void {
  const id = z.string().describe('Project id');

  server.registerTool('audiobook_cleanup',
    {
      title: 'Audiobook cleanup',
      description: 'Clean a project\'s manuscript into a narration-ready script.',
      inputSchema: { id },
    },
    async ({ id }) => toToolResult('audiobook_cleanup', await client.request('POST', `/api/projects/${encodeURIComponent(id)}/audiobook/cleanup`)),
  );

  server.registerTool('audiobook_pronunciation',
    {
      title: 'Audiobook pronunciation',
      description: 'Build a pronunciation dictionary for a project\'s named entities.',
      inputSchema: { id },
    },
    async ({ id }) => toToolResult('audiobook_pronunciation', await client.request('POST', `/api/projects/${encodeURIComponent(id)}/audiobook/pronunciation`)),
  );

  server.registerTool('audiobook_ssml',
    {
      title: 'Audiobook SSML',
      description: 'Build SSML for a project\'s narration (with pronunciation + cleanup applied).',
      inputSchema: {
        id,
        aiNarrationDisclosed: z.boolean().optional().describe('Whether AI-narration disclosure is included'),
      },
    },
    async ({ id, ...body }) =>
      toToolResult('audiobook_ssml', await client.request('POST', `/api/projects/${encodeURIComponent(id)}/audiobook/ssml`, body)),
  );

  server.registerTool('audiobook_attribute',
    {
      title: 'Audiobook voice attribution',
      description: 'Attribute narration segments to voices for multi-voice audiobook production.',
      inputSchema: {
        id,
        chapterNumber: z.number().optional().describe('Single chapter to attribute; omit for all'),
        voiceMap: z.record(z.unknown()).optional().describe('Explicit { narratorVoice, characterVoices, defaultCharacterVoice }'),
        customVoices: z.record(z.unknown()).optional().describe('Partial map merged into auto-assigned voices'),
      },
    },
    async ({ id, ...body }) =>
      toToolResult('audiobook_attribute', await client.request('POST', `/api/projects/${encodeURIComponent(id)}/audiobook/attribute`, body)),
  );
}
