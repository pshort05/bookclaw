/**
 * composeEditorPrompt — frame a developmental-editor persona as the system
 * prompt while a channel is in editor mode. The editor's own prompt becomes the
 * dominant instruction; the author soul / genre / world / sections are NOT
 * injected (the editor replaces the author voice). An optional "Active book
 * context" block carries opt-in active-book context (its genre guide + recent
 * notes), followed by recent conversation memory and the heartbeat status line.
 */
export function composeEditorPrompt(
  editorPrompt: string,
  ctx: { memories?: string; heartbeat?: string; manuscript?: string },
): string {
  let p = editorPrompt.trim();
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
