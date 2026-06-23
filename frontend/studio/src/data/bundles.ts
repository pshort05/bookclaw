// Public Starter Bundles for the Easy Button. PURE DATA — keep zero imports so
// the backend unit test (NodeNext/tsx) can import this file directly.
//
// IP rule (enforced by tests/unit/easy-button-bundles.test.ts): every
// author/voice/genre/sequence below MUST be a committed built-in library/ asset
// — never a workspace overlay asset, PKstyle, or a real pen name.
export interface StarterBundle {
  id: string;
  title: string;
  tagline: string;
  icon: string; // emoji (Font Awesome is not loaded in the studio)
  author: string;
  voice: string;
  genre: string;
  sequence: string;
  format: { structure: string; form: string; chapterCount: number; wordsPerChapter: number };
  modelTier: 'free';
}

export const BUNDLES: StarterBundle[] = [
  {
    id: 'romance',
    title: 'Contemporary Romance',
    tagline: 'Heartfelt, character-driven, happily-ever-after.',
    icon: '💕',
    author: 'warm-smalltown-romance',
    voice: 'warm-smalltown-romance',
    genre: 'contemporary-romance',
    sequence: 'novel',
    format: { structure: 'romancing_the_beat', form: 'novel', chapterCount: 32, wordsPerChapter: 2500 },
    modelTier: 'free',
  },
  {
    id: 'scifi',
    title: 'Hard Sci-Fi',
    tagline: 'Big ideas, real science, a sense of wonder.',
    icon: '🚀',
    author: 'kinetic-ya-scifi',
    voice: 'kinetic-ya-scifi',
    genre: 'hard-science-fiction',
    sequence: 'novel',
    format: { structure: 'three_act', form: 'novel', chapterCount: 30, wordsPerChapter: 2800 },
    modelTier: 'free',
  },
  {
    id: 'thriller',
    title: 'Thriller',
    tagline: 'Relentless pace, rising stakes, no safe ground.',
    icon: '⚡',
    author: 'contemporary-thriller',
    voice: 'contemporary-thriller',
    genre: 'military-thriller',
    sequence: 'novel',
    format: { structure: 'three_act', form: 'novel', chapterCount: 40, wordsPerChapter: 2000 },
    modelTier: 'free',
  },
];
