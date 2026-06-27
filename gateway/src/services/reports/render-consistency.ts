import type { AuditReport } from '../consistency/audit.js';
import type { ConsistencyFinding } from '../consistency/types.js';

const SEV_ORDER = ['high', 'medium', 'low'] as const;

/** Pure renderer: AuditReport -> a reviewable markdown report + a one-line summary. */
export function renderConsistencyReport(report: AuditReport): { title: string; markdown: string; summary: string } {
  const f = report.findings ?? [];
  const total = report.chaptersTotal ?? report.chaptersScanned;
  const failed = report.chaptersFailed ?? 0;
  const samples = report.failureSamples ?? [];
  const summary = `${f.length} finding${f.length === 1 ? '' : 's'} across ${report.chaptersScanned}/${total} chapter(s)${failed ? ` — ${failed} failed` : ''}`;
  const L: string[] = [];
  L.push('# Consistency report');
  L.push('');
  L.push(`_Generated ${report.generatedAt}_`);
  L.push('');
  if (failed > 0) {
    const head = report.aborted
      ? `> ⚠ **Scan aborted:** the first ${failed} chapter(s) all failed extraction with no successes — a systemic error, so the rest were skipped.`
      : `> ⚠ **Incomplete scan:** ${failed} of ${total} chapter(s) failed extraction and were skipped. Findings below cover only the ${report.chaptersScanned} scanned chapter(s) — this is NOT a clean bill of health.`;
    L.push(head);
    if (samples.length) {
      L.push('>');
      L.push('> Failure reason(s):');
      for (const s of samples) L.push(`> - ${s}`);
    }
    L.push('');
  }
  L.push(`- Chapters scanned: ${report.chaptersScanned} of ${total}${failed ? ` (${failed} failed)` : ''}`);
  if (report.estimatedCost && report.estimatedCost > 0) {
    L.push(`- Estimated AI cost: ~$${report.estimatedCost.toFixed(4)}`);
  }
  L.push(`- Facts: ${report.factCount} · Knowledge events: ${report.knowledgeEventCount} · Non-canonical scenes: ${report.nonCanonicalSceneCount}`);
  L.push(`- Findings: ${f.length}`);
  L.push('');

  const rows = report.chapterSummary ?? [];
  if (rows.length) {
    L.push('## Chapter summary');
    L.push('');
    L.push('| Chapter | Scan | High | Medium | Low | Items tracked |');
    L.push('| --- | --- | ---: | ---: | ---: | ---: |');
    const mark = (s: string) => (s === 'scanned' ? '✓ scanned' : s === 'failed' ? '✗ failed' : '— skipped');
    for (const r of rows) {
      L.push(`| ${r.chapter} | ${mark(r.status)} | ${r.high} | ${r.medium} | ${r.low} | ${r.itemsTracked} |`);
    }
    L.push('');
  }

  L.push('## Findings');
  if (f.length === 0) L.push('No consistency findings.');
  for (const sev of SEV_ORDER) {
    const group = f.filter((x) => x.severity === sev);
    if (!group.length) continue;
    L.push('');
    L.push(`### ${sev.toUpperCase()} (${group.length})`);
    for (const x of group) L.push(renderFinding(x));
  }
  if (report.reverseIndex?.length) {
    L.push('');
    L.push('## Impact index (fact → chapters)');
    for (const r of report.reverseIndex) L.push(`- **${r.entity} · ${r.attribute}**${r.isCanon ? ' _(canon)_' : ''}: ${r.chapters.join(', ')}`);
  }
  if (report.orphanFacts?.length) {
    L.push('');
    L.push('## Orphan canon facts (never dramatized)');
    for (const o of report.orphanFacts) L.push(`- **${o.entity} · ${o.attribute}**: "${o.valueRaw}"${o.world ? ` _(world: ${o.world})_` : ''}`);
  }
  L.push('');
  return { title: 'Consistency report', markdown: L.join('\n'), summary };
}

function chapRef(ref: any): string {
  if (ref?.chapter) return `${ref.chapter}${ref.scene != null ? `:${ref.scene}` : ''}`;
  if (ref?.canonSource) return ref.canonSource;
  return '—';
}

function renderFinding(x: ConsistencyFinding): string {
  return [
    '',
    `- **${x.entity} · ${x.attribute}** (${x.category})`,
    `  - ${x.explanation}`,
    `  - ${chapRef(x.a)} vs ${chapRef(x.b)}`,
    `  - Fix: ${x.suggestedFix}`,
  ].join('\n');
}
