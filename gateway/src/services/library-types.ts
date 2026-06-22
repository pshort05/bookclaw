/**
 * Shared types for the template library (book-container Phase 1). Kept separate
 * from both projects.ts and library.ts so the pipeline exporter in projects.ts
 * and the LibraryService can both import these without an import cycle.
 */

/** Library template kinds. `skill` is served via SkillLoader delegation. */
export const LIBRARY_KINDS = ['author', 'voice', 'genre', 'pipeline', 'sequence', 'editor', 'prompt', 'section', 'skill', 'world'] as const;
export type LibraryKind = (typeof LIBRARY_KINDS)[number];

/** Where a library entry came from. Mirrors SkillSource. */
export type LibrarySource = 'builtin' | 'workspace' | 'synthetic';

/** A single step in a data-driven pipeline (mirrors the static template step). */
export interface LibraryPipelineStep {
  label: string;
  skill?: string;
  toolSuggestion?: string;
  taskType: string;
  promptTemplate: string;
  phase?: string;
  wordCountTarget?: number;
  chapterNumber?: number;
  modelOverride?: { provider: string; model?: string; temperature?: number };
}

/** A pipeline expressed as data (the eventual book `templates/pipeline.json`). */
export interface LibraryPipeline {
  schemaVersion: number;   // gate for the pipeline artifact (see arch doc)
  name: string;            // e.g. 'book-planning'
  label: string;
  description: string;
  dynamic?: boolean;       // true = steps are generated at create-time (novel-pipeline)
  steps: LibraryPipelineStep[];
}

export const PIPELINE_SCHEMA_VERSION = 1;

/** An ordered list of pipeline names a book runs, in sequence. */
export interface LibrarySequence {
  schemaVersion?: number;
  name: string;
  label?: string;
  description?: string;
  pipelines: string[];
}

/** A developmental-editor persona that replaces the author voice in chat. */
export interface LibraryEditor {
  schemaVersion?: number;
  name: string;
  label?: string;
  description?: string;
  /** Short genre/craft tag shown in the `/editor` selection menu (e.g. "Romantasy"). */
  specialty?: string;
  systemPrompt: string;
  model?: string;
  temperature?: number;
}

/** A reusable writing-craft prompt run one-at-a-time against a book file. */
export interface LibraryPrompt {
  schemaVersion?: number;
  name: string;
  label?: string;
  description?: string;
  systemPrompt: string;
  model?: string;
  temperature?: number;
}

/**
 * Phase sequence the dynamic `novel-pipeline` produces, in order. Mirrors the
 * distinct `phase` values emitted by ProjectEngine.createNovelPipeline — the
 * steps don't exist until a project is created, so the board can't derive them
 * from the (empty-at-rest) pipeline.steps and uses this constant instead.
 */
export const NOVEL_PIPELINE_PHASES = ['premise', 'bible', 'outline', 'writing', 'revision', 'assembly'] as const;

/**
 * The pipeline's ordered, distinct phase list — what the board renders as
 * progress segments (TODO #15). Dynamic novel-pipeline → NOVEL_PIPELINE_PHASES;
 * a phase-tagged static pipeline → its distinct step phases in first-seen order;
 * a no-phase pipeline → a single segment named after its lifecycle stage (the
 * pipeline name minus a leading `book-`, e.g. `book-planning` → `planning`).
 * Never returns an empty array.
 */
export function pipelinePhases(pipeline: LibraryPipeline): string[] {
  if (pipeline.dynamic) return [...NOVEL_PIPELINE_PHASES];
  const seen: string[] = [];
  // Descend into `parallel` group wrappers (the phase lives on each member, not on
  // the wrapper) so grouped phases still render as board segments.
  const flat = (pipeline.steps ?? []).flatMap((s: any) =>
    Array.isArray(s?.parallel) ? s.parallel : [s]);
  for (const step of flat) {
    if (step.phase && !seen.includes(step.phase)) seen.push(step.phase);
  }
  if (seen.length) return seen;
  return [pipeline.name.replace(/^book-/, '') || pipeline.name];
}
