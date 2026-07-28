/**
 * De-AI edit safety guard (C8). The de-AI sweep is a rephrase-for-humanization
 * pass: an edit's `replace` should say the same thing more plainly, never change
 * WHO or WHAT the sentence is about. The audit found the sweep injecting phantom
 * named entities ("Addi"), flipping first→third person, duplicating words
 * ("involuntary, involuntary"), and adding numbers ("thirty-one"). This returns a
 * reason string when a de-AI `replace` does any of those relative to its `find`,
 * so the applier can reject the edit and keep the original span (worst case: a
 * tell survives — never corrupted prose).
 *
 * DE-AI ONLY: a *consistency* edit legitimately swaps names/numbers, so this runs
 * only when the applier is called with `guardEntities` (the de-AI path).
 */

// Capitalized words that are not proper nouns — sentence starters, articles,
// conjunctions, honorifics, calendar words. A de-AI replace introducing one of
// these is fine; a name (not in this set) is the signal we reject on.
const NON_NAME = new Set([
  'the', 'a', 'an', 'and', 'but', 'or', 'nor', 'so', 'yet', 'for', 'as', 'if', 'then', 'than',
  'when', 'while', 'where', 'after', 'before', 'once', 'since', 'until', 'because', 'though', 'although',
  'now', 'still', 'later', 'soon', 'suddenly', 'instead', 'meanwhile', 'later', 'again', 'here', 'there',
  'he', 'she', 'it', 'they', 'we', 'you', 'i', 'his', 'her', 'hers', 'their', 'them', 'him', 'us', 'our', 'my', 'me',
  'this', 'that', 'these', 'those', 'what', 'who', 'why', 'how', 'not', 'no', 'yes', 'oh', 'god', 'sir', 'maybe', 'perhaps',
  'mr', 'mrs', 'ms', 'miss', 'dr', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
]);

const NUM_DIGIT = /\b\d+\b/g;
// Number-words twenty and up (ages/counts) — "one".."nineteen" are too common in
// ordinary prose to treat as an injected number.
const NUM_WORD = /\b(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand)(?:[-\s](?:one|two|three|four|five|six|seven|eight|nine))?\b/gi;

const FIRST_P = /\b(?:I|me|my|mine|we|us|our|ours)\b/i;
const THIRD_P = /\b(?:he|she|they|him|her|hers|them|his|their|theirs)\b/i;
const DUP = /\b(\w+)\b[\s,;:.—–-]+\b\1\b/i; // an immediately repeated word

// Every capitalized, non-NON_NAME word in a span (the known-names set from `find`).
function properNouns(s: string): Set<string> {
  const out = new Set<string>();
  for (const w of s.match(/\b[A-Z][a-zA-Z]+\b/g) || []) {
    const lc = w.toLowerCase();
    if (w.length > 1 && !NON_NAME.has(lc)) out.add(lc);
  }
  return out;
}

// Candidate INJECTED names in a `replace`: same as properNouns but skips a
// sentence-initial capital (offset 0 or right after . ! ?), which is ordinary
// capitalization, not a name — so a rephrase like "Warmth filled the room" or
// "Quickly he moved" is not misread as injecting the name "Warmth"/"Quickly".
// A sentence-initial name that displaces a first-person narrator is caught
// separately (see the lead-name rule in unsafeEditReason).
function injectedProperNouns(s: string): Set<string> {
  const out = new Set<string>();
  const re = /\b[A-Z][a-zA-Z]+\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const lc = m[0].toLowerCase();
    if (m[0].length <= 1 || NON_NAME.has(lc)) continue;
    const pre = s.slice(0, m.index).replace(/\s+$/, '');
    if (pre === '' || '.!?'.includes(pre.slice(-1))) continue; // sentence-initial
    out.add(lc);
  }
  return out;
}
function numbers(s: string): Set<string> {
  const out = new Set<string>();
  for (const n of s.match(NUM_DIGIT) || []) out.add(n);
  for (const n of s.toLowerCase().match(NUM_WORD) || []) out.add(n);
  return out;
}

/** Return a reason the de-AI `replace` would corrupt the span, or null if safe. */
export function unsafeEditReason(find: string, replace: string): string | null {
  const f = String(find ?? ''), r = String(replace ?? '');

  // Proper-noun injection (phantom / POV-intrusion names like "Addi").
  const fN = properNouns(f);
  for (const n of injectedProperNouns(r)) if (!fN.has(n)) return `adds proper noun "${n}"`;
  // A first-person narrator ("I"/"We") displaced by a name at sentence start is a
  // POV intrusion the mid-sentence scan above skips ("I said nothing" → "Addi
  // said nothing"). (A third-person pronoun → name, "She" → "Addi", is a legit
  // pronoun-resolution edit, so this is first-person only.)
  const fLead = (f.match(/^\s*([A-Za-z]+)/)?.[1] ?? '').toLowerCase();
  const rLead = r.match(/^\s*([A-Z][a-zA-Z]+)\b/)?.[1];
  if (rLead && (fLead === 'i' || fLead === 'we')) {
    const lc = rLead.toLowerCase();
    if (!NON_NAME.has(lc) && !fN.has(lc)) return `adds proper noun "${lc}"`;
  }

  // Number injection ("thirty-one", "31").
  const fNum = numbers(f);
  for (const n of numbers(r)) if (!fNum.has(n)) return `adds number "${n}"`;

  // Person/POV flip (first ↔ third). A flip drops ALL of one person's markers and
  // introduces the other's — checking the DROP (not requiring `find` to be single-
  // person) catches the mixed-person case common in first-person narration ("I
  // reached for her hand" → "She reached for her hand"). A rephrase that keeps a
  // first-person marker (rFirst) is left alone.
  const fFirst = FIRST_P.test(f), fThird = THIRD_P.test(f);
  const rFirst = FIRST_P.test(r), rThird = THIRD_P.test(r);
  if (fFirst && !rFirst && rThird) return 'flips first-person to third-person';
  if (fThird && !rThird && rFirst) return 'flips third-person to first-person';

  // Duplicated word introduced by the rephrase ("involuntary, involuntary").
  if (DUP.test(r) && !DUP.test(f)) return 'duplicates a word';

  return null;
}
