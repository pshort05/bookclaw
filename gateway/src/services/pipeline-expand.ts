import type { PipelineVars } from './pipeline-vars.js';

export interface ResolvedStepInput {
  label: string; skill?: string; toolSuggestion?: string; taskType: string;
  prompt: string; phase?: string; wordCountTarget?: number; chapterNumber?: number;
  modelOverride?: { provider: string; model?: string; temperature?: number };
  // Set only on members of a `{ parallel: [...] }` group — a stable, index-based
  // id ('g'+entryIndex) shared by every member of that group. Absent on ordinary
  // steps (including the implicit join step that follows a group).
  parallelGroup?: string;
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
    ...(s.modelOverride ? { modelOverride: s.modelOverride } : {}),
  };
}

/** Flatten a pipeline steps[] (which may contain {expand,steps} or {parallel} groups) into resolved steps. */
export function expandSteps(rawSteps: any[], vars: PipelineVars): ResolvedStepInput[] {
  const out: ResolvedStepInput[] = [];
  const raw = rawSteps ?? [];
  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i];
    if (entry && entry.expand === 'chapters' && Array.isArray(entry.steps)) {
      for (let n = 1; n <= vars.chapterCount; n++) {
        const local = { ...vars, n, chapterNumber: n };
        for (const sub of entry.steps) out.push(emitStep(sub, local));
      }
    } else if (entry && 'parallel' in entry) {
      // A `{ parallel: [member, ...] }` group: emit each member through the same
      // per-step interpolator as a plain step, then stamp the group marker on top.
      // Malformed (missing/empty/non-array `parallel`) → skip, mirroring the
      // malformed-`expand` handling below.
      if (!Array.isArray(entry.parallel) || entry.parallel.length === 0) continue;
      const groupId = `g${i}`;
      for (const member of entry.parallel) {
        const step = emitStep(member, vars);
        step.parallelGroup = groupId;
        out.push(step);
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
