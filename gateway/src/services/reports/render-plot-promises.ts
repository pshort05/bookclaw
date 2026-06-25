import type { PromiseAuditReport } from '../plot-promises.js';

/** Pure renderer: PromiseAuditReport -> a reviewable markdown report + a one-line summary. */
export function renderPlotPromisesReport(report: PromiseAuditReport): { title: string; markdown: string; summary: string } {
  const closurePct = Math.round((report.closureRate ?? 0) * 100); // closureRate is a 0–1 fraction
  const summary = `${report.totalPromises} promises, ${closurePct}% closed`;
  const L: string[] = [];
  L.push('# Plot Promises report');
  L.push('');
  L.push(`- Total promises: ${report.totalPromises}`);
  L.push(`- Paid off: ${report.paidOff}`);
  L.push(`- Partial payoff: ${report.partialPayoff}`);
  L.push(`- Open: ${report.open}`);
  L.push(`- Intentionally unpaid: ${report.intentionallyUnpaid}`);
  L.push(`- Dropped: ${report.dropped}`);
  L.push(`- Closure rate: ${closurePct}%`);
  L.push('');

  L.push('## At-risk promises');
  const atRisk = report.atRiskPromises ?? [];
  if (atRisk.length === 0) {
    L.push('No at-risk promises.');
  } else {
    for (const p of atRisk) {
      L.push('');
      L.push(`- **${p.title}** (${p.status})`);
      L.push(`  - Introduced at chapter: ${p.introducedAtChapter}`);
      if (typeof p.closedAtChapter === 'number') L.push(`  - Closed at chapter: ${p.closedAtChapter}`);
    }
  }

  const warnings = report.redHerringWarnings ?? [];
  if (warnings.length) {
    L.push('');
    L.push('## Red-herring warnings');
    for (const w of warnings) L.push(`- **${w.title}** — chapter ${w.chapter}`);
  }

  L.push('');
  return { title: 'Plot Promises report', markdown: L.join('\n'), summary };
}
