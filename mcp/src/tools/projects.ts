import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { BookClawClient } from '../bookclaw-client.js';
import { toToolResult } from './_shared.js';

export function registerProjectTools(server: McpServer, client: BookClawClient): void {
  server.registerTool('list_projects',
    { title: 'List projects', description: 'List known projects (id, title, status).', inputSchema: {} },
    async () => toToolResult('list_projects', await client.request('GET', '/api/projects/list')),
  );

  server.registerTool('get_project',
    { title: 'Get project', description: 'Get one project and its steps by id.', inputSchema: { id: z.string() } },
    async ({ id }) => toToolResult('get_project', await client.request('GET', `/api/projects/${encodeURIComponent(id)}`)),
  );

  server.registerTool('create_project',
    {
      title: 'Create project',
      description: 'Create and auto-execute a project. BookClaw plans steps from the title + description, or a template type if given.',
      inputSchema: {
        title: z.string().describe('Short project title'),
        description: z.string().describe('What to do, in plain language'),
        type: z.string().optional().describe('Optional project template/type id'),
      },
    },
    async (args) => toToolResult('create_project', await client.request('POST', '/api/projects/create', args)),
  );

  server.registerTool('create_pipeline',
    {
      title: 'Create pipeline',
      description: 'Create a full multi-phase book pipeline (planning → bible → production → revision → format → launch).',
      inputSchema: {
        title: z.string().describe('Short pipeline title'),
        description: z.string().describe('The book idea, in plain language'),
        personaId: z.string().optional().describe('Optional author persona id'),
      },
    },
    async (args) => toToolResult('create_pipeline', await client.request('POST', '/api/pipeline/create', args)),
  );

  server.registerTool('advance_pipeline',
    { title: 'Advance pipeline', description: 'Advance a pipeline to its next phase.', inputSchema: { pipelineId: z.string() } },
    async ({ pipelineId }) =>
      toToolResult('advance_pipeline', await client.request('POST', `/api/pipeline/${encodeURIComponent(pipelineId)}/advance`)),
  );

  server.registerTool('get_project_files',
    { title: 'List project files', description: 'List a project\'s output files.', inputSchema: { id: z.string() } },
    async ({ id }) =>
      toToolResult('get_project_files', await client.request('GET', `/api/projects/${encodeURIComponent(id)}/files`)),
  );
}
