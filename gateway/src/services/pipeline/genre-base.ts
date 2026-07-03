/**
 * Genre -> base pipeline sequence (Flagship Plan 7, Task 4).
 *
 * A pure lookup from a book's `genre` (a `library/genres/*` content-guide
 * entry name — the same value BookService.create() validates and snapshots
 * for tropes/beats prompt injection, and the same value the casting layer's
 * loadCastingSheet(genre) keys off) to the name of the `library/sequences/`
 * entry that chains its base pipeline(s).
 *
 * The casting-sheet + intimacy-template file names use these exact genre
 * keys too (library/casting/techno-thriller.json, not .../technothriller.json)
 * so a book actually created with this genre gets a real genre guide AND a
 * real casting sheet — an earlier draft of this map used bare 'scifi'/
 * 'technothriller' keys with no matching library/genres/* entry, which made
 * BookService.create() reject the genre outright (400 "Unknown genre
 * template") for any real book — an inert-in-production mismatch caught by
 * this plan's own integration test (tests/unit/genre-base-selection.test.ts).
 *
 * Only genres with exactly one unambiguous base are mapped: 'romance' has
 * two shipped variants (romance-spicy / romance-sweet) with no default
 * implied by genre alone, so it is deliberately left unmapped — a caller
 * must still pick a pipeline/sequence explicitly for it, same as before this
 * plan. 'science-fiction' (mundane science fiction) reuses the existing
 * `msf` sequence rather than duplicating it under a new name.
 */
export const GENRE_BASE_SEQUENCE: Readonly<Record<string, string>> = {
  romantasy: 'romantasy',
  'science-fiction': 'msf',
  'techno-thriller': 'technothriller',
};

/** The base sequence name for a genre, or null when none is mapped. */
export function baseSequenceNameForGenre(genre: string | null | undefined): string | null {
  if (!genre) return null;
  return GENRE_BASE_SEQUENCE[genre] ?? null;
}
