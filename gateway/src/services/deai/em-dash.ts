/**
 * Em-dash frequency cap (de-AI). LLMs vastly over-produce em-dashes — often one
 * or more per paragraph, where a human uses one or two per CHAPTER. A prompt
 * can't fix this (models can't reliably count punctuation), so this is a
 * deterministic final pass: keep the first `budget` MID-SENTENCE em-dashes and
 * convert the rest to commas. Dialogue/interruption em-dashes (an em-dash right
 * before a closing quote or a line break — "I don't—") are a distinct, legitimate
 * device: they are preserved and never counted against the budget.
 */

const EM_DASH_RUN = /\s*[—–]\s*/g; // an em- or en-dash plus any surrounding spaces

/** Cap mid-sentence em-dashes at `budget`, converting the excess to commas. */
export function limitEmDashes(text: string, budget = 3): { text: string; removed: number } {
  const src = String(text ?? '');
  let kept = 0, removed = 0;

  const out = src.replace(EM_DASH_RUN, (match, offset: number) => {
    const after = src.slice(offset + match.length, offset + match.length + 1);
    const before = src.slice(Math.max(0, offset - 1), offset);
    // Interruption: dash abuts a closing quote or a line end/start, or the span
    // begins/ends the text — leave it (and don't count it).
    const isInterruption =
      after === '' || after === '\n' ||
      before === '' || before === '\n' ||
      /["'”’)]/.test(after) || /["'“‘(]/.test(before);
    // A dash flanked by digits is a numeric range (1914–1918, 10–20), not a
    // pause — leave it and don't count it against the em-dash budget.
    const isRange = /\d/.test(before) && /\d/.test(after);
    if (isInterruption || isRange) return match;

    kept++;
    if (kept <= budget) return match; // keep the first `budget`
    removed++;
    return ', ';
  });

  // Tidy any doubled punctuation a conversion may have created (", ," / ",.").
  const cleaned = out.replace(/,\s*,/g, ',').replace(/,\s*([.;:!?])/g, '$1');
  return { text: cleaned, removed };
}
