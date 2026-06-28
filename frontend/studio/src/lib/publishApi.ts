import { api, apiBase, authToken } from '@bookclaw/shared';

// Mirrors the gateway FinishOptions (gateway/src/services/format-finisher/types.ts).
export interface FinishOptions {
  range?: { start?: string; end?: string };
  clean?: boolean;
  pageBreaks?: boolean;
  fixHrules?: boolean;
  fixToc?: boolean;
  indentParagraphs?: boolean;
  fixFirstParagraph?: boolean;
  lineSpacing?: number;
  spaceAfter?: number;
  excerptFont?: string;
  chapterInitial?: { font: string; size: number };
  fontTo?: string;
  fontSkip?: string[];
  fontSub?: { from: string; to: string; color?: string };
  fontSizeChange?: { from: number; to: number };
  stripEmbeddedFonts?: boolean;
  output?: string;
}

/** Upload a bring-your-own .docx into the book's data/ dir (the finisher's input source). */
export async function uploadDocx(slug: string, file: File): Promise<{ path: string }> {
  const fd = new FormData();
  fd.append('file', file);
  const t = authToken();
  const res = await fetch(`${apiBase()}/api/books/${encodeURIComponent(slug)}/finish-upload`, {
    method: 'POST', headers: t ? { Authorization: `Bearer ${t}` } : {}, body: fd,
  });
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string })?.error || String(res.status));
  return res.json();
}

/** Apply the KDP DOCX finisher to a book .docx; returns the new file's book-root path. */
export const finishDocx = (slug: string, path: string, options: FinishOptions) =>
  api<{ outputPath: string; bytes: number }>(`/api/books/${encodeURIComponent(slug)}/format-finish`, {
    method: 'POST', body: JSON.stringify({ path, options }),
  });

// ── Launch tab — thin wrappers over the existing launch/calendar/ads endpoints ──
export const kdpBlurb = (blurb: string) =>
  api<{ characterCount: number; limit?: number; withinLimit?: boolean } & Record<string, unknown>>(
    `/api/kdp/export-blurb`, { method: 'POST', body: JSON.stringify({ blurb }) });

export const proposeAmsCampaigns = (p: { bookTitle: string; genre: string; keywords: string[]; dailyBudgetCeilingUSD: number }) =>
  api<{ campaigns: any[] }>(`/api/ams/propose-campaigns`, { method: 'POST', body: JSON.stringify(p) });

export const bookbubDraft = (p: { title: string; authorName: string; genre: string; amazonBlurb: string }) =>
  api<{ draft: any }>(`/api/bookbub/draft`, { method: 'POST', body: JSON.stringify(p) });

export const pricePulsePlan = (p: { projectId: string; bookTitle: string; releaseDate: string; launchPrice?: number; tailPrice?: number }) =>
  api<{ events: any[] }>(`/api/calendar/price-pulse-plan`, { method: 'POST', body: JSON.stringify(p) });

export const listLaunches = () => api<{ launches: any[] }>(`/api/launches`);
