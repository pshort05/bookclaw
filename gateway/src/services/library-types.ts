/**
 * Shared types for the template library (book-container Phase 1). Kept separate
 * from both projects.ts and library.ts so the pipeline exporter in projects.ts
 * and the LibraryService can both import these without an import cycle.
 */

/** Library template kinds. `skill` is served via SkillLoader delegation. */
export const LIBRARY_KINDS = ['author', 'genre', 'pipeline', 'section', 'skill'] as const;
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
