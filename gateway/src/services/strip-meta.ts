/**
 * Strip the chatbot framing the model leaks into saved step outputs (run review
 * 2026-06-30): leading preambles ("Okay, let's…", "Here are three …:"), the stray
 * "# Polish/Write Chapter N" step header, and trailing meta blocks ("Would you
 * like to proceed…", "Let's keep this momentum going!", "### Saving to …").
 *
 * SAFE-FIRST: this runs on EVERY step output including chapter prose, so it must
 * never drop real content. It therefore (a) only strips a *leading* line that is
 * an unambiguous acknowledgement interjection or a colon-terminated "Here is/are"
 * lead-in, (b) only removes *trailing* paragraphs — examined from the very
 * end, stopping at the first real paragraph — whose first line is an unambiguous
 * chatbot phrase anchored to line start (so dialogue like `"Shall we proceed?"`
 * and mid-prose uses are never touched), and (c) drops standalone production-meta
 * lines like `**Final Word Count:** 800,000 words` that the compile/assemble step
 * leaks into the manuscript (run-review 2026-07-01 B4) — matched only in the
 * `**Word Count …:**` label form, which never occurs in real prose. Mid-document
 * story text is always preserved.
 *
 * 2026-07-08: also strips a *bare* (no-`#`) "Polish/Write Chapter N" leading label
 * and, with `{ prose: true }` (chapter output only), a trailing epilogue block
 * introduced by a standalone "Next Steps:" / "Chapter Ending Hook:" heading —
 * gated behind `prose` because those headings are legitimate in reports/outlines.
 */

// Leading acknowledgement interjection (these words never open real prose; a
// dialogue line would start with a quote, which is excluded by the `^`).
const LEADING_ACK = /^\s*(?:okay|ok|sure|certainly|of course|absolutely|alright|got it)\b[!,.: ]/i;
// "Here is/are … :" — a colon-terminated lead-in (a preamble, not prose).
const LEADING_HERE_COLON = /^\s*here\s+(?:is|are)\b.*:\s*$/i;
// The stray per-chapter step header a write/polish step carries on line 1.
const LEADING_STEP_HEADER = /^\s*#\s+(?:polish|write)\s+chapter\s+\d+\s*$/i;
// The same header without the leading '#' (2026-07-08): real prose never opens
// with a bare "Polish Chapter 7" / "Write Chapter 7" line on its own.
const LEADING_BARE_STEP_HEADER = /^\s*(?:polish|write)\s+chapter\s+\d+\s*$/i;

