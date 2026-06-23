import { api } from '@bookclaw/shared';
import type { StarterBundle } from '../data/bundles';
import { bundleToCreateBody } from './bundleBody';

// Resolve a sequence preset to its ordered pipeline list (mirrors NewBook.tsx).
export async function resolveSequencePipelines(sequence: string): Promise<string[]> {
  const r = await api<{ entry: { sequence?: { pipelines?: string[] }; content?: string } }>(
    `/api/library/sequence/${encodeURIComponent(sequence)}`,
  );
  const e = r.entry;
  if (e.sequence?.pipelines) return e.sequence.pipelines;
  if (typeof e.content === 'string') {
    try { return JSON.parse(e.content).pipelines ?? []; } catch { /* ignore */ }
  }
  return [];
}

// Create a book from a bundle preset. Returns the new book's slug.
// Generation is NOT started here: the wizard navigates to /write/:slug?autostart=1
// and the existing PipelineRail owns the single create->start->auto-run path, so
// the book has exactly one tracked project (no orphaned/duplicate runs).
export async function createBookFromBundle(bundle: StarterBundle, title: string): Promise<{ slug: string }> {
  const pipelines = await resolveSequencePipelines(bundle.sequence);
  const r = await api<{ book: { slug: string } }>('/api/books', {
    method: 'POST',
    body: JSON.stringify(bundleToCreateBody(bundle, title, pipelines)),
  });
  return { slug: r.book.slug };
}
