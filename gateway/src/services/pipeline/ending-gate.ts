/**
 * Ending gate (C3). A deterministic check on the FINAL chapter of a romance:
 * does it deliver the genre-required Happily-Ever-After / Happy-For-Now, or does
 * it end on an unresolved rupture? The two audited books both ended inside the
 * black moment / on the breakup while the pipeline's own report claimed a HEA —
 * this catches that. Pure and lexical (no LLM): it FLAGS for human review and
 * GROUNDS the completion report; it never rewrites or auto-deletes, so erring
 * toward 'missing'/'uncertain' is safe.
 */

export type EndingStatus = 'delivered' | 'missing' | 'uncertain';

export interface EndingVerdict {
  status: EndingStatus;
  bothLeadsPresent: boolean | null; // null when lead names weren't supplied
  positive: string[];               // HEA markers found anywhere in the final chapter
  rupture: string[];                // rupture markers found in the ENDING stretch
  summary: string;
}

// HEA / HFN resolution markers (searched across the whole final chapter).
const HEA_MARKERS: Array<[string, RegExp]> = [
  ['happily ever after', /\bhappily ever after\b/i],
  ['epilogue', /\bepilogue\b/i],
  ['time-skip', /\b(one|two|three|six)\s+(year|month|week)s?\s+later\b/i],
  ['married', /\bmarried\b/i], ['wedding', /\bwedding\b/i],
  ['engaged', /\bengaged\b/i], ['proposal', /\bpropos(al|ed)\b/i],
  ['moved in together', /\bmove(d)?\s+in\s+(together|with)\b/i],
  ['forever', /\bforever\b/i],
  ['I love you', /\bi love you\b/i],
  ['chose each other', /\bchose\s+(him|her|each other|us|this)\b/i],
  ['ring', /\bring\b.*\bfinger\b/i],
];

// Rupture / unresolved-ending markers (searched only in the ENDING stretch, so a
// black moment earlier in the chapter that gets resolved does not trip it).
const RUPTURE_MARKERS: Array<[string, RegExp]> = [
  ['walked out/away', /\bwalk(ed|s|ing)?\s+(out|away)\b/i],
  ['broke up', /\bbroke\s+up\b|\bbreak[- ]?up\b/i],
  ['left him/her', /\bleft\s+(him|her)\b/i],
  ['it was over', /\bit\s+was\s+over\b/i],
  ['never see/speak', /\bnever\s+(see|speak|talk|call)\b/i],
  ['goodbye', /\bgood-?bye\b/i],
  ['alone', /\balone\b/i],
  ['went dark/out', /\bwent\s+(dark|out|black|cold)\b/i],
  ['screen dimmed', /\bscreen\s+(dimmed|went|dark)\b/i],
  ['unanswered/unopened', /\b(un(answered|opened|read)|didn'?t\s+(answer|reply|open|respond))\b/i],
];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Resolution words that, if present in the ending stretch, mean a "rupture" word
// there is part of a resolved beat, not the final note.
const ENDING_RESOLVES = /\bi love you\b|\btogether\b|\bforever\b|\bmarried\b|\bepilogue\b|\bhappily\b|\bthe end\b|\b(one|two|three|six)\s+(year|month|week)s?\s+later\b/i;

/**
 * Judge the final chapter. `leadNames` (optional) refines the check — both leads
 * should be present at the resolution. The ENDING stretch is the last ~1,200
 * chars, where a romance lands its final note.
 */
export function detectEnding(finalText: string, leadNames: string[] = []): EndingVerdict {
  const text = finalText || '';
  const ending = text.slice(-1200);

  const positive = HEA_MARKERS.filter(([, re]) => re.test(text)).map(([k]) => k);
  const rupture = RUPTURE_MARKERS.filter(([, re]) => re.test(ending)).map(([k]) => k);

  const names = leadNames.filter((n) => n && n.trim().length > 1);
  const bothLeadsPresent = names.length >= 2
    ? names.every((n) => new RegExp(`\\b${escapeRe(n.trim())}\\b`, 'i').test(text))
    : null;

  const strongPositive = positive.length >= 2;
  const endsOnRupture = rupture.length >= 1 && !ENDING_RESOLVES.test(ending);

  let status: EndingStatus;
  if (endsOnRupture && !strongPositive) status = 'missing';
  else if (strongPositive && !endsOnRupture && bothLeadsPresent !== false) status = 'delivered';
  else status = 'uncertain';

  const summary =
    status === 'delivered'
      ? `Final chapter reads as an HEA/HFN (${positive.length} resolution markers: ${positive.slice(0, 4).join(', ')}).`
      : status === 'missing'
        ? `Final chapter ends on an unresolved rupture (${rupture.join(', ')}) with no HEA resolution — the genre promise is NOT delivered.`
        : `Ending is ambiguous (positive: ${positive.length}, rupture: ${rupture.length}${bothLeadsPresent === false ? '; a lead is absent at the resolution' : ''}) — human confirmation needed.`;

  return { status, bothLeadsPresent, positive, rupture, summary };
}
