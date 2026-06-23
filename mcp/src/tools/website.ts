import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { BookClawClient } from '../bookclaw-client.js';
import { toToolResult } from './_shared.js';

// Author-website registry: sites, their books, and blog posts, plus render. The
// confirmation-gated deploy/publish/finalize endpoints stay on the escape hatch
// (they create approval requests that a human resolves in BookClaw).
export function registerWebsiteTools(server: McpServer, client: BookClawClient): void {
  const siteId = z.string().describe('Site id');

  server.registerTool('list_sites',
    { title: 'List sites', description: 'List all author websites.', inputSchema: {} },
    async () => toToolResult('list_sites', await client.request('GET', '/api/sites')),
  );

  server.registerTool('get_site',
    { title: 'Get site', description: 'Get one site by id.', inputSchema: { siteId } },
    async ({ siteId }) => toToolResult('get_site', await client.request('GET', `/api/sites/${encodeURIComponent(siteId)}`)),
  );

  server.registerTool('create_site',
    {
      title: 'Create site',
      description: 'Create an author website. config must include slug, siteName, authorName, baseUrl.',
      inputSchema: {
        config: z.record(z.unknown()).describe('Site config: { slug, siteName, authorName, baseUrl, … }'),
        linkedProjectIds: z.array(z.string()).optional(),
        deploy: z.record(z.unknown()).optional().describe('Deploy target config (does not deploy)'),
      },
    },
    async (args) => toToolResult('create_site', await client.request('POST', '/api/sites', args)),
  );

  server.registerTool('update_site',
    {
      title: 'Update site',
      description: 'Update a site (partial patch).',
      inputSchema: { siteId, patch: z.record(z.unknown()).describe('Fields to update') },
    },
    async ({ siteId, patch }) =>
      toToolResult('update_site', await client.request('PATCH', `/api/sites/${encodeURIComponent(siteId)}`, patch)),
  );

  server.registerTool('delete_site',
    { title: 'Delete site', description: 'Delete a site.', inputSchema: { siteId } },
    async ({ siteId }) => toToolResult('delete_site', await client.request('DELETE', `/api/sites/${encodeURIComponent(siteId)}`)),
  );

  server.registerTool('add_site_book',
    {
      title: 'Add site book',
      description: 'Add or replace a book on a site. book must include title and blurb.',
      inputSchema: { siteId, book: z.record(z.unknown()).describe('Book fields: { title, blurb, … }') },
    },
    async ({ siteId, book }) =>
      toToolResult('add_site_book', await client.request('POST', `/api/sites/${encodeURIComponent(siteId)}/books`, book)),
  );

  server.registerTool('remove_site_book',
    {
      title: 'Remove site book',
      description: 'Remove a book from a site by slug.',
      inputSchema: { siteId, bookSlug: z.string() },
    },
    async ({ siteId, bookSlug }) =>
      toToolResult('remove_site_book',
        await client.request('DELETE', `/api/sites/${encodeURIComponent(siteId)}/books/${encodeURIComponent(bookSlug)}`)),
  );

  server.registerTool('add_blog_post',
    {
      title: 'Add blog post',
      description: 'Add a blog post to a site. post must include title and bodyHTML.',
      inputSchema: { siteId, post: z.record(z.unknown()).describe('Post fields: { title, bodyHTML, slug?, date? }') },
    },
    async ({ siteId, post }) =>
      toToolResult('add_blog_post', await client.request('POST', `/api/sites/${encodeURIComponent(siteId)}/blog-posts`, post)),
  );

  server.registerTool('remove_blog_post',
    {
      title: 'Remove blog post',
      description: 'Remove a blog post from a site by slug.',
      inputSchema: { siteId, postSlug: z.string() },
    },
    async ({ siteId, postSlug }) =>
      toToolResult('remove_blog_post',
        await client.request('DELETE', `/api/sites/${encodeURIComponent(siteId)}/blog-posts/${encodeURIComponent(postSlug)}`)),
  );

  server.registerTool('draft_blog_post',
    {
      title: 'Draft blog post',
      description: 'AI-draft a blog post from a project. Optionally queue it onto a site.',
      inputSchema: {
        postType: z.enum(['release_announcement', 'behind_the_scenes', 'excerpt', 'teaser']),
        projectId: z.string(),
        excerptText: z.string().optional(),
        authorAngle: z.string().optional(),
        preferredProvider: z.string().optional(),
        siteId: z.string().optional().describe('If set, auto-add the draft to this site\'s blog queue'),
      },
    },
    async (args) => toToolResult('draft_blog_post', await client.request('POST', '/api/blog-posts/draft', args)),
  );

  server.registerTool('render_site',
    {
      title: 'Render site',
      description: 'Render a site\'s HTML (does not deploy).',
      inputSchema: { siteId },
    },
    async ({ siteId }) => toToolResult('render_site', await client.request('POST', `/api/sites/${encodeURIComponent(siteId)}/render`)),
  );
}
