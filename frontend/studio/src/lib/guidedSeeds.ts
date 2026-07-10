export type Heat = 'sweet' | 'spicy';
export type CouncilSelection = 'auto' | 'propose';

export interface GuidedSeeds {
  storyArc: string;
  characters: string;
  setting: string;
  heat: Heat;
  councilSelection: CouncilSelection;
}

export const EMPTY_GUIDED_SEEDS: GuidedSeeds = {
  storyArc: '', characters: '', setting: '', heat: 'sweet', councilSelection: 'auto',
};

export interface GuidedFormat {
  structure: string;
  customStructure?: unknown;
  form: string;
  chapterCount: number;
  wordsPerChapter: number;
}

/** Heat selects the pipeline id — the manifest's seeds block carries no `heat`
 *  key (gateway/src/services/book.ts:55); this is the only place heat is used. */
export function pipelineForHeat(heat: Heat): string {
  return heat === 'spicy' ? 'romance-spicy-full' : 'romance-sweet-full';
}

/** Gate: title/author/voice set, plus a fully-specified, in-band format.
 *  chapterCount/wordsPerChapter only reach /api/books inside a validated
 *  format block (gateway/src/services/format-input.ts buildBookFormat) — a
 *  bare or partial block 400s, so Create must stay disabled until the format
 *  is both `active` (something was touched) and `ok` (fits the form's band). */
export function guidedCanCreate(input: { title: string; author: string; voice: string; formatOk: boolean; formatActive: boolean }): boolean {
  return !!(input.title.trim() && input.author && input.voice && input.formatActive && input.formatOk);
}

/** Assembles the POST /api/books body. Mirrors NewBook.tsx's create() literal
 *  for the format block; no `blueprint` (not part of the shared seed contract)
 *  and no top-level `heat` (see pipelineForHeat). */
export function buildGuidedCreatePayload(input: {
  title: string; author: string; voice: string; genre: string;
  seeds: GuidedSeeds; format: GuidedFormat;
}): Record<string, unknown> {
  const { title, author, voice, genre, seeds, format } = input;
  return {
    title: title.trim(),
    author,
    voice,
    genre: genre || null,
    pipelineSequence: [pipelineForHeat(seeds.heat)],
    storyArc: seeds.storyArc,
    characters: seeds.characters,
    setting: seeds.setting,
    councilSelection: seeds.councilSelection,
    structure: format.structure,
    ...(format.customStructure ? { customStructure: format.customStructure } : {}),
    form: format.form,
    chapterCount: format.chapterCount,
    wordsPerChapter: format.wordsPerChapter,
  };
}
