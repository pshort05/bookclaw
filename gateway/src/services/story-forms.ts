export interface StoryForm {
  id: string;
  label: string;
  description: string;
  minWords: number;
  maxWords: number | null;            // null = open-ended
  typicalChapterRange: [number, number];
}

const FORMS: StoryForm[] = [
  { id: 'flash', label: 'Flash Fiction', description: 'A complete story in a single sitting; one scene or moment.', minWords: 100, maxWords: 1500, typicalChapterRange: [1, 1] },
  { id: 'short-story', label: 'Short Story', description: 'A single dramatic arc, usually one POV.', minWords: 1000, maxWords: 7500, typicalChapterRange: [1, 3] },
  { id: 'novelette', label: 'Novelette', description: 'Longer than a short story; room for a subplot.', minWords: 7500, maxWords: 17500, typicalChapterRange: [3, 8] },
  { id: 'novella', label: 'Novella', description: 'A focused single-thread novel; tight cast.', minWords: 17500, maxWords: 40000, typicalChapterRange: [8, 20] },
  { id: 'novel', label: 'Novel', description: 'Full-length work with subplots and a developed arc.', minWords: 40000, maxWords: 120000, typicalChapterRange: [20, 45] },
  { id: 'epic', label: 'Epic', description: 'Large-scale, multi-thread, often multi-POV.', minWords: 120000, maxWords: null, typicalChapterRange: [40, 120] },
  { id: 'serial', label: 'Serial (episodic)', description: 'Episodic installments; open-ended length, chapter-as-episode pacing.', minWords: 2000, maxWords: null, typicalChapterRange: [10, 200] },
  { id: 'pulp', label: 'Pulp (fast, lean)', description: 'Fast, plot-forward, lean prose; quick chapters.', minWords: 25000, maxWords: 60000, typicalChapterRange: [20, 40] },
];

export function listForms(): StoryForm[] { return FORMS; }
export function getForm(id: string): StoryForm | null { return FORMS.find(f => f.id === id) ?? null; }

/**
 * Validate that chapterCount × wordsPerChapter falls inside the form's word band.
 * Serial/Epic (maxWords === null) enforce only the minimum.
 */
export function validateFormFit(form: StoryForm, chapterCount: number, wordsPerChapter: number): { ok: boolean; total: number; message?: string } {
  const total = Math.max(0, Math.floor(chapterCount)) * Math.max(0, Math.floor(wordsPerChapter));
  if (total < form.minWords) {
    return { ok: false, total, message: `${form.label} is at least ${form.minWords.toLocaleString()} words; ${chapterCount}×${wordsPerChapter.toLocaleString()} = ${total.toLocaleString()} is too short.` };
  }
  if (form.maxWords !== null && total > form.maxWords) {
    return { ok: false, total, message: `${form.label} is at most ${form.maxWords.toLocaleString()} words; ${chapterCount}×${wordsPerChapter.toLocaleString()} = ${total.toLocaleString()} exceeds the band — choose a longer form or lower the counts.` };
  }
  return { ok: true, total };
}
