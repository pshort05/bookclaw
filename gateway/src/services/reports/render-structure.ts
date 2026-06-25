import type { LengthReview } from '../format-review.js';

/** Pure renderer: structure + length review -> a reviewable markdown report + a one-line summary. */
export function renderStructureReport(input: { structure?: unknown; mapping?: unknown; length: LengthReview }): { title: string; markdown: string; summary: string } {
  const length = input.length;
  const summary = `${length.totalWords} words, ${length.withinBand ? 'in band' : 'OUT OF BAND'}`;
  const L: string[] = [];
  L.push('# Structure & Length report');
  L.push('');

  L.push('## Length');
  L.push('');
  L.push('| Chapter | Words | Target | Delta |');
  L.push('| --- | ---: | ---: | ---: |');
  for (const c of length.perChapter) {
    L.push(`| ${c.chapter} | ${c.words} | ${c.target} | ${c.delta >= 0 ? '+' : ''}${c.delta} |`);
  }
  L.push(`| **Total** | **${length.totalWords}** | **${length.totalTarget}** | **${length.totalWords - length.totalTarget >= 0 ? '+' : ''}${length.totalWords - length.totalTarget}** |`);
  L.push('');
  L.push(`- Form band: ${length.withinBand ? 'in band' : 'OUT OF BAND'}${length.bandMessage ? ` — ${length.bandMessage}` : ''}`);
  if (length.genreRange) L.push(`- Genre range: ${length.genreRange[0]}–${length.genreRange[1]} words`);

  const mapping = input.mapping;
  if (mapping && typeof mapping === 'object' && !Array.isArray(mapping)) {
    const entries = Object.entries(mapping as Record<string, unknown>);
    if (entries.length > 0) {
      L.push('');
      L.push('## Beat → outline mapping');
      for (const [beat, chapters] of entries) {
        const list = Array.isArray(chapters) ? chapters.join(', ') : String(chapters);
        L.push(`- **${beat}**: ${list}`);
      }
    }
  }

  L.push('');
  return { title: 'Structure & Length report', markdown: L.join('\n'), summary };
}
