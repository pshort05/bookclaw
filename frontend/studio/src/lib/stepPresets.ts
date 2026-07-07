// Palette catalog for the visual pipeline builder. Presets land with a real
// gateway taskType (TASK_TIERS key — guarded by tests/unit/step-presets.test.ts)
// so a non-technical author never types a task-type string. Pure data +
// factories; no React/dnd imports so it runs under node:test.
import type { GroupKind, Node, StepNode } from './pipelineEdits.js';

export interface StepPreset {
  key: string; label: string; taskType: string; phase?: string; promptTemplate: string;
}

export const STEP_PRESETS: StepPreset[] = [
  {
    key: 'outline', label: 'Chapter outline', taskType: 'outline', phase: 'outline',
    promptTemplate: 'Create a detailed chapter-by-chapter outline for "{{title}}" ({{chapterCount}} chapters). For each chapter: title, POV, key beats, and how it advances the plot.',
  },
  {
    key: 'book-bible', label: 'Book bible', taskType: 'book_bible', phase: 'worldbuilding',
    promptTemplate: 'Build the book bible for "{{title}}": world rules, settings, factions, and a character bible with profiles, motivations, relationships, and arcs.',
  },
  {
    key: 'draft-chapter', label: 'Draft chapter', taskType: 'creative_writing', phase: 'draft',
    promptTemplate: 'Write chapter {{n}} of "{{title}}" (about {{wordsPerChapter}} words). Follow the chapter outline and stay true to the character bible and world bible in your context.',
  },
  {
    key: 'critique', label: 'Critique pass', taskType: 'revision', phase: 'critique',
    promptTemplate: "Critique the previous step's output: strengths, weaknesses, and specific, actionable improvements. Do not rewrite — list the changes to make.",
  },
  {
    key: 'rewrite', label: 'Rewrite pass', taskType: 'revision', phase: 'rewrite',
    promptTemplate: 'Rewrite the draft applying the critique from the previous step. Preserve plot, characters, and voice; output the complete revised text.',
  },
  {
    key: 'consistency', label: 'Consistency check', taskType: 'consistency', phase: 'critique',
    promptTemplate: 'Check the previous output against the book bible and outline for contradictions (names, timeline, world rules, character knowledge). Report each issue with its location.',
  },
  {
    key: 'final-edit', label: 'Final edit', taskType: 'final_edit', phase: 'assembly',
    promptTemplate: 'Perform a final editorial polish: clarity, flow, word choice, and surface errors. Preserve meaning and voice; output the complete polished text.',
  },
  {
    key: 'marketing', label: 'Marketing copy', taskType: 'marketing', phase: 'assembly',
    promptTemplate: 'Write a back-cover blurb and a one-paragraph pitch for "{{title}}" based on the manuscript and outline in context.',
  },
  {
    key: 'blank', label: 'Blank step', taskType: 'general',
    promptTemplate: '',
  },
];

export type PaletteItem =
  | { type: 'preset'; key: string }
  | { type: 'skill'; name: string }
  | { type: 'block'; kind: GroupKind };

export function paletteId(item: PaletteItem): string {
  if (item.type === 'preset') return `pal:preset:${item.key}`;
  if (item.type === 'skill') return `pal:skill:${item.name}`;
  return `pal:block:${item.kind}`;
}

export function parsePaletteId(id: string): PaletteItem | null {
  if (!id.startsWith('pal:')) return null;
  const rest = id.slice(4);
  if (rest.startsWith('preset:')) return { type: 'preset', key: rest.slice(7) };
  if (rest.startsWith('skill:')) return { type: 'skill', name: rest.slice(6) };
  if (rest === 'block:parallel' || rest === 'block:expand') {
    return { type: 'block', kind: rest.slice(6) as GroupKind };
  }
  return null;
}

/** Build the Node a palette item drops into the flow. Returns null for unknown presets. */
export function nodeFromPalette(item: PaletteItem, mkKey: () => string): Node | null {
  if (item.type === 'block') return { key: mkKey(), kind: item.kind, members: [] };
  if (item.type === 'skill') {
    const step: StepNode = {
      key: mkKey(), kind: 'step',
      step: { label: item.name, taskType: 'creative_writing', promptTemplate: '', skill: item.name },
    };
    return step;
  }
  const p = STEP_PRESETS.find((x) => x.key === item.key);
  if (!p) return null;
  return {
    key: mkKey(), kind: 'step',
    step: {
      label: p.label, taskType: p.taskType, promptTemplate: p.promptTemplate,
      ...(p.phase ? { phase: p.phase } : {}),
    },
  };
}
