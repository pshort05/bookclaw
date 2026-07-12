import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { BookClawClient } from '../bookclaw-client.js';
import { toToolResult } from './_shared.js';

// Marketing + launch planning. All endpoints here are advisory (propose / draft /
// plan / analyze) and not confirmation-gated. The gated website deploy/publish and
// the universal-disclosure helpers stay on the escape hatch.
export function registerMarketingTools(server: McpServer, client: BookClawClient): void {
  // ── Launch orchestrator ──
  server.registerTool('list_launches',
    { title: 'List launches', description: 'List all book launches.', inputSchema: {} },
    async () => toToolResult('list_launches', await client.request('GET', '/api/launches')),
  );

  server.registerTool('create_launch',
    {
      title: 'Create launch',
      description: 'Create a launch plan for a project.',
      inputSchema: {
        projectId: z.string(),
        bookTitle: z.string(),
        authorName: z.string(),
        targetReleaseDate: z.string().describe('ISO date'),
        metadata: z.record(z.unknown()).optional(),
      },
    },
    async (args) => toToolResult('create_launch', await client.request('POST', '/api/launches', args)),
  );

  server.registerTool('get_launch',
    { title: 'Get launch', description: 'Get one launch with its plan.', inputSchema: { id: z.string() } },
    async ({ id }) => toToolResult('get_launch', await client.request('GET', `/api/launches/${encodeURIComponent(id)}`)),
  );

  server.registerTool('update_launch',
    {
      title: 'Update launch',
      description: 'Update a launch\'s metadata.',
      inputSchema: { id: z.string(), metadata: z.record(z.unknown()).describe('Metadata to merge') },
    },
    async ({ id, metadata }) =>
      toToolResult('update_launch', await client.request('PATCH', `/api/launches/${encodeURIComponent(id)}`, { metadata })),
  );

  server.registerTool('propose_launch_step',
    {
      title: 'Propose launch step',
      description: 'Propose the content for a launch phase.',
      inputSchema: { id: z.string(), phase: z.string().describe('Launch phase id') },
    },
    async ({ id, phase }) =>
      toToolResult('propose_launch_step', await client.request('POST', `/api/launches/${encodeURIComponent(id)}/propose-step`, { phase })),
  );

  server.registerTool('delete_launch',
    { title: 'Delete launch', description: 'Delete a launch.', inputSchema: { id: z.string() } },
    async ({ id }) => toToolResult('delete_launch', await client.request('DELETE', `/api/launches/${encodeURIComponent(id)}`)),
  );

  // ── Amazon Ads (AMS) ──
  server.registerTool('propose_ams_campaigns',
    {
      title: 'Propose AMS campaigns',
      description: 'Propose Amazon Ads campaigns within a daily budget ceiling.',
      inputSchema: {
        bookTitle: z.string(),
        genre: z.string(),
        keywords: z.array(z.string()),
        dailyBudgetCeilingUSD: z.number(),
      },
    },
    async (args) => toToolResult('propose_ams_campaigns', await client.request('POST', '/api/ams/propose-campaigns', args)),
  );

  server.registerTool('optimize_ams',
    {
      title: 'Optimize AMS',
      description: 'Recommend AMS bid/budget adjustments from campaign performance.',
      inputSchema: {
        performance: z.array(z.record(z.unknown())).describe('Per-campaign/keyword performance rows'),
        acosTargetPct: z.number(),
        dailyBudgetCeilingUSD: z.number(),
        currentDailySpendUSD: z.number(),
      },
    },
    async (args) => toToolResult('optimize_ams', await client.request('POST', '/api/ams/optimize', args)),
  );

  // ── BookBub ──
  server.registerTool('draft_bookbub_ad',
    {
      title: 'Draft BookBub ad',
      description: 'Draft a BookBub ad from the book details and Amazon blurb.',
      inputSchema: { title: z.string(), authorName: z.string(), genre: z.string(), amazonBlurb: z.string() },
    },
    async (args) => toToolResult('draft_bookbub_ad', await client.request('POST', '/api/bookbub/draft', args)),
  );

  // ── Release calendar ──
  server.registerTool('list_calendar',
    {
      title: 'List calendar',
      description: 'List release-calendar events (optionally filtered) and at-risk items.',
      inputSchema: {
        projectId: z.string().optional(),
        category: z.string().optional(),
        from: z.string().optional().describe('ISO date'),
        to: z.string().optional().describe('ISO date'),
      },
    },
    async (filters) => {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(filters)) if (v !== undefined) qs.set(k, String(v));
      const suffix = qs.toString() ? `?${qs.toString()}` : '';
      return toToolResult('list_calendar', await client.request('GET', `/api/calendar${suffix}`));
    },
  );

  server.registerTool('create_calendar_event',
    {
      title: 'Create calendar event',
      description: 'Create a release-calendar event.',
      inputSchema: { event: z.record(z.unknown()).describe('Event fields (title, date, category, projectId, …)') },
    },
    async ({ event }) => toToolResult('create_calendar_event', await client.request('POST', '/api/calendar', event)),
  );

  server.registerTool('plan_price_pulse',
    {
      title: 'Plan price pulse',
      description: 'Build and add a price-promotion plan around a release.',
      inputSchema: {
        projectId: z.string(),
        bookTitle: z.string(),
        releaseDate: z.string().describe('ISO date'),
        launchPrice: z.number().optional(),
        tailPrice: z.number().optional(),
      },
    },
    async (args) => toToolResult('plan_price_pulse', await client.request('POST', '/api/calendar/price-pulse-plan', args)),
  );

  server.registerTool('update_calendar_event',
    {
      title: 'Update calendar event',
      description: 'Update a release-calendar event.',
      inputSchema: { id: z.string(), patch: z.record(z.unknown()).describe('Fields to update') },
    },
    async ({ id, patch }) =>
      toToolResult('update_calendar_event', await client.request('PATCH', `/api/calendar/${encodeURIComponent(id)}`, patch)),
  );

  server.registerTool('delete_calendar_event',
    { title: 'Delete calendar event', description: 'Delete a release-calendar event.', inputSchema: { id: z.string() } },
    async ({ id }) => toToolResult('delete_calendar_event', await client.request('DELETE', `/api/calendar/${encodeURIComponent(id)}`)),
  );

  // ── Reader intel ──
  server.registerTool('analyze_reader_intel',
    {
      title: 'Analyze reader intel',
      description: 'Sanitize and analyze a set of reader reviews.',
      inputSchema: { reviews: z.array(z.string()).describe('Raw review texts') },
    },
    async (args) => toToolResult('analyze_reader_intel', await client.request('POST', '/api/reader-intel/analyze', args)),
  );

  // ── Reader panel ──
  server.registerTool('run_reader_panel',
    {
      title: 'Run reader panel',
      description: 'Rank candidate marketing copy (blurb/hook/title/opening) against a panel of reader personas, with anti-slop guards.',
      inputSchema: {
        kind: z.enum(['blurb', 'hook', 'title', 'opening']),
        candidates: z.array(z.string()).describe('Candidate texts to rank (2+ recommended)'),
        personas: z.array(z.object({ id: z.string(), label: z.string(), lens: z.string() })).optional()
          .describe('Optional custom reader personas; defaults to a built-in panel'),
      },
    },
    async (args) => toToolResult('run_reader_panel', await client.request('POST', '/api/reader-panel/run', args)),
  );

  // ── Translation ──
  server.registerTool('plan_translation',
    {
      title: 'Plan translation',
      description: 'Plan translation cost/effort for target languages.',
      inputSchema: {
        projectId: z.string(),
        bookTitle: z.string(),
        targetLangs: z.array(z.string()),
        estimatedWordCount: z.number(),
        sourceLang: z.string().optional(),
      },
    },
    async (args) => toToolResult('plan_translation', await client.request('POST', '/api/translation/plan', args)),
  );
}
