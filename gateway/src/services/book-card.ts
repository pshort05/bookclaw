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

/** A board row: a BookSummary plus its phase segments, next action, and live state. */
export interface BookCard extends BookSummary {
  phases: string[];
  next: NextStep | null;
  live: BookLive | null;
}

/** Minimal shape this helper needs from a project (decouples it from ProjectEngine). */
interface ActiveProjectLike {
  bookSlug?: string;
  progress?: number;
  steps?: Array<{ label: string; status: string; phase?: string }>;
}

export function buildBookCards(
  summaries: BookSummary[],
  nextStepFn: (slug: string) => NextStep | null,
  activeProjects: ActiveProjectLike[],
  phasesForFn: (slug: string) => string[],
): BookCard[] {
  // First active project per bound book wins (stable: listProjects() order).
  const liveBySlug = new Map<string, BookLive>();
  const livePhaseBySlug = new Map<string, string>();
  for (const p of activeProjects) {
    if (!p.bookSlug || liveBySlug.has(p.bookSlug)) continue;
    const step = p.steps?.find((s) => s.status === 'active') ?? p.steps?.[p.steps.length - 1];
    liveBySlug.set(p.bookSlug, { stepLabel: step?.label ?? 'working', progress: p.progress ?? 0 });
    // The active (or last) step's phase advances the chip in real time, overriding
    // the manifest while a book is in-flight (TODO #15 sub-problem 2).
    if (step?.phase) livePhaseBySlug.set(p.bookSlug, step.phase);
  }
  return summaries.map((b) => {
    const phases = phasesForFn(b.slug);
    const livePhase = livePhaseBySlug.get(b.slug);
    // Clamp the live override to the book's segment list: a running sub-phase
    // (e.g. book-production's 'polish') that isn't a board segment keeps the chip
    // on the containing segment rather than leaving card.phases (TODO #15). When
    // no phase list resolves (phases === []), override freely (legacy fallback).
    const phase = livePhase && (phases.length === 0 || phases.includes(livePhase)) ? livePhase : b.phase;
    return {
      ...b,
      phase,
      phases,
      next: nextStepFn(b.slug),
      live: liveBySlug.get(b.slug) ?? null,
    };
  });
}
