/**
 * Grounding research (Flagship Plan 4, Task 1).
 *
 * Front-of-pipeline factual grounding: before the bible phase writes the
 * world-building document, look up sourced facts about the book's setting/
 * period/domain and inject them so the bible doesn't invent period-inaccurate
 * or domain-wrong detail. Reuses the two existing research services rather
 * than reimplementing lookup or citation extraction:
 *   - ResearchGate.search (research.ts) — free Wikipedia/Google Books search,
 *     used here for a quick supplementary reference list.
 *   - ResearchLookupService.lookup (research-lookup.ts) — the cited, synthesized
 *     answer (Perplexity direct/via-OpenRouter, or a disclosed no-web-access
 *     fallback) that becomes the bible-injection text.
 *
 * For "dark" genres (thriller/crime/mystery/horror/noir/true-crime) the query
 * is framed as "what is publicly documented, for fiction accuracy" rather than
 * a how-to — mirrors Plan 2's consequence-not-procedure principle so a
 * grounding lookup for e.g. a poisoning-mystery plot can't come back reading
 * like an operational manual.
 *
 * Fail-soft: a lookup failure or a "no verified sources" answer degrades to
 * an empty result (no citations file written) — grounding is best-effort and
 * must never block bible generation.
 */
import { join } from 'path';

export interface ResearchGateLike {
  search(query: string, maxResults?: number): Promise<{
    results: Array<{ title: string; url: string; snippet: string; source?: string }>;
    blocked: Array<{ url: string; reason: string }>;
    error?: string;
  }>;
}

export interface ResearchLookupLike {
  lookup(query: string, opts?: { maxWords?: number }): Promise<{
    query: string;
    answer: string;
    citations: Array<{ title: string; url?: string; source?: string }>;
    provider: string;
    hasVerifiedSources: boolean;
    estimatedCost: number;
  }>;
}

export interface GroundingSignals {
  setting?: string;
  period?: string;
  domain?: string;
  genre: string;
}

const DARK_GENRES = new Set([
  'thriller', 'crime', 'mystery', 'horror', 'dark fantasy', 'dark-fantasy', 'noir',
  'true crime', 'true-crime', 'psychological thriller', 'psychological-thriller',
]);

function buildQuery(signals: GroundingSignals): string {
  const topic = [signals.setting, signals.period, signals.domain].filter(Boolean).join(', ') || signals.genre;
  const isDark = DARK_GENRES.has(signals.genre.toLowerCase().trim());
  return isDark
    ? `Summarize what is publicly documented about ${topic} for fiction accuracy. Consequence-realistic detail only — no operational, step-by-step, or how-to procedure.`
    : `Research factual grounding details about ${topic} for a ${signals.genre} novel: setting, period-accurate detail, and domain facts a novelist should get right.`;
}

export async function runGroundingResearch(args: {
  slug: string;
  signals: GroundingSignals;
  research: ResearchGateLike;
  lookup: ResearchLookupLike;
  writeFile: (path: string, content: string) => Promise<void>;
  researchDir: string;
}): Promise<{ citedFacts: string; sources: string[] }> {
  const { slug, signals, research, lookup, writeFile, researchDir } = args;
  const query = buildQuery(signals);

  let quickRefs: Array<{ title: string; url: string }> = [];
  try {
    const searchResult = await research.search(query, 5);
    quickRefs = (searchResult?.results ?? []).map(r => ({ title: r.title, url: r.url }));
  } catch (err) {
    console.warn('  [grounding-research] search failed (non-fatal):', (err as Error)?.message || err);
  }

  let lookupResult;
  try {
    lookupResult = await lookup.lookup(query, { maxWords: 400 });
  } catch (err) {
    console.warn('  [grounding-research] lookup failed:', (err as Error)?.message || err);
    return { citedFacts: '', sources: [] };
  }

  if (!lookupResult.hasVerifiedSources || !lookupResult.answer?.trim()) {
    return { citedFacts: '', sources: [] };
  }

  const citedFacts = lookupResult.answer;
  const lookupUrls = lookupResult.citations.map(c => c.url).filter((u): u is string => !!u);
  const sources = Array.from(new Set([...lookupUrls, ...quickRefs.map(r => r.url)]));

  const refsBlock = quickRefs.length > 0
    ? `\n## Quick References\n${quickRefs.map(r => `- ${r.title} — ${r.url}`).join('\n')}\n`
    : '';
  const content =
    `# Grounding Research — ${slug}\n\n` +
    `**Query**: ${query}\n\n` +
    `${citedFacts}\n\n` +
    `## Sources\n${sources.map(u => `- ${u}`).join('\n')}\n` +
    refsBlock;

  try {
    await writeFile(join(researchDir, `${slug}.md`), content);
  } catch (err) {
    console.warn('  [grounding-research] failed to write citations file (non-fatal):', (err as Error)?.message || err);
  }

  return { citedFacts, sources };
}
