import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { BookClawClient } from '../bookclaw-client.js';
import { toToolResult } from './_shared.js';

// World Repository + per-book world binding. A "world" owns a repository of
// structured worldbuilding documents; a book binds to a world and pulls a
// relevant subset into its bible (and optionally renders some as appendixes).
export function registerWorldTools(server: McpServer, client: BookClawClient): void {
  const world = z.string().describe('World name');
  const slug = z.string().describe('Book slug');

  // ── World repository ──
  server.registerTool('list_worlds',
    { title: 'List worlds', description: 'List the worlds in the library.', inputSchema: {} },
    async () => toToolResult('list_worlds', await client.request('GET', '/api/worlds')),
  );

  server.registerTool('get_world',
    { title: 'Get world', description: 'Get one world\'s config (format, document types, domains).', inputSchema: { name: world } },
    async ({ name }) => toToolResult('get_world', await client.request('GET', `/api/worlds/${encodeURIComponent(name)}`)),
  );

  server.registerTool('list_world_documents',
    { title: 'List world documents', description: 'List a world\'s repository documents.', inputSchema: { name: world } },
    async ({ name }) => toToolResult('list_world_documents', await client.request('GET', `/api/worlds/${encodeURIComponent(name)}/documents`)),
  );

  server.registerTool('get_world_document',
    {
      title: 'Get world document',
      description: 'Get one world document by id.',
      inputSchema: { name: world, docId: z.string().describe('Document id') },
    },
    async ({ name, docId }) =>
      toToolResult('get_world_document', await client.request('GET', `/api/worlds/${encodeURIComponent(name)}/documents/${encodeURIComponent(docId)}`)),
  );

  server.registerTool('create_world_document',
    {
      title: 'Create world document',
      description: 'Create a world document. The server auto-classifies it. meta holds frontmatter (title, type, tags, …); body is the markdown.',
      inputSchema: {
        name: world,
        meta: z.record(z.unknown()).describe('Frontmatter object (e.g. { title, type, tags })'),
        body: z.string().describe('Markdown body'),
      },
    },
    async ({ name, meta, body }) =>
      toToolResult('create_world_document', await client.request('POST', `/api/worlds/${encodeURIComponent(name)}/documents`, { meta, body })),
  );

  server.registerTool('update_world_document',
    {
      title: 'Update world document',
      description: 'Replace a world document\'s frontmatter and body (full replacement, not a partial patch). meta must include a string "classification". Read the current doc with get_world_document first, then send the merged result.',
      inputSchema: {
        name: world,
        docId: z.string().describe('Document id'),
        meta: z.record(z.unknown()).describe('Full frontmatter object; must include a string "classification"'),
        body: z.string().describe('Full markdown body'),
      },
    },
    async ({ name, docId, meta, body }) =>
      toToolResult('update_world_document',
        await client.request('PUT', `/api/worlds/${encodeURIComponent(name)}/documents/${encodeURIComponent(docId)}`, { meta, body })),
  );

  server.registerTool('delete_world_document',
    {
      title: 'Delete world document',
      description: 'Delete a world document by id.',
      inputSchema: { name: world, docId: z.string().describe('Document id') },
    },
    async ({ name, docId }) =>
      toToolResult('delete_world_document', await client.request('DELETE', `/api/worlds/${encodeURIComponent(name)}/documents/${encodeURIComponent(docId)}`)),
  );

  // ── Per-book world binding ──
  server.registerTool('bind_book_world',
    {
      title: 'Bind book to a world',
      description: 'Bind a book to a world and auto-build its curated bible via relevance-pull.',
      inputSchema: { slug, world },
    },
    async ({ slug: s, world: w }) =>
      toToolResult('bind_book_world', await client.request('PUT', `/api/books/${encodeURIComponent(s)}/world`, { world: w })),
  );

  server.registerTool('unbind_book_world',
    { title: 'Unbind book world', description: 'Unbind a book from its world (clears the curated world docs).', inputSchema: { slug } },
    async ({ slug: s }) => toToolResult('unbind_book_world', await client.request('DELETE', `/api/books/${encodeURIComponent(s)}/world`)),
  );

  server.registerTool('propose_world_docs',
    {
      title: 'Propose world docs for a book',
      description: 'Relevance-pull: propose which of the bound world\'s documents are relevant to this book.',
      inputSchema: { slug },
    },
    async ({ slug: s }) => toToolResult('propose_world_docs', await client.request('POST', `/api/books/${encodeURIComponent(s)}/world/propose`, {})),
  );

  server.registerTool('set_world_docs',
    {
      title: 'Set book world docs',
      description: 'Set the curated world-document subset pulled into a book\'s bible.',
      inputSchema: {
        slug,
        world,
        docIds: z.array(z.string()).describe('World document ids to include'),
      },
    },
    async ({ slug: s, world: w, docIds }) =>
      toToolResult('set_world_docs', await client.request('PUT', `/api/books/${encodeURIComponent(s)}/world/docs`, { world: w, docIds })),
  );

  server.registerTool('set_world_appendix',
    {
      title: 'Set book world appendix',
      description: 'Set which world documents render as reader-facing appendixes in the book\'s exports.',
      inputSchema: {
        slug,
        appendix: z.array(z.object({ docId: z.string(), order: z.number() }).passthrough())
          .describe('Ordered appendix entries; each entry needs a string docId and a numeric order'),
      },
    },
    async ({ slug: s, appendix }) =>
      toToolResult('set_world_appendix', await client.request('PUT', `/api/books/${encodeURIComponent(s)}/world/appendix`, { appendix })),
  );
}
