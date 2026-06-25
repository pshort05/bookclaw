import type { AuditReport } from '../consistency/audit.js';
import type { ConsistencyFinding } from '../consistency/types.js';

const SEV_ORDER = ['high', 'medium', 'low'] as const;

/** Pure renderer: AuditReport -> a reviewable markdown report + a one-line summary. */
export function renderConsistencyReport(report: AuditReport): { title: string; markdown: string; summary: string } {
  const f = report.findings ?? [];
  const summary = `${f.length} finding${f.length === 1 ? '' : 's'} across ${report.chaptersScanned} chapter(s)`;
  const L: string[] = [];
  L.push('# Consistency report');
  L.push('');
  L.push(`_Generated ${report.generatedAt}_`);
  L.push('');
  L.push(`- Chapters scanned: ${report.chaptersScanned}`);
  L.push(`- Facts: ${report.factCount} · Knowledge events: ${report.knowledgeEventCount} · Non-canonical scenes: ${report.nonCanonicalSceneCount}`);
  L.push(`- Findings: ${f.length}`);
  L.push('');
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
