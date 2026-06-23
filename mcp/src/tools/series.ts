import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { BookClawClient } from '../bookclaw-client.js';
import { toToolResult } from './_shared.js';

// A library asset ref: a name to set, or null to clear it.
const REF = z.union([z.string(), z.null()]);

export function registerSeriesTools(server: McpServer, client: BookClawClient): void {
  server.registerTool('list_series',
    { title: 'List series', description: 'List all series.', inputSchema: {} },
    async () => toToolResult('list_series', await client.request('GET', '/api/series')),
  );

  server.registerTool('create_series',
    {
      title: 'Create series',
      description: 'Create a new series.',
      inputSchema: { title: z.string().describe('Series title (required)'), description: z.string().optional() },
    },
    async (args) => toToolResult('create_series', await client.request('POST', '/api/series', args)),
  );

  server.registerTool('update_series',
    {
      title: 'Update series',
      description: 'Update a series title or description.',
      inputSchema: { id: z.string(), title: z.string().optional(), description: z.string().optional() },
    },
    async ({ id, ...patch }) =>
      toToolResult('update_series', await client.request('PUT', `/api/series/${encodeURIComponent(id)}`, patch)),
  );

  server.registerTool('set_series_refs',
    {
      title: 'Set series asset refs',
      description: 'Set the library author/voice/genre/pipeline a series shares. Pass a name to set, or null to clear.',
      inputSchema: {
        id: z.string(),
        author: REF.optional(),
        voice: REF.optional(),
        genre: REF.optional(),
        pipeline: REF.optional(),
      },
    },
    async ({ id, ...refs }) =>
      toToolResult('set_series_refs', await client.request('PUT', `/api/series/${encodeURIComponent(id)}/refs`, refs)),
  );

  server.registerTool('get_series_worldbuilding',
    {
      title: 'Get series worldbuilding',
      description: 'Get the shared characters/places/lore for a series.',
      inputSchema: { id: z.string() },
    },
    async ({ id }) =>
      toToolResult('get_series_worldbuilding', await client.request('GET', `/api/series/${encodeURIComponent(id)}/worldbuilding`)),
  );

  server.registerTool('set_series_worldbuilding',
    {
      title: 'Set series worldbuilding',
      description: 'Set the shared characters/places/lore markdown for a series.',
      inputSchema: {
        id: z.string(),
        characters: z.string().optional(),
        places: z.string().optional(),
        lore: z.string().optional(),
      },
    },
    async ({ id, ...files }) =>
      toToolResult('set_series_worldbuilding', await client.request('PUT', `/api/series/${encodeURIComponent(id)}/worldbuilding`, files)),
  );

  server.registerTool('add_book_to_series',
    {
      title: 'Add book to series',
      description: 'Add an existing book (by slug) to a series.',
      inputSchema: { id: z.string(), slug: z.string() },
    },
    async ({ id, slug }) =>
      toToolResult('add_book_to_series', await client.request('POST', `/api/series/${encodeURIComponent(id)}/add-book`, { slug })),
  );

  server.registerTool('remove_book_from_series',
    {
      title: 'Remove book from series',
      description: 'Remove a book (by slug) from a series.',
      inputSchema: { id: z.string(), slug: z.string() },
    },
    async ({ id, slug }) =>
      toToolResult('remove_book_from_series', await client.request('POST', `/api/series/${encodeURIComponent(id)}/remove-book`, { slug })),
  );

  server.registerTool('set_series_reading_order',
    {
      title: 'Set series reading order',
      description: 'Set the ordered list of book slugs for a series.',
      inputSchema: { id: z.string(), order: z.array(z.string()).describe('Book slugs in reading order') },
    },
    async ({ id, order }) =>
      toToolResult('set_series_reading_order', await client.request('POST', `/api/series/${encodeURIComponent(id)}/reading-order`, { order })),
  );

  server.registerTool('get_series_report',
    {
      title: 'Get series report',
      description: 'Get a continuity/status report across the books in a series.',
      inputSchema: { id: z.string() },
    },
    async ({ id }) =>
      toToolResult('get_series_report', await client.request('GET', `/api/series/${encodeURIComponent(id)}/report`)),
  );

  server.registerTool('get_series_divergence',
    {
      title: 'Get series divergence',
      description: 'Compare a book\'s assets against the series to see where they diverge.',
      inputSchema: { id: z.string(), slug: z.string() },
    },
    async ({ id, slug }) =>
      toToolResult('get_series_divergence',
        await client.request('GET', `/api/series/${encodeURIComponent(id)}/divergence/${encodeURIComponent(slug)}`)),
  );

  server.registerTool('delete_series',
    { title: 'Delete series', description: 'Delete a series.', inputSchema: { id: z.string() } },
    async ({ id }) => toToolResult('delete_series', await client.request('DELETE', `/api/series/${encodeURIComponent(id)}`)),
  );
}
