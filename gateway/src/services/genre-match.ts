/**
 * Resolve a user-typed genre query to a canonical library genre name.
 *
 * Mirrors selectBook's matching so the /genre command (dashboard + Telegram)
 * accepts loose input: exact wins, then a case-insensitive exact name, then a
 * unique case-insensitive substring. Multiple substring hits are ambiguous so
 * the caller can show the candidate list instead of guessing.
 */
export type GenreMatch =
  | { kind: 'match'; name: string }
  | { kind: 'ambiguous'; candidates: string[] }
  | { kind: 'none' };

/** Fold case and separators so "Dark Fantasy" and "dark-fantasy" compare equal. */
function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function matchGenre(available: string[], query: string): GenreMatch {
  const q = query.trim();
  if (!q) return { kind: 'none' };

  const exact = available.find((g) => g === q);
  if (exact) return { kind: 'match', name: exact };

  const nq = normalize(q);
  if (!nq) return { kind: 'none' };

  const normExact = available.find((g) => normalize(g) === nq);
  if (normExact) return { kind: 'match', name: normExact };

  const subs = available.filter((g) => normalize(g).includes(nq));
  if (subs.length === 1) return { kind: 'match', name: subs[0] };
  if (subs.length > 1) return { kind: 'ambiguous', candidates: subs };
  return { kind: 'none' };
}
