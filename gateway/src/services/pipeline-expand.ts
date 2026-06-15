import type { PipelineVars } from './pipeline-vars.js';

export interface ResolvedStepInput {
  label: string; skill?: string; toolSuggestion?: string; taskType: string;
  prompt: string; phase?: string; wordCountTarget?: number; chapterNumber?: number;
}

/** {{var}} substitution (whitespace-tolerant); replacer fn so values insert verbatim. */
export function interpolate(tpl: string, vars: Record<string, string | number>): string {
  return String(tpl ?? '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, k) => {
    const v = vars[k];
    return v === undefined || v === null ? '' : String(v);
  });
}

function toNum(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function emitStep(s: any, vars: Record<string, string | number>): ResolvedStepInput {
  return {
    label: interpolate(s.label, vars),
    skill: s.skill,
    toolSuggestion: s.toolSuggestion,
    taskType: s.taskType,
    phase: s.phase,
    prompt: interpolate(s.promptTemplate ?? '', vars),
    wordCountTarget: toNum(typeof s.wordCountTarget === 'string' ? interpolate(s.wordCountTarget, vars) : s.wordCountTarget),
    chapterNumber: toNum(typeof s.chapterNumber === 'string' ? interpolate(s.chapterNumber, vars) : s.chapterNumber),
  };
}

/** Flatten a pipeline steps[] (which may contain {expand,steps} groups) into resolved steps. */
export function expandSteps(rawSteps: any[], vars: PipelineVars): ResolvedStepInput[] {
  const out: ResolvedStepInput[] = [];
  for (const entry of rawSteps ?? []) {
    if (entry && entry.expand === 'chapters' && Array.isArray(entry.steps)) {
      for (let n = 1; n <= vars.chapterCount; n++) {
        const local = { ...vars, n, chapterNumber: n };
        for (const sub of entry.steps) out.push(emitStep(sub, local));
      }
    } else if (entry && 'expand' in entry) {
      // An entry carrying an `expand` key that isn't a valid group (missing/
      // non-array steps, or an unknown expand kind) is a malformed authoring
      // mistake — skip it rather than emit a junk empty step from its
      // (undefined) label/promptTemplate, which would send an empty prompt.
      continue;
    } else {
      out.push(emitStep(entry, vars));
    }
  }
  return out;
}
