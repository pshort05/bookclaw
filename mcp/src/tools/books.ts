import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { BookClawClient } from '../bookclaw-client.js';
import { toToolResult } from './_shared.js';

export function registerBookTools(server: McpServer, client: BookClawClient): void {
  server.registerTool('list_books',
    { title: 'List books', description: 'List all books with their state and suggested next action.', inputSchema: {} },
    async () => toToolResult('list_books', await client.request('GET', '/api/books')),
  );

  server.registerTool('get_book',
    { title: 'Get book', description: 'Get one book by slug.', inputSchema: { slug: z.string().describe('Book slug') } },
    async ({ slug }) => toToolResult('get_book', await client.request('GET', `/api/books/${encodeURIComponent(slug)}`)),
  );

  server.registerTool('create_book',
    {
      title: 'Create book',
      description: 'Create a new book, pulling author/voice/genre/pipeline templates from the library. Optionally declare a format (structure × form × chapter count × words-per-chapter); the total is hard-blocked outside the form\'s word band.',
      inputSchema: {
        title: z.string().describe('Book title'),
        author: z.string().optional().describe('Library author name'),
        voice: z.string().optional().describe('Library voice name'),
        genre: z.string().optional().describe('Library genre name'),
        pipeline: z.string().optional().describe('Library pipeline name'),
        // Book format (all-or-nothing; supply together to declare a format).
        structure: z.string().optional().describe('Story structure id (see list_structures), or "custom"'),
        form: z.string().optional().describe('Story form id (see list_forms)'),
        chapterCount: z.number().optional().describe('Number of chapters'),
        wordsPerChapter: z.number().optional().describe('Target words per chapter'),
      },
    },
    async (args) => toToolResult('create_book', await client.request('POST', '/api/books', args)),
  );

  server.registerTool('set_active_book',
    { title: 'Set active book', description: 'Set the global active book by slug.', inputSchema: { slug: z.string() } },
    async ({ slug }) => toToolResult('set_active_book', await client.request('POST', '/api/books/active', { slug })),
  );

  server.registerTool('get_book_files',
    { title: 'List book files', description: 'List the generated output files of a book.', inputSchema: { slug: z.string() } },
    async ({ slug }) => toToolResult('get_book_files', await client.request('GET', `/api/books/${encodeURIComponent(slug)}/files`)),
  );

  server.registerTool('read_book_file',
    {
      title: 'Read book file',
      description: 'Read one output file of a book by filename.',
      inputSchema: { slug: z.string(), filename: z.string() },
    },
    async ({ slug, filename }) =>
      toToolResult('read_book_file',
        await client.request('GET', `/api/books/${encodeURIComponent(slug)}/files/${encodeURIComponent(filename)}`)),
  );
}
