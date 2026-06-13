/**
 * Default book lifecycle phases (book-container Phase 9 / TODO #15).
 *
 * Single source of truth for the board progress bar (Board.tsx) and the drawer
 * timeline (BookDrawer.tsx), used as the fallback when a book exposes no
 * pipeline-derived phase list. Replaces the two previously-divergent hardcoded
 * copies (closes the "Dedup the pipeline-phase order constant" cleanup).
 */
export const LIFECYCLE_PHASES = ['planning', 'bible', 'production', 'revision', 'format', 'launch'] as const;
export type LifecyclePhase = (typeof LIFECYCLE_PHASES)[number];
