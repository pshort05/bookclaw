import type { BetaReaderReport, ChapterFeedback } from '../beta-reader.js';

/** Pure renderer: BetaReaderReport -> a reviewable markdown report + a one-line summary. */
export function renderBetaReaderReport(report: BetaReaderReport): { title: string; markdown: string; summary: string } {
  const feedback = report.feedback ?? [];
  const agg = report.aggregate;
  const summary = `${report.chapterCount} chapters · ${report.archetypeCount} readers`;
  const L: string[] = [];

  L.push('# Beta Reader report');
  L.push('');
  L.push(`_Generated ${report.generatedAt}_`);
  L.push('');

  L.push('## Aggregate');
  L.push(`- Average Tension: ${agg.avgTension}/10`);
  L.push(`- Average Want-to-Continue: ${agg.avgWantToContinue}%`);
  if (agg.weakestChapter) {
    L.push(`- Weakest chapter: Ch ${agg.weakestChapter.number} — ${agg.weakestChapter.title} (${agg.weakestChapter.reason})`);
  }
  if (agg.strongestChapter) {
    L.push(`- Strongest chapter: Ch ${agg.strongestChapter.number} — ${agg.strongestChapter.title} (${agg.strongestChapter.reason})`);
  }
  L.push(`- Top emotions: ${agg.topEmotions.length ? agg.topEmotions.join(', ') : '—'}`);
  L.push(`- Top confusions: ${agg.topConfusions.length ? agg.topConfusions.join(', ') : '—'}`);
  L.push('');

  L.push('## Chapter feedback');
  if (feedback.length === 0) L.push('No chapter feedback.');
  for (const f of feedback) L.push(renderFeedback(f));
  L.push('');

  return { title: 'Beta Reader report', markdown: L.join('\n'), summary };
}

function renderFeedback(f: ChapterFeedback): string {
  const lines = [
    '',
    `### Ch ${f.chapterNumber}: ${f.title} — ${f.archetypeName}`,
    `- Tension: ${f.tension}/10 · Pacing: ${f.pacing} · Want-to-continue: ${f.wantToContinue}%`,
    `- Overall: ${f.overallNote}`,
  ];
  if (f.favoriteMoment) lines.push(`- Favorite moment: ${f.favoriteMoment}`);
  if (f.stumblePoint) lines.push(`- Stumble point: ${f.stumblePoint}`);
  if (f.emotions.length) lines.push(`- Emotions: ${f.emotions.join(', ')}`);
  if (f.confusion.length) lines.push(`- Confusion: ${f.confusion.join('; ')}`);
  return lines.join('\n');
}
