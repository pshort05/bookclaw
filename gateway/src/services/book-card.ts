/**
 * Book-board enrichment (book-container Phase 9). Pure, side-effect-free:
 * given the book summaries, a nextStep lookup, and the currently-active
 * projects, produce the BookCard rows the board renders. Kept out of the route
 * handler so it is unit-testable in isolation.
 */
import type { BookSummary, NextStep } from './book-types.js';

/** Live generation state for a book, derived from its bound active project. */
export interface BookLive {
  stepLabel: string;
  progress: number;   // 0-100, from the bound project
}

/** A board row: a BookSummary plus its suggested next action and live state. */
export interface BookCard extends BookSummary {
  next: NextStep | null;
  live: BookLive | null;
}

/** Minimal shape this helper needs from a project (decouples it from ProjectEngine). */
interface ActiveProjectLike {
  bookSlug?: string;
  progress?: number;
  steps?: Array<{ label: string; status: string }>;
}

export function buildBookCards(
  summaries: BookSummary[],
  nextStepFn: (slug: string) => NextStep | null,
  activeProjects: ActiveProjectLike[],
): BookCard[] {
  // First active project per bound book wins (stable: listProjects() order).
  const liveBySlug = new Map<string, BookLive>();
  for (const p of activeProjects) {
    if (!p.bookSlug || liveBySlug.has(p.bookSlug)) continue;
    const step = p.steps?.find((s) => s.status === 'active') ?? p.steps?.[p.steps.length - 1];
    liveBySlug.set(p.bookSlug, { stepLabel: step?.label ?? 'working', progress: p.progress ?? 0 });
  }
  return summaries.map((b) => ({
    ...b,
    next: nextStepFn(b.slug),
    live: liveBySlug.get(b.slug) ?? null,
  }));
}
