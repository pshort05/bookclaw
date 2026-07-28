/**
 * Canon fact-sheet (C4). A "Canon Fact-Sheet" pipeline step (LLM, strict JSON)
 * distils the character bible + setting into one small, structured source of
 * truth — names (+ spellings/aliases), ages, roles/relationships, the POV/tense
 * rule, key places, and timeline anchors. This module is the DETERMINISTIC half:
 * it parses that JSON, renders a compact block injected (truncation-protected)
 * into every chapter's generation + the consistency audit, and — the
 * static-authority + flag-new model — flags any proper noun a chapter introduces
 * that isn't in the sheet, as a drift candidate for human review.
 */

export interface CanonCharacter {
  name: string;
  aliases?: string[];
  age?: number | string;
  role?: string;
  relationships?: string;
}

export interface CanonSheet {
  characters: CanonCharacter[];
  povTense?: string;
  places?: string[];
  timeline?: string[];
}

function extractJson(text: string): any | null {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  const raw = fenced ? fenced[1] : (start >= 0 && end > start ? text.slice(start, end + 1) : text);
  try { return JSON.parse(raw); } catch { return null; }
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);

/** Parse a Canon Fact-Sheet step's JSON output into a validated CanonSheet.
 *  Fail-soft: returns null on malformed input or no characters. */
export function parseCanonSheet(text: string): CanonSheet | null {
  const j = extractJson(text);
  if (!j || typeof j !== 'object') return null;
  const chars: CanonCharacter[] = Array.isArray(j.characters)
    ? j.characters.filter((c: any) => c && str(c.name)).map((c: any) => ({
        name: str(c.name),
        ...(strArr(c.aliases).length ? { aliases: strArr(c.aliases) } : {}),
        ...(c.age !== undefined && str(c.age) ? { age: str(c.age) } : {}),
        ...(str(c.role) ? { role: str(c.role) } : {}),
        ...(str(c.relationships) ? { relationships: str(c.relationships) } : {}),
      }))
    : [];
  if (!chars.length) return null;
  return {
    characters: chars,
    ...(str(j.povTense) ? { povTense: str(j.povTense) } : {}),
    ...(strArr(j.places).length ? { places: strArr(j.places) } : {}),
    ...(strArr(j.timeline).length ? { timeline: strArr(j.timeline) } : {}),
  };
}

/** A compact markdown canon block for prompt injection (kept small on purpose). */
export function formatCanonSheet(sheet: CanonSheet): string {
  const lines: string[] = ['## Canon (locked — names, ages, POV/tense and places are fixed; do not change or invent)'];
  if (sheet.povTense) lines.push(`POV / tense: ${sheet.povTense}`);
  lines.push('Characters:');
  for (const c of sheet.characters) {
    const bits = [c.name];
    if (c.age) bits.push(`age ${c.age}`);
    if (c.role) bits.push(c.role);
    let line = `- ${bits.join(', ')}`;
    if (c.aliases?.length) line += ` — also: ${c.aliases.join(', ')}`;
    if (c.relationships) line += ` — ${c.relationships}`;
    lines.push(line);
  }
  if (sheet.places?.length) lines.push(`Places: ${sheet.places.join('; ')}`);
  if (sheet.timeline?.length) lines.push(`Timeline: ${sheet.timeline.join('; ')}`);
  return lines.join('\n');
}

/** The set of known canonical proper-noun tokens (lowercased): every character
 *  name + alias + place, split into individual words so a chapter mentioning a
 *  known character by first OR last name counts as known. */
export function collectCanonNouns(sheet: CanonSheet): Set<string> {
  const out = new Set<string>();
  const add = (s: string) => {
    const t = s.trim().toLowerCase();
    if (!t) return;
    out.add(t);
    for (const w of t.split(/\s+/)) if (w.length > 1) out.add(w);
  };
  for (const c of sheet.characters) { add(c.name); (c.aliases ?? []).forEach(add); }
  (sheet.places ?? []).forEach(add);
  return out;
}

