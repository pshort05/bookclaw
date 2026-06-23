import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { BookClawClient } from '../bookclaw-client.js';
import { toToolResult } from './_shared.js';

export function registerExportTools(server: McpServer, client: BookClawClient): void {
  server.registerTool('compile_project',
    { title: 'Compile project', description: 'Compile a project\'s step outputs into a single manuscript.', inputSchema: { id: z.string() } },
    async ({ id }) =>
      toToolResult('compile_project', await client.request('POST', `/api/projects/${encodeURIComponent(id)}/compile`)),
  );

  server.registerTool('export_docx',
    { title: 'Export DOCX', description: 'Export a project as a KDP-ready DOCX file.', inputSchema: { id: z.string() } },
    async ({ id }) =>
      toToolResult('export_docx', await client.request('POST', `/api/projects/${encodeURIComponent(id)}/export-docx`)),
  );
}
