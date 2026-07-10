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
        // Flagship per-book knobs (Plans 2/5/6/8). Each maps to the same-named
        // body field POST /api/books reads; the gateway validates ranges/enums.
        preferredProvider: z.string().optional().describe('Default AI provider for this book (e.g. openrouter, claude, gemini)'),
        preferredModel: z.string().optional().describe('Default model id (required for OpenRouter, e.g. anthropic/claude-sonnet-4.6)'),
        contentCeiling: z.object({ spice: z.number(), violence: z.number() }).optional().describe('Author-branded content ceiling; spice/violence each 0-10 (heat/uncensored routing)'),
        uncensoredProvider: z.enum(['grok', 'venice', 'auto']).optional().describe('Pin the uncensored provider for erotica-threshold scenes (auto = use the genre heat ladder)'),
        reviewCadence: z.enum(['per_act', 'per_chapter', 'outline_only', 'autonomous']).optional().describe('Human-review gate cadence for the pipeline'),
        costBudget: z.number().optional().describe('Per-book AI spend cap in USD; generation pauses when exceeded'),
        ensemble: z.object({ enabled: z.boolean().optional(), panel: z.array(z.string()).optional() }).optional().describe('Opt-in ideation ensemble (multi-model divergent premise). panel defaults to the genre sheet, e.g. ["gpt","grok","gemini","claude"]'),
        // Romance Workflow Foundation: optional author seeds, developed by the
        // pipeline's front half and preserved (never discarded).
        storyArc: z.string().optional().describe('Author-provided story arc, developed (not discarded) by the pipeline'),
        characters: z.string().optional().describe('Author-provided character notes, developed (not discarded) by the pipeline'),
        setting: z.string().optional().describe('Author-provided real-world setting notes (place/sensory texture), developed (not discarded) by the pipeline'),
        blueprint: z.string().optional().describe('Author-provided structural blueprint (act breakdown, POV strategy, ending); honored by the outline step, developed (not discarded) by the pipeline'),
        councilSelection: z.enum(['auto', 'propose']).optional().describe('Reserved for the LLM Council sub-project; inert in Foundation'),
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

  server.registerTool('premise_intake',
    {
      title: 'Premise intake',
      description: 'Parse a free-form romance premise document into structured seeds, gaps, and a fact-checked setting dossier for review before creating a book.',
      inputSchema: { premise: z.string().describe('The premise markdown document') },
    },
    async (args) => toToolResult('premise_intake', await client.request('POST', '/api/books/intake', args)),
  );

  server.registerTool('romance_interview',
    { title: 'Romance adaptive interview',
      description: 'Run one turn of the romance Adaptive Interview: given the conversation so far, returns the AI\'s next question, or when enough is gathered, done=true plus the structured romance seed contract. Stateless — hold the messages array client-side and pass it back each turn.',
      inputSchema: { messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() })).describe('The conversation so far (empty for the opening turn)') } },
    async (args) => toToolResult('romance_interview', await client.request('POST', '/api/romance/interview', args)),
  );
}
