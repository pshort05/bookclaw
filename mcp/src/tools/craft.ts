import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { BookClawClient } from '../bookclaw-client.js';
import { toToolResult } from './_shared.js';

// Manuscript analysis / feedback tools. Most operate on a project by id and read
// its completed chapters server-side. Beta-reader and continuity-check run
// asynchronously on BookClaw and return a "started" acknowledgement; fetch the
// result with the matching get_* tool once the run finishes.
export function registerCraftTools(server: McpServer, client: BookClawClient): void {
  const pid = z.string().describe('Project id');

  // ── Beta reader ──
  server.registerTool('list_beta_archetypes',
    { title: 'List beta-reader archetypes', description: 'List the available AI beta-reader archetypes.', inputSchema: {} },
    async () => toToolResult('list_beta_archetypes', await client.request('GET', '/api/beta-reader/archetypes')),
  );

  server.registerTool('run_beta_reader',
    {
      title: 'Run beta reader',
      description: 'Start the AI beta-reader panel on a project (runs async). Fetch results with get_beta_reader_report.',
      inputSchema: { id: pid, archetypes: z.array(z.string()).optional().describe('Subset of archetype ids; omit for all') },
    },
    async ({ id, archetypes }) =>
      toToolResult('run_beta_reader',
        await client.request('POST', `/api/projects/${encodeURIComponent(id)}/beta-reader`, archetypes ? { archetypes } : {})),
  );

  server.registerTool('get_beta_reader_report',
    { title: 'Get beta-reader report', description: 'Get the stored beta-reader report for a project (null if not run yet).', inputSchema: { id: pid } },
    async ({ id }) =>
      toToolResult('get_beta_reader_report', await client.request('GET', `/api/projects/${encodeURIComponent(id)}/beta-reader/report`)),
  );

  // ── Single-pass analyzers ──
  server.registerTool('dialogue_audit',
    { title: 'Dialogue audit', description: 'Audit dialogue across a project\'s manuscript.', inputSchema: { id: pid } },
    async ({ id }) => toToolResult('dialogue_audit', await client.request('POST', `/api/projects/${encodeURIComponent(id)}/dialogue-audit`)),
  );

  server.registerTool('pacing_heatmap',
    { title: 'Pacing heatmap', description: 'Generate a pacing heatmap (manuscript autopsy) for a project.', inputSchema: { id: pid } },
    async ({ id }) => toToolResult('pacing_heatmap', await client.request('POST', `/api/projects/${encodeURIComponent(id)}/pacing-heatmap`)),
  );

  server.registerTool('craft_critique',
    { title: 'Craft critique', description: 'Run a line/scene-level craft critique across a project\'s chapters.', inputSchema: { id: pid } },
    async ({ id }) => toToolResult('craft_critique', await client.request('POST', `/api/projects/${encodeURIComponent(id)}/craft-critique`)),
  );

  // ── Prose evolver (GEPA-style score→reflect→revise loop) ──
  server.registerTool('evolve_prose',
    {
      title: 'Evolve prose',
      description: 'Iteratively improve a prose passage against the writing judge via a score→reflect→revise loop. Keeps only non-regressing revisions (Pareto floor); stops early on a plateau.',
      inputSchema: {
        text: z.string().describe('The prose passage to evolve'),
        brief: z.string().optional().describe('What the passage is trying to do — steers reflection'),
        rounds: z.number().optional().describe('Number of evolution rounds (default 3, clamped to 1-5)'),
        bookSlug: z.string().optional().describe('Book slug, for author-voice grounding'),
      },
    },
    async (args) => toToolResult('evolve_prose', await client.request('POST', '/api/prose/evolve', args)),
  );

  // ── Continuity ──
  server.registerTool('continuity_check',
    {
      title: 'Continuity check',
      description: 'Start an async continuity check on a project. Fetch results with get_continuity_report.',
      inputSchema: { id: pid },
    },
    async ({ id }) => toToolResult('continuity_check', await client.request('POST', `/api/projects/${encodeURIComponent(id)}/continuity-check`)),
  );

  server.registerTool('get_continuity_report',
    { title: 'Get continuity report', description: 'Get the stored continuity report for a project (null if not run yet).', inputSchema: { id: pid } },
    async ({ id }) =>
      toToolResult('get_continuity_report', await client.request('GET', `/api/projects/${encodeURIComponent(id)}/continuity-report`)),
  );

  // ── Story structure ──
  server.registerTool('list_structures',
    { title: 'List story structures', description: 'List the known story structures.', inputSchema: {} },
    async () => toToolResult('list_structures', await client.request('GET', '/api/structures')),
  );

  server.registerTool('list_forms',
    { title: 'List story forms', description: 'List the story forms (flash/short-story/novella/novel/epic/serial/pulp) with their word bands.', inputSchema: {} },
    async () => toToolResult('list_forms', await client.request('GET', '/api/forms')),
  );

  server.registerTool('recommend_structure',
    {
      title: 'Recommend structure',
      description: 'Recommend story structures for a genre.',
      inputSchema: { genre: z.string().describe('Genre (required)'), subgenre: z.string().optional(), description: z.string().optional() },
    },
    async (args) => toToolResult('recommend_structure', await client.request('POST', '/api/structures/recommend', args)),
  );

  server.registerTool('check_outline_structure',
    {
      title: 'Check outline against structure',
      description: 'Check a list of chapter-summary strings against a named story structure.',
      inputSchema: {
        outline: z.array(z.string()).describe('Chapter summary strings'),
        structureId: z.string().describe('Structure id to check against'),
      },
    },
    async (args) => toToolResult('check_outline_structure', await client.request('POST', '/api/structures/check-outline', args)),
  );

  server.registerTool('structure_check',
    {
      title: 'Project structure check',
      description: 'Recommend + check structure from a project\'s own outline (falls back to the supplied outline/genre).',
      inputSchema: {
        id: pid,
        outline: z.array(z.string()).optional(),
        genre: z.string().optional(),
      },
    },
    async ({ id, ...body }) =>
      toToolResult('structure_check', await client.request('POST', `/api/projects/${encodeURIComponent(id)}/structure-check`, body)),
  );

  // ── Plot promises ──
  server.registerTool('get_plot_promises',
    { title: 'Get plot promises', description: 'Get the tracked plot promises for a project.', inputSchema: { id: pid } },
    async ({ id }) => toToolResult('get_plot_promises', await client.request('GET', `/api/projects/${encodeURIComponent(id)}/plot-promises`)),
  );

  server.registerTool('extract_plot_promises',
    {
      title: 'Extract plot promises',
      description: 'Extract plot promises from a project\'s opening chapters (or supplied openingText).',
      inputSchema: {
        id: pid,
        openingText: z.string().optional().describe('Override text; defaults to the first 1-3 completed chapters'),
        merge: z.boolean().optional().describe('Merge with existing promises (default true)'),
      },
    },
    async ({ id, ...body }) =>
      toToolResult('extract_plot_promises', await client.request('POST', `/api/projects/${encodeURIComponent(id)}/plot-promises/extract`, body)),
  );

  server.registerTool('audit_plot_promises',
    {
      title: 'Audit plot promises',
      description: 'Audit which plot promises are unkept/at risk for a project.',
      inputSchema: {
        id: pid,
        progress: z.number().optional().describe('Progress percent (default: project progress or 100)'),
        riskThreshold: z.number().optional().describe('Risk threshold percent (default 80)'),
      },
    },
    async ({ id, progress, riskThreshold }) => {
      const qs = new URLSearchParams();
      if (progress !== undefined) qs.set('progress', String(progress));
      if (riskThreshold !== undefined) qs.set('riskThreshold', String(riskThreshold));
      const suffix = qs.toString() ? `?${qs.toString()}` : '';
      return toToolResult('audit_plot_promises',
        await client.request('GET', `/api/projects/${encodeURIComponent(id)}/plot-promises/audit${suffix}`));
    },
  );

  // ── Book format & structure review (per-book; declared at creation) ──
  const slug = z.string().describe('Book slug');

  server.registerTool('get_structure_review',
    { title: 'Get structure review', description: 'Get the book\'s structure review (beat→outline mapping vs its declared structure). Returns {configured:false} if no format was declared.', inputSchema: { slug } },
    async ({ slug: s }) => toToolResult('get_structure_review', await client.request('GET', `/api/books/${encodeURIComponent(s)}/structure-review`)),
  );

  server.registerTool('propose_structure_review',
    { title: 'Propose structure review', description: 'Have the AI propose a beat→outline mapping for the book\'s declared structure (then confirm with save_structure_review).', inputSchema: { slug } },
    async ({ slug: s }) => toToolResult('propose_structure_review', await client.request('POST', `/api/books/${encodeURIComponent(s)}/structure-review/propose`, {})),
  );

  server.registerTool('save_structure_review',
    {
      title: 'Save structure review',
      description: 'Persist the author-confirmed beat→outline mapping (and optional custom structure) for a book.',
      inputSchema: {
        slug,
        mapping: z.array(z.record(z.unknown())).optional().describe('Beat→chapter mapping entries'),
        customStructure: z.record(z.unknown()).optional().describe('Custom structure definition (when structure is "custom")'),
      },
    },
    async ({ slug: s, ...body }) =>
      toToolResult('save_structure_review', await client.request('PUT', `/api/books/${encodeURIComponent(s)}/structure-review`, body)),
  );

  server.registerTool('get_length_review',
    { title: 'Get length review', description: 'Get the book\'s length review (per-chapter actual vs target, form-band + genre-norm checks). {configured:false} if no format.', inputSchema: { slug } },
    async ({ slug: s }) => toToolResult('get_length_review', await client.request('GET', `/api/books/${encodeURIComponent(s)}/length-review`)),
  );

  server.registerTool('set_length_targets',
    {
      title: 'Set per-chapter length targets',
      description: 'Override per-chapter word targets for a book (re-validated against the form band).',
      inputSchema: { slug, overrides: z.record(z.number()).describe('Map of chapter key → target word count') },
    },
    async ({ slug: s, overrides }) =>
      toToolResult('set_length_targets', await client.request('PUT', `/api/books/${encodeURIComponent(s)}/length-targets`, { overrides })),
  );

  // ── Consistency auditor (per-book fact ledger) ──
  server.registerTool('consistency_audit',
    {
      title: 'Run consistency audit',
      description: 'Run the per-book consistency audit (fact-ledger continuity check) against the manuscript + canon. Runs async; fetch with get_consistency_report. Needs a large-context model (gemini/claude/openai/deepseek/openrouter); Ollama is rejected. Returns 422 if no capable provider is configured.',
      inputSchema: {
        slug,
        provider: z.string().optional().describe('Per-run AI provider override (gemini|claude|openai|deepseek|openrouter — NOT ollama)'),
        model: z.string().optional().describe('Per-run AI model override (this run only)'),
      },
    },
    async ({ slug: s, ...body }) =>
      toToolResult('consistency_audit', await client.request('POST', `/api/books/${encodeURIComponent(s)}/consistency-audit`, body)),
  );

  server.registerTool('set_consistency_model',
    {
      title: 'Set consistency audit model',
      description: 'Save the per-book default AI provider/model for the consistency audit. Omit both to clear the saved default. Must be a large-context provider (gemini/claude/openai/deepseek/openrouter); Ollama is rejected.',
      inputSchema: {
        slug,
        provider: z.string().optional().describe('AI provider (gemini|claude|openai|deepseek|openrouter — NOT ollama; omit to clear)'),
        model: z.string().optional().describe('AI model (omit to clear)'),
      },
    },
    async ({ slug: s, ...body }) =>
      toToolResult('set_consistency_model', await client.request('PUT', `/api/books/${encodeURIComponent(s)}/consistency-model`, body)),
  );

  server.registerTool('get_consistency_report',
    { title: 'Get consistency report', description: 'Get the stored consistency report for a book (null if not run yet).', inputSchema: { slug } },
    async ({ slug: s }) => toToolResult('get_consistency_report', await client.request('GET', `/api/books/${encodeURIComponent(s)}/consistency-report`)),
  );

  // ── Try-Fail & Escalation auditor (per-book; synchronous) ──
  server.registerTool('audit_try_fail',
    {
      title: 'Run try-fail & escalation audit',
      description: 'Run the per-book Try-Fail & Escalation audit: detects try-fail cycles, checks early attempts genuinely fail, verifies each conflict deepens/broadens, flags too-easy resolutions, and runs a crucible check. Synchronous — returns the TryFailReport directly. Shares the consistency large-context model selection (gemini/claude/openai/deepseek/openrouter; Ollama rejected). Returns 422 if no capable provider is configured.',
      inputSchema: {
        slug,
        provider: z.string().optional().describe('Per-run AI provider override (gemini|claude|openai|deepseek|openrouter — NOT ollama)'),
        model: z.string().optional().describe('Per-run AI model override (this run only)'),
      },
    },
    async ({ slug: s, ...body }) =>
      toToolResult('audit_try_fail', await client.request('POST', `/api/books/${encodeURIComponent(s)}/try-fail-audit`, body)),
  );

  server.registerTool('get_try_fail_report',
    { title: 'Get try-fail report', description: 'Get the stored try-fail & escalation report for a book (null if not run yet).', inputSchema: { slug } },
    async ({ slug: s }) => toToolResult('get_try_fail_report', await client.request('GET', `/api/books/${encodeURIComponent(s)}/try-fail-report`)),
  );

  // ── Consistency apply-fix (propose → review → apply) ──
  server.registerTool('propose_consistency_fixes',
    {
      title: 'Propose consistency fixes',
      description: 'Propose surgical prose edits (temperature 0) that reconcile selected consistency findings. NO write — returns a preview of {proposals:[{findingId,category,entity,attribute,canonicalValue,targetChapter,oldPhrase,newPhrase,note,anchored}]}. Only phrase-swappable findings are fixable (contradiction/continuity/impossibility/canon-divergence); knowledge-violation ids are silently dropped. Confirm anchored edits, then apply with apply_consistency_fixes. Shares the consistency large-context model selection (gemini/claude/openai/deepseek/openrouter; Ollama rejected).',
      inputSchema: {
        slug,
        findingIds: z.array(z.string()).describe('Stable finding ids (from the consistency report) to propose fixes for'),
        provider: z.string().optional().describe('Per-run AI provider override (gemini|claude|openai|deepseek|openrouter — NOT ollama)'),
        model: z.string().optional().describe('Per-run AI model override (this run only)'),
      },
    },
    async ({ slug: s, ...body }) =>
      toToolResult('propose_consistency_fixes',
        await client.request('POST', `/api/books/${encodeURIComponent(s)}/consistency-fix/propose`, body)),
  );

  server.registerTool('apply_consistency_fixes',
    {
      title: 'Apply consistency fixes',
      description: 'Apply author-confirmed consistency edits deterministically (string find/replace; the model is never in the write path). Each edited chapter is version-snapshotted first, so every fix is revertible. Returns {applied[],skipped[],chaptersWritten[]}. Send only the edits you confirmed from propose_consistency_fixes.',
      inputSchema: {
        slug,
        edits: z.array(z.object({
          findingId: z.string(),
          targetChapter: z.string().describe('Chapter label of the chapter to edit'),
          oldPhrase: z.string().describe('Exact verbatim substring to replace'),
          newPhrase: z.string().describe('Replacement text'),
        })).describe('The confirmed edits to apply'),
      },
    },
    async ({ slug: s, ...body }) =>
      toToolResult('apply_consistency_fixes',
        await client.request('POST', `/api/books/${encodeURIComponent(s)}/consistency-fix/apply`, body)),
  );
}
