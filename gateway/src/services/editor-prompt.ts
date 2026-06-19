/**
 * composeEditorPrompt — frame a developmental-editor persona as the system
 * prompt while a channel is in editor mode. The editor's own prompt becomes the
 * dominant instruction; the author soul / genre / world / sections are NOT
 * injected (the editor replaces the author voice). A session-mode directive
 * (brainstorm vs critique) is appended next, followed by an optional "Active book
 * context" block (opt-in active-book context: its genre guide + recent notes),
 * recent conversation memory, and the heartbeat status line.
 */

export type EditorMode = 'brainstorm' | 'critique';

/** Shared per-mode directive blocks, appended after the persona so the mode
 *  framing is stable across every editor and never contradicts the persona. */
export const MODE_DIRECTIVE: Record<EditorMode, string> = {
  brainstorm: `# Session mode: BRAINSTORM
You are in an open, generative brainstorming session. Help the author invent and pressure-test ideas — premises, characters, hooks, "what if" turns, scene seeds. Offer options, take sides, and push toward the strongest version. You are not line-editing finished text; you are thinking alongside the author.`,
  critique: `# Session mode: CRITIQUE
You are in a critique / developmental-edit session focused on the author's existing text. Diagnose what is on the page: name the problems, classify how serious each one is, and give concrete, ranked, actionable fixes. Prioritize ruthlessly — lead with what matters most. Stay in your craft lane and your voice.`,
};

export function composeEditorPrompt(
  editorPrompt: string,
  ctx: { memories?: string; heartbeat?: string; manuscript?: string },
  mode: EditorMode = 'brainstorm',
): string {
  let p = editorPrompt.trim();
  p += `\n\n${MODE_DIRECTIVE[mode] ?? MODE_DIRECTIVE.brainstorm}`;
  if (ctx.manuscript && ctx.manuscript.trim()) {
    p += `\n\n# Active book context\n${ctx.manuscript.trim()}`;
  }
  if (ctx.memories && ctx.memories.trim()) {
    p += `\n\n# Recent conversation context\n${ctx.memories.trim()}`;
  }
  if (ctx.heartbeat && ctx.heartbeat.trim()) {
    p += `\n\n${ctx.heartbeat.trim()}`;
  }
  return p;
}
