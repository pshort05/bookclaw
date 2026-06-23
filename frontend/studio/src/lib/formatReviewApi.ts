import { api } from '@bookclaw/shared';

export interface BeatResult {
  beat: { name: string; expectedPct: number; pctRange: [number, number]; description: string; mustHave: boolean };
  foundAtPct: number | null;
  status: 'found_in_range' | 'found_misplaced' | 'missing';
  suggestion: string;
}
export interface StructureReport {
  structureName: string;
  totalBeats: number;
  beatsFoundInRange: number;
  beatsFoundMisplaced: number;
  beatsMissing: number;
  results: BeatResult[];
  summary: string;
  needsAttention: boolean;
}
export interface StructureReview {
  configured?: false;   // present + false when the book has no declared format
  structure: { id: string; name: string; beats: BeatResult['beat'][] } | null;
  outline: { chapter: number; summary: string }[];
  mapping: Record<string, number[]>;
  report: StructureReport | null;
}
export interface LengthReview {
  configured?: false;   // present + false when the book has no declared format
  perChapter: { chapter: string; words: number; target: number; delta: number }[];
  totalWords: number;
  totalTarget: number;
  withinBand: boolean;
  bandMessage?: string;
  genreRange: [number, number] | null;
}

export const getStructureReview = (slug: string) =>
  api<StructureReview>(`/api/books/${encodeURIComponent(slug)}/structure-review`);

export const proposeStructure = (slug: string) =>
  api<{ mapping: Record<string, number[]>; customBeats?: unknown[] }>(
    `/api/books/${encodeURIComponent(slug)}/structure-review/propose`, { method: 'POST', body: '{}' });

export const saveStructureReview = (slug: string, body: { outline: { chapter: number; summary: string }[]; mapping: Record<string, number[]> }) =>
  api<{ ok: boolean }>(`/api/books/${encodeURIComponent(slug)}/structure-review`, { method: 'PUT', body: JSON.stringify(body) });

export const getLengthReview = (slug: string) =>
  api<LengthReview>(`/api/books/${encodeURIComponent(slug)}/length-review`);

export const saveLengthTargets = (slug: string, overrides: Record<string, number>) =>
  api<{ ok: boolean }>(`/api/books/${encodeURIComponent(slug)}/length-targets`, { method: 'PUT', body: JSON.stringify({ overrides }) });
