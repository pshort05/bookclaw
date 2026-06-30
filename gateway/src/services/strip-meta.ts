/**
 * Strip the chatbot framing the model leaks into saved step outputs (run review
 * 2026-06-30): leading preambles ("Okay, let's…", "Here are three …:"), the stray
 * "# Polish/Write Chapter N" step header, and trailing meta blocks ("Would you
 * like to proceed…", "Let's keep this momentum going!", "### Saving to …").
 *
 * SAFE-FIRST: this runs on EVERY step output including chapter prose, so it must
 * never drop real content. It therefore (a) only strips a *leading* line that is
 * an unambiguous acknowledgement interjection or a colon-terminated "Here is/are"
 * lead-in, and (b) only removes *trailing* paragraphs — examined from the very
 * end, stopping at the first real paragraph — whose first line is an unambiguous
 * chatbot phrase anchored to line start (so dialogue like `"Shall we proceed?"`
 * and mid-prose uses are never touched). Mid-document text is always preserved.
 */

// Leading acknowledgement interjection (these words never open real prose; a
// dialogue line would start with a quote, which is excluded by the `^`).
const LEADING_ACK = /^\s*(?:okay|ok|sure|certainly|of course|absolutely|alright|got it)\b[!,.: ]/i;
// "Here is/are … :" — a colon-terminated lead-in (a preamble, not prose).
const LEADING_HERE_COLON = /^\s*here\s+(?:is|are)\b.*:\s*$/i;
// The stray per-chapter step header a write/polish step carries on line 1.
const LEADING_STEP_HEADER = /^\s*#\s+(?:polish|write)\s+chapter\s+\d+\s*$/i;

// Unambiguous trailing chatbot meta — matched only at the START of a trailing
// paragraph's first line, so it can't hit dialogue or mid-prose narration.
const TRAILING_META =
  /^\s*(?:#+\s*)?(?:\*+\s*)?(?:would you like (?:to proceed|me to)|shall we (?:proceed|move on|continue)\??$|let me know (?:which|if|what|when|whether)\b|let'?s keep (?:this|the|our) momentum|whenever you'?re ready[, ]|###?\s*saving (?:to|the)\b|i'?m ready to save|ready to be saved|i (?:have|'ve) (?:now )?saved\b)/i;

export function stripMetaCommentary(input: string): string {
  const lines = String(input ?? '').replace(/\r\n/g, '\n').split('\n');

  // ── leading: drop a step header / clear preamble line (single line) ──
  let s = 0;
  while (s < lines.length && lines[s].trim() === '') s++;
  if (s < lines.length) {
    const first = lines[s];
    if (LEADING_STEP_HEADER.test(first) || LEADING_ACK.test(first) || LEADING_HERE_COLON.test(first)) {
      lines.splice(0, s + 1);
      while (lines.length && lines[0].trim() === '') lines.shift();
    }
  }

  // ── trailing: pop contiguous meta paragraphs off the END only ──
  const paras = lines.join('\n').trim().split(/\n\s*\n/);
  while (paras.length > 1) {
    const firstLine = (paras[paras.length - 1].split('\n')[0] || '');
    if (TRAILING_META.test(firstLine)) paras.pop();
    else break;
  }
  return paras.join('\n\n').trim();
}
