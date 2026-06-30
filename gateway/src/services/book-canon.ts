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
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const SECTION_CAP = 6000; // chars per canon section — keep the prompt bounded
function cap(s: string | undefined, n = SECTION_CAP): string {
  const t = String(s ?? '').trim();
  return t.length > n ? t.slice(0, n) + '\n…[truncated]' : t;
}

/** Pure: format the pinned canon block. Returns '' when there's nothing to pin. */
export function formatCanonBlock(canon: {
  title?: string; author?: string; bible?: string; registry?: string; outline?: string;
}): string {
  const title = String(canon.title ?? '').trim();
  const author = String(canon.author ?? '').trim();
  if (!title && !author && !canon.bible && !canon.registry && !canon.outline) return '';

  const parts: string[] = ['## STORY CANON — use these EXACTLY; do NOT rename, retitle, relocate, or invent'];
  if (title) parts.push(`**Title:** ${title}  (use this exact title everywhere — never invent a different one)`);
  if (author) parts.push(`**Author:** ${author}`);
  if (canon.registry) parts.push(`\n### Name registry (use these character names verbatim)\n${cap(canon.registry)}`);
  if (canon.bible) parts.push(`\n### Character bible / world\n${cap(canon.bible)}`);
  if (canon.outline) parts.push(`\n### Outline\n${cap(canon.outline)}`);
  parts.push(
    '\nRULES: Use the exact title, author, character names, town, and hospital above. ' +
    'Do NOT rename characters between chapters, change the setting/region, alter the title, ' +
    'or introduce a new named character that contradicts the registry. Stay 100% consistent with this canon.',
  );
  return parts.join('\n');
}

/** Read the canon sources from a book's data/ dir + manifest and format them.
 * Fail-soft: returns '' on any error or when no canon files exist. */
export function buildBookCanonBlock(dataDir: string | null | undefined, manifest: any): string {
  try {
    const title = String(manifest?.title ?? '').trim();
    const author = String(manifest?.pulledFrom?.author?.name ?? manifest?.author?.name ?? '').trim();
    let bible = '', registry = '', outline = '';
    if (dataDir && existsSync(dataDir)) {
      const files = readdirSync(dataDir).filter((n) => n.endsWith('.md'));
      const read = (suffixRe: RegExp): string => {
        const name = files.find((n) => suffixRe.test(n));
        if (!name) return '';
        try { return readFileSync(join(dataDir, name), 'utf-8'); } catch { return ''; }
      };
      bible = read(/character-bible\.md$/i);
      registry = read(/(continuity-tracker|series-continuity)[^/]*\.md$/i);
      outline = read(/(chapter-by-chapter-outline|outline)\.md$/i);
    }
    return formatCanonBlock({ title, author, bible, registry, outline });
  } catch {
    return '';
  }
}
