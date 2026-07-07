// Step-shape taxonomy for a pipeline's steps[] as authored in library JSON.
// Only the type-only shared import here so the guards stay unit-testable under
// node:test (see fileTree.ts). Mirrors gateway/src/services/pipeline-expand.ts —
// every shape the gateway expands must be renderable by the PipelineEditor.
import type { LibraryPipelineStep } from '@bookclaw/shared';

// A per-chapter expansion group: at generation time its sub-steps repeat once
// per chapter, with {{n}}/{{chapterNumber}} interpolated. Authored as data here.
export interface ExpandGroup {
  expand: 'chapters';
  steps: LibraryPipelineStep[];
}
// A parallel fan-out group: its members run concurrently and the step after the
// group is the implicit join.
export interface ParallelGroup {
  parallel: LibraryPipelineStep[];
}
export type EditorStep = LibraryPipelineStep | ExpandGroup | ParallelGroup;

export const isExpand = (s: EditorStep): s is ExpandGroup =>
  !!s && (s as ExpandGroup).expand === 'chapters' && Array.isArray((s as ExpandGroup).steps);
export const isParallel = (s: EditorStep): s is ParallelGroup =>
  !!s && Array.isArray((s as ParallelGroup).parallel);