// Unambiguous trailing chatbot meta — matched only at the START of a trailing
// paragraph's first line, so it can't hit dialogue or mid-prose narration. Runs
// on EVERY step, so it stays limited to phrases that never close a real
// deliverable (report/blog/marketing).
const TRAILING_META =
  /^\s*(?:#+\s*)?(?:\*+\s*)?(?:would you like (?:to proceed|me to)|shall we (?:proceed|move on|continue)\??$|let me know (?:which|if|what|when|whether)\b|let'?s keep (?:this|the|our) momentum|whenever you'?re ready[, ]|###?\s*saving (?:to|the)\b|i'?m ready to save|ready to be saved|i (?:have|'ve) (?:now )?saved\b)/i;

// Trailing chatbot solicitations that end a *chat* turn. Prose-only: a report or
// blog deliverable could plausibly close with a "which direction…" style line,
// so these are not stripped from non-prose output.
const PROSE_TRAILING_META =
  /^\s*(?:#+\s*)?(?:\*+\s*)?(?:which direction (?:would|do) you|i'?m eager to (?:continue|keep)|happy to (?:keep|continue)\b)/i;

// A standalone epilogue heading a chatty chapter draft appends before its
// "directions" list. Prose-only, and only when it sits in the trailing window
// (below) — legitimate as an in-story/section heading elsewhere and in reports
// ("Next Steps:") / outlines ("Chapter ending hook") which run non-prose.
const PROSE_EPILOGUE_HEADING =
  /^\s*(?:#+\s*)?(?:\*+\s*)?(?:next steps|chapter ending hook)\s*:?\s*\*{0,2}\s*$/i;
// How many trailing paragraphs the epilogue strip may reach back into. Bounds
// worst-case removal to the tail, so a same-named heading mid-chapter (real
// prose after it) can never trigger the slice.
const EPILOGUE_WINDOW = 4;

// Standalone production-meta word-count lines the compile/assemble step leaks
// (e.g. `**Target Word Count per Chapter:** ~2500 words`, `**Final Word Count:**
// 800,000 words`). These whole-book / planning labels are NEVER legitimate
// deliverable content — not in prose, not in an outline/breakdown — so they are
// stripped unconditionally.
const WHOLE_BOOK_WORDCOUNT_LINE =
  /^\s*\*{1,2}\s*(?:target|final|total)\s+word\s+count(?:\s+per\s+chapter)?\s*:?\s*\*{0,2}\s*:?/i;
// The `Estimated word count` (per scene) form is the intended DELIVERABLE of a
// non-prose scene-breakdown step, so it is stripped only in prose (a chapter /
// manuscript step), where a leaked estimate label IS stray meta. Gating just this
// ambiguous form keeps breakdowns intact while the whole-book form above (compile
// leakage) is always removed — a single `prose` flag can't separate the two, so
// the label distinguishes them.
const ESTIMATE_WORDCOUNT_LINE =
  /^\s*\*{1,2}\s*estimated\s+word\s+count(?:\s+per\s+scene)?\s*:?\s*\*{0,2}\s*:?/i;

export function stripMetaCommentary(input: string, opts: { prose?: boolean } = {}): string {
  const lines = String(input ?? '').replace(/\r\n/g, '\n').split('\n')
    // ── word-count meta (run-review B4). Whole-book / planning labels
    //    (Final/Total/Target Word Count) are compile-step leakage and are dropped
    //    ALWAYS; the `Estimated word count` (per scene) form is a legitimate
    //    scene-breakdown deliverable, so it is dropped only in prose. Both steps
    //    are non-prose, so the label — not the `prose` flag — separates them. ──
    .filter((line) => !(WHOLE_BOOK_WORDCOUNT_LINE.test(line) || (opts.prose && ESTIMATE_WORDCOUNT_LINE.test(line))));

  // ── leading: drop a step header / clear preamble line (single line) ──
  let s = 0;
  while (s < lines.length && lines[s].trim() === '') s++;
  if (s < lines.length) {
    const first = lines[s];
    // The bare (no-`#`) label is stripped only on prose steps — that is where a
    // "Polish Chapter 7" step label leaks; a non-prose deliverable could open
    // with that exact line legitimately. The `#`-prefixed form stays always-on.
    if (LEADING_STEP_HEADER.test(first) || (opts.prose && LEADING_BARE_STEP_HEADER.test(first))
        || LEADING_ACK.test(first) || LEADING_HERE_COLON.test(first)) {
      lines.splice(0, s + 1);
      while (lines.length && lines[0].trim() === '') lines.shift();
    }
  }

  let paras = lines.join('\n').trim().split(/\n\s*\n/);

  // ── trailing: pop contiguous meta paragraphs off the END only. Track whether
  //    a chatbot turn-ender was popped — that is the signal that legitimizes the
  //    prose epilogue slice below. ──
  let poppedMeta = false;
  while (paras.length > 1) {
    const firstLine = (paras[paras.length - 1].split('\n')[0] || '');
    if (TRAILING_META.test(firstLine) || (opts.prose && PROSE_TRAILING_META.test(firstLine))) {
      paras.pop();
      poppedMeta = true;
    } else break;
  }

  // ── prose-only: drop a trailing epilogue introduced by a standalone "Next
  //    Steps:" / "Chapter Ending Hook:" heading (and everything after it), but
  //    ONLY when we just popped a chatbot turn-ender (poppedMeta) AND the
  //    heading sits within the trailing EPILOGUE_WINDOW. Both guards together
  //    mean a real chapter — which does not end in a chatbot solicitation, and
  //    whose late paragraphs are narrative prose, not a bare meta heading —
  //    cannot trigger the slice, so it can never drop real story text. ──
  if (opts.prose && poppedMeta) {
    const windowStart = Math.max(1, paras.length - EPILOGUE_WINDOW);
    const idx = paras.findIndex((p, i) => i >= windowStart && PROSE_EPILOGUE_HEADING.test(p.split('\n')[0] || ''));
    if (idx > 0) paras = paras.slice(0, idx);
  }
  return paras.join('\n\n').trim();
}