// Capitalized words that are not proper nouns (sentence starters, honorifics,
// calendar words, common interjections) — never flagged as new characters.
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'but', 'or', 'so', 'then', 'when', 'while', 'if', 'as', 'at', 'in', 'on', 'of', 'to', 'for',
  'he', 'she', 'it', 'they', 'we', 'you', 'i', 'his', 'her', 'their', 'our', 'my', 'me', 'him', 'them', 'us',
  'that', 'this', 'these', 'those', 'there', 'here', 'what', 'who', 'why', 'how', 'not', 'no', 'yes', 'ok', 'okay',
  'mr', 'mrs', 'ms', 'miss', 'dr', 'sir', 'god', 'lord',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
  // Common Title-Case greetings/interjections/celebrations — "Good Morning",
  // "Happy Birthday", "Merry Christmas" — are not new characters or places.
  'good', 'morning', 'afternoon', 'evening', 'night', 'happy', 'birthday',
  'merry', 'christmas', 'thank', 'thanks', 'welcome', 'hello', 'congratulations', 'please', 'sorry',
]);

/**
 * Flag proper nouns a chapter introduces that are NOT in the canon set — likely
 * new/invented characters or places (the audit's "Deja", "Denny Alvarez", "the
 * Millers"). Advisory (for human review), so it errs toward multi-word Title-Case
 * runs and mid-sentence single capitals, skipping sentence-initial noise.
 */
/**
 * Deterministic POV/tense pre-check (C6) — the systemic slip the LLM audit missed
 * (present → past). Coarse and conservative: strips quoted dialogue, then compares
 * narration past-tense markers (was/were/had/-ed tags) against present-tense ones
 * (am/is/are/base verbs). Returns a flag string only on a clear, dominant mismatch
 * with the canon `povTense` rule; null otherwise.
 */
export function checkPovTense(chapterText: string, povTense?: string): string | null {
  if (!povTense) return null;
  const rule = povTense.toLowerCase();
  const wantsPresent = /present/.test(rule);
  const wantsPast = /past/.test(rule);
  if (wantsPresent === wantsPast) return null; // neither or both → can't judge

  const narration = (chapterText || '').replace(/[“"][^“”"]*[”"]/g, ' '); // drop quoted dialogue
  const count = (re: RegExp) => (narration.match(re) || []).length;
  const past = count(/\b(?:I|he|she|they|we)\s+(?:was|were|had|walked|looked|said|felt|turned|knew|thought|wanted|noticed)\b/gi) + count(/\bI'd\b/gi);
  const present = count(/\b(?:I|he|she|they|we)\s+(?:am|is|are|have|has|walk|look|say|feel|turn|know|think|want|notice)\b/gi) + count(/\bI'm\b/gi);

  if (wantsPresent && past >= 6 && past > present * 2) return `POV/tense: chapter reads PAST tense but canon requires "${povTense}".`;
  if (wantsPast && present >= 6 && present > past * 2) return `POV/tense: chapter reads PRESENT tense but canon requires "${povTense}".`;
  return null;
}

export function flagNewProperNouns(chapterText: string, canonNouns: Set<string>): string[] {
  const text = chapterText || '';
  const flagged = new Set<string>();
  const isKnown = (p: string) => p.toLowerCase().split(/\s+/).some((w) => canonNouns.has(w));
  const allStop = (p: string) => p.toLowerCase().split(/\s+/).every((w) => STOPWORDS.has(w));

  const re = /([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const original = m[1].split(/\s+/);
    // Drop a leading stop-word ("The Millers" -> "Millers").
    let words = original;
    while (words.length > 1 && STOPWORDS.has(words[0].toLowerCase())) words = words.slice(1);
    const phrase = words.join(' ');
    if (!phrase || isKnown(phrase) || allStop(phrase)) continue;
    // A single Title-Case word is only a proper-noun signal MID-sentence — a
    // sentence-initial capital is just normal capitalization, so skip it.
    if (original.length === 1) {
      const pre = text.slice(0, m.index).replace(/\s+$/, '');
      if (pre === '' || '.!?'.includes(pre.slice(-1))) continue;
    }
    flagged.add(phrase);
  }
  return [...flagged];
}
