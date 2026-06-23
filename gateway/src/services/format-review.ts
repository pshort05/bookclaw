import { existsSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { selectChapterFiles } from './consistency/audit.js';
import { validateFormFit, type StoryForm } from './story-forms.js';

export interface LengthReview {
  perChapter: { chapter: string; words: number; target: number; delta: number }[];
  totalWords: number;
  totalTarget: number;
  withinBand: boolean;
  bandMessage?: string;
  genreRange: [number, number] | null;
}

/** Parse "70,000–120,000 words" / "80,000-110,000 words" → [min,max]. */
export function parseGenreWordRange(md: string): [number, number] | null {
  const m = md.match(/([\d,]{4,})\s*[–—-]\s*([\d,]{4,})\s*words/i);
  if (!m) return null;
  const lo = parseInt(m[1].replace(/,/g, ''), 10);
  const hi = parseInt(m[2].replace(/,/g, ''), 10);
  return Number.isFinite(lo) && Number.isFinite(hi) ? [lo, hi] : null;
}

function wordCount(text: string): number {
  const t = text.replace(/[#*_>`~\-]/g, ' ').trim();
  return t ? t.split(/\s+/).length : 0;
}

/** Per-chapter word counts from the book's chapter prose (deterministic). */
export function countChapterWords(dataDir: string): { chapter: string; words: number }[] {
  if (!existsSync(dataDir)) return [];
  let files: string[];
  try { files = selectChapterFiles(readdirSync(dataDir)); } catch { return []; }
  return files.map((f) => {
    let words = 0;
    try { words = wordCount(readFileSync(join(dataDir, f), 'utf-8')); } catch { words = 0; }
    return { chapter: f.replace(/\.md$/, ''), words };
  });
}

export function loadLengthOverrides(dataDir: string): Record<string, number> {
  try {
    const p = join(dataDir, '.length-targets.json');
    if (!existsSync(p)) return {};
    const raw = JSON.parse(readFileSync(p, 'utf-8'));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw)) if (typeof v === 'number' && v > 0) out[k] = v;
    return out;
  } catch { return {}; }
}

export function saveLengthOverrides(dataDir: string, obj: Record<string, number>): void {
  writeFileSync(join(dataDir, '.length-targets.json'), JSON.stringify(obj, null, 2) + '\n', 'utf-8');
}

export function buildLengthReview(args: {
  chapters: { chapter: string; words: number }[];
  wordsPerChapter: number;
  overrides: Record<string, number>;
  form: StoryForm | null;
  genreRange: [number, number] | null;
}): LengthReview {
  const perChapter = args.chapters.map((c) => {
    const target = args.overrides[c.chapter] ?? args.wordsPerChapter;
    return { chapter: c.chapter, words: c.words, target, delta: c.words - target };
  });
  const totalWords = perChapter.reduce((a, c) => a + c.words, 0);
  const totalTarget = perChapter.reduce((a, c) => a + c.target, 0);
  let withinBand = true;
  let bandMessage: string | undefined;
  if (args.form) {
    const n = perChapter.length || 1;
    const fit = validateFormFit(args.form, n, Math.round(totalTarget / n));
    withinBand = fit.ok; bandMessage = fit.message;
  }
  return { perChapter, totalWords, totalTarget, withinBand, bandMessage, genreRange: args.genreRange };
}

export function parseBeatMappingResponse(text: string): {
  mapping: Record<string, number[]>;
  customBeats?: { name: string; expectedPct: number; pctRange: [number, number]; description: string }[];
} {
  try {
    const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
    const parsed = JSON.parse(stripped) as any;
    const mapping: Record<string, number[]> = {};
    if (parsed?.mapping && typeof parsed.mapping === 'object') {
      for (const [k, v] of Object.entries(parsed.mapping)) {
        if (Array.isArray(v)) mapping[k] = (v as unknown[]).map(Number).filter((n) => Number.isFinite(n) && n >= 1);
      }
    }
    const customBeats = Array.isArray(parsed?.customBeats)
      ? parsed.customBeats.map((b: any) => ({
          name: String(b.name ?? ''),
          expectedPct: Number(b.expectedPct) || 0,
          pctRange: (Array.isArray(b.pctRange) ? [Number(b.pctRange[0]) || 0, Number(b.pctRange[1]) || 100] : [0, 100]) as [number, number],
          description: String(b.description ?? ''),
        })).filter((b: { name: string }) => b.name)
      : undefined;
    return customBeats ? { mapping, customBeats } : { mapping };
  } catch { return { mapping: {} }; }
}

export function loadStructureReview(dataDir: string): { outline: { chapter: number; summary: string }[]; mapping: Record<string, number[]> } {
  try {
    const p = join(dataDir, '.structure-review.json');
    if (!existsSync(p)) return { outline: [], mapping: {} };
    const raw = JSON.parse(readFileSync(p, 'utf-8'));
    const outline = Array.isArray(raw?.outline) ? raw.outline.filter((o: any) => o && typeof o.summary === 'string') : [];
    const mapping = (raw?.mapping && typeof raw.mapping === 'object' && !Array.isArray(raw.mapping)) ? raw.mapping : {};
    return { outline, mapping };
  } catch { return { outline: [], mapping: {} }; }
}

export function saveStructureReview(dataDir: string, obj: { outline: { chapter: number; summary: string }[]; mapping: Record<string, number[]> }): void {
  writeFileSync(join(dataDir, '.structure-review.json'), JSON.stringify(obj, null, 2) + '\n', 'utf-8');
}
