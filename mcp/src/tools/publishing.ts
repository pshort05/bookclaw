import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { BookClawClient } from '../bookclaw-client.js';
import { toToolResult } from './_shared.js';

// Export-side finishing tools: KDP blurb export, professional formatting, and
// the aggregated manuscript hub. The multipart track-changes DOCX roundtrip and
// cover typography stay on the escape hatch (file upload / workspace image path).
export function registerPublishingTools(server: McpServer, client: BookClawClient): void {
  server.registerTool('export_blurb',
    {
      title: 'Export KDP blurb',
      description: 'Format an arbitrary blurb string into KDP-ready output (no project needed).',
      inputSchema: { blurb: z.string().describe('The blurb text (required)') },
    },
    async (args) => toToolResult('export_blurb', await client.request('POST', '/api/kdp/export-blurb', args)),
  );

  server.registerTool('export_project_blurb',
    {
      title: 'Export project blurb',
      description: 'Export a project\'s blurb (pass blurb, or let BookClaw pull the latest blurb step).',
      inputSchema: { id: z.string().describe('Project id'), blurb: z.string().optional() },
    },
    async ({ id, ...body }) =>
      toToolResult('export_project_blurb', await client.request('POST', `/api/projects/${encodeURIComponent(id)}/export-blurb`, body)),
  );

  server.registerTool('format_pro',
    {
      title: 'Format Pro',
      description: 'Compile and professionally format a project\'s manuscript.',
      inputSchema: {
        id: z.string().describe('Project id'),
        outputFormat: z.enum(['docx', 'epub', 'pdf', 'md']).optional().describe('Default docx'),
        trimSize: z.string().optional().describe('e.g. "6x9"'),
        author: z.string().optional(),
      },
    },
    async ({ id, ...body }) =>
      toToolResult('format_pro', await client.request('POST', `/api/projects/${encodeURIComponent(id)}/format-pro`, body)),
  );

  server.registerTool('get_manuscript_hub',
    {
      title: 'Manuscript hub',
      description: 'Aggregated dashboard stats across all projects (word counts, progress, daily goal).',
      inputSchema: {},
    },
    async () => toToolResult('get_manuscript_hub', await client.request('GET', '/api/hub')),
  );
}
