/**
 * Chunk a chapter into ~1,000-word windows at paragraph / scene-break (`---`)
 * boundaries — never mid-sentence — for the per-window de-AI audit. Each window
 * carries the previous window's LAST paragraph as read-only seam context so a
 * cross-seam tell (an echo line, a button echoing an earlier line) can be
 * detected while edits are only emitted inside the current window.
 *
 * Pure and dependency-free.
 */

export interface DeAiWindow { text: string; seam: string; }

const wc = (s: string) => (s.trim().match(/\S+/g) || []).length;
const isSceneBreak = (p: string) => /^-{3,}$/.test(p.trim());

export function chunkChapter(text: string, targetWords = 1000): DeAiWindow[] {
  const paras = String(text ?? '').split(/\n\s*\n+/).filter(p => p.trim());
  if (paras.length === 0) return [{ text: String(text ?? ''), seam: '' }];

  const groups: string[][] = [];
  let cur: string[] = [];
  let words = 0;
  for (const p of paras) {
    if (isSceneBreak(p)) {                 // scene break closes the current window
      if (cur.length) { groups.push(cur); cur = []; words = 0; }
      cur.push(p);                         // keep the marker with the next window
      continue;
    }
    cur.push(p);
    words += wc(p);
    if (words >= targetWords) { groups.push(cur); cur = []; words = 0; }
  }
  if (cur.length) groups.push(cur);

  const windows: DeAiWindow[] = [];
  let prevLast = '';
  for (const g of groups) {
    windows.push({ text: g.join('\n\n'), seam: prevLast });
    prevLast = g[g.length - 1];
  }
  return windows;
}
