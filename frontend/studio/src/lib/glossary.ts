import type { LibraryKind } from '@bookclaw/shared';

/** Canonical term + one-line definition per kind (verbatim from docs/GLOSSARY.md). */
export const GLOSSARY: Record<LibraryKind, { canon: string; def: string }> = {
  author: {
    canon: 'Author',
    def: 'The pen-name identity — who is writing: name, bio, persona. One Author is assigned per Book; the same Author can write many Books. (Consolidates the older author / persona / soul concepts.)',
  },
  voice: {
    canon: 'Voice',
    def: 'The writing style and tone — how it is written: prose style, sentence rhythm, register, narrative voice. Kept separate from Author so a style can be reused or swapped independently of the pen-name identity.',
  },
  genre: {
    canon: 'Genre',
    def: 'The market category and its conventions — tropes, expected beats, reader-expectations, and comparable titles ("comps"). Drives what the story must deliver. Distinct from World (lore) and Voice (style).',
  },
  pipeline: {
    canon: 'Pipeline',
    def: 'An ordered group of Steps that run in sequence to produce or transform assets (planning → world & characters → drafting → revision → format → launch). A Book selects a Pipeline; pipelines are reusable templates.',
  },
  sequence: {
    canon: 'Sequence',
    def: 'An ordered list of pipelines a book runs in sequence. A Book can run several pipelines back-to-back; a Sequence names that ordered chain as a reusable preset.',
  },
  section: {
    canon: 'Section',
    def: 'Reusable book-section templates — front and back matter (title page, dedication, author note, also-by). Sections are part of the Manuscript.',
  },
  skill: {
    canon: 'Skill',
    def: 'A reusable instruction block attached to a Step and injected into its Prompt — focused know-how (e.g. "write vivid sensory detail", "audit dialogue"). Skills are machinery you attach to Steps, not content the Book owns.',
  },
  editor: {
    canon: 'Editor',
    def: 'An interactive developmental-editor persona you chat with to finetune ideas.',
  },
};
