/**
 * Story-canon injection (run-review fix 2026-06-30).
 *
 * Each book phase (planning, bible, production, revision, …) is a SEPARATE
 * project, so a writing/revision step never saw the bible's name registry or the
 * outline, and the manifest title was only interpolated into a few prompts. The
 * model therefore re-invented the title, heroine, hero, town, and hospital on
 * nearly every step. This builds a single pinned "STORY CANON" block —
 * title/author from the manifest plus the character bible, continuity (name)
 * registry, and outline read from the book's data/ — to inject into every
 * generation step so the model is bound to one set of facts.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const SECTION_CAP = 6000; // chars per canon section — keep the prompt bounded
function cap(s: string | undefined, n = SECTION_CAP): string {
  const t = String(s ?? '').trim();
  return t.length > n ? t.slice(0, n) + '\n…[truncated]' : t;
}

/** Pure: format the pinned canon block. Returns '' when there's nothing to pin. */
export function formatCanonBlock(canon: {
  title?: string; author?: string; bible?: string; registry?: string; outline?: string; pov?: string;
}): string {
  const title = String(canon.title ?? '').trim();
  const author = String(canon.author ?? '').trim();
  const pov = String(canon.pov ?? '').trim();
  // Include pov in the guard (review #1): a canon whose only content is a POV
  // directive must still emit the block, or the POV pin is silently dropped.
  if (!title && !author && !pov && !canon.bible && !canon.registry && !canon.outline) return '';

  const parts: string[] = ['## STORY CANON — use these EXACTLY; do NOT rename, retitle, relocate, or invent'];
  if (title) parts.push(`**Title:** ${title}  (use this exact title everywhere — never invent a different one)`);
  if (author) parts.push(`**Author:** ${author}`);
  // run-review #1: pin the narrative POV so chapters don't flip 1st↔3rd person.
  if (pov) parts.push(`**Narrative POV:** ${cap(pov, 600)}`);
  if (canon.registry) parts.push(`\n### Name registry (use these character names verbatim)\n${cap(canon.registry)}`);
  if (canon.bible) parts.push(`\n### Character bible / world\n${cap(canon.bible)}`);
  if (canon.outline) parts.push(`\n### Outline\n${cap(canon.outline)}`);
  parts.push(
    '\nRULES: Use the exact title, author, character names, town, and hospital above. ' +
    'Do NOT rename characters between chapters, change the setting/region, alter the title, ' +
    'or introduce a new named character that contradicts the registry. Stay 100% consistent with this canon.' +
    // run-review #1: narrative person must not drift between chapters.
    (pov ? ' Write every chapter in the Narrative POV above — do NOT switch narrative person (first vs third) or POV character between chapters.' : '') +
    // run-review #2 + #8: reuse established names/ages; name an unnamed entity once.
    ' Reuse the names and ages ALREADY established for every recurring entity (e.g. family members, secondary characters, locations, and past events). ' +
    'Do NOT invent a new or different name for an entity that already has one; if a minor entity is still unnamed, name it once and then reuse that exact name and age everywhere after.',
  );
  return parts.join('\n');
}

/** True for a style-tone reference filename. Anchored so a separator (or start)
 * precedes "style" — excludes incidental matches like "lifestyle.md" (review #5).
 * Filenames are already .md-filtered by the caller. */
export function isStyleRefFile(name: string): boolean {
  return /(^|[-_ ])style[-_ ]?(tone|guide|reference)/i.test(String(name ?? ''));
}

// A sentence that describes a POV the book ABANDONED rather than uses — pinning
// it would bake in the wrong narration (review #2).
const POV_NEGATED = /\b(used to|no longer|previously|earlier draft|abandon|dropped|instead of|originally|was written|not (?:in|written)|avoid|don'?t use|rejected)\b/i;
const POV_AFFIRM = /\b(uses?|written in|narrated|is in|told in|stays? in|maintain|keep|deep point of view|deep pov)\b/i;

/** Pull the point-of-view directive (a sentence naming first/third person) out of
 * a style-tone reference, so it can be pinned in the canon. Skips sentences that
 * describe an abandoned POV and prefers an affirmative one. Returns '' if none. */
export function extractPovDirective(styleText: string): string {
  const text = String(styleText ?? '');
  if (!text.trim()) return '';
  const PERSON = /\b(first-person|third-person|second-person|first person|third person|second person)\b/i;
  const candidates: string[] = [];
  for (const raw of text.split(/(?<=[.!?])\s+|\n+/)) {
    const s = raw.replace(/^#+\s*/, '').replace(/^[-*]\s*/, '').trim();
    if (s && PERSON.test(s) && !POV_NEGATED.test(s)) candidates.push(s);
  }
  if (!candidates.length) return '';
  // Prefer a sentence with an affirmative "the book uses X POV" cue.
  const best = candidates.find((s) => POV_AFFIRM.test(s)) ?? candidates[0];
  return cap(best, 600);
}

/**
 * Bug #36c: deterministic pick among filenames matching suffixRe. Multiple
 * matches (e.g. two character-bible.md-suffixed files) previously resolved to
 * whatever readdirSync's filesystem-dependent order happened to return first.
 * Tiebreak: most-recently-modified wins (the "canon" file is the latest one
 * written); ties broken by filename ascending so the result never varies
 * between calls on the same disk state. Returns '' when there's no match.
 */
export function pickCanonFile(dataDir: string, files: string[], suffixRe: RegExp): string {
  const matches = files.filter((n) => suffixRe.test(n));
  if (matches.length === 0) return '';
  if (matches.length === 1) return matches[0];
  const withMtime = matches.map((n) => {
    let mtimeMs = 0;
    try { mtimeMs = statSync(join(dataDir, n)).mtimeMs; } catch { /* fail-soft: treat as oldest */ }
    return { n, mtimeMs };
  });
  withMtime.sort((a, b) => b.mtimeMs - a.mtimeMs || a.n.localeCompare(b.n));
  return withMtime[0].n;
}

/** Read the canon sources from a book's data/ dir + manifest and format them.
 * Fail-soft: returns '' on any error or when no canon files exist. */
export function buildBookCanonBlock(dataDir: string | null | undefined, manifest: any): string {
  try {
    const title = String(manifest?.title ?? '').trim();
    const author = String(manifest?.pulledFrom?.author?.name ?? manifest?.author?.name ?? '').trim();
    let bible = '', registry = '', outline = '', pov = '';
    if (dataDir && existsSync(dataDir)) {
      const files = readdirSync(dataDir).filter((n) => n.endsWith('.md'));
      const read = (suffixRe: RegExp): string => {
        const name = pickCanonFile(dataDir, files, suffixRe);
        if (!name) return '';
        try { return readFileSync(join(dataDir, name), 'utf-8'); } catch { return ''; }
      };
      bible = read(/character-bible\.md$/i);
      registry = read(/(continuity-tracker|series-continuity)[^/]*\.md$/i);
      outline = read(/(chapter-by-chapter-outline|outline)\.md$/i);
      // run-review #1: the style-tone reference states the narrative POV.
      const styleName = files.find((n) => isStyleRefFile(n));
      if (styleName) {
        try { pov = extractPovDirective(readFileSync(join(dataDir, styleName), 'utf-8')); } catch { /* fail-soft */ }
      }
    }
    return formatCanonBlock({ title, author, bible, registry, outline, pov });
  } catch {
    return '';
  }
}
