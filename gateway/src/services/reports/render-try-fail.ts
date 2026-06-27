import type { TryFailReport, ProtagonistLadder, TryFailFinding } from '../try-fail/types.js';

/** Pure renderer: TryFailReport -> a reviewable markdown report + a one-line summary. */
export function renderTryFailReport(r: TryFailReport): { title: string; markdown: string; summary: string } {
  const protCount = r.protagonists?.length ?? 0;
  const findingCount = r.findings?.length ?? 0;
  const high = (r.findings ?? []).filter((f) => f.severity === 'high').length;
  const summary = `${protCount} protagonist${protCount === 1 ? '' : 's'}, ${findingCount} finding${findingCount === 1 ? '' : 's'} (${high} high)`;

  const L: string[] = [];
  L.push('# Try-Fail & Escalation report');
  L.push('');
  L.push(`- Protagonists: ${protCount}`);
  L.push(`- Findings: ${findingCount} (${high} high)`);
  L.push(`- Crucible: ${crucibleVerdict(r)}`);
  if (r.condensed) L.push('- Note: the manuscript was condensed (head+tail per chapter) before analysis.');
  L.push('');

  L.push('## Protagonist ladders');
  if (protCount === 0) {
    L.push('No protagonists were identified.');
  } else {
    for (const p of r.protagonists) renderLadder(L, p);
  }

  L.push('');
  L.push('## Crucible check');
  L.push(`- Present: ${r.crucible?.present ? 'yes' : 'no'}`);
  L.push(`- Strongest binding force: ${r.crucible?.strongest ?? 'none'}`);
  for (const s of r.crucible?.signals ?? []) {
    L.push(`  - [${s.kind}, ${s.strength}] ch${s.chapter}: ${s.description}`);
  }
  if (r.crucible?.finding) L.push(`- ${severityTag(r.crucible.finding)} ${r.crucible.finding.detail}`);

  L.push('');
  L.push('## Findings');
  renderFindingsBySeverity(L, r.findings ?? []);

  L.push('');
  return { title: 'Try-Fail & Escalation report', markdown: L.join('\n'), summary };
}

function renderLadder(L: string[], p: ProtagonistLadder): void {
  L.push('');
  L.push(`### ${p.protagonist}`);
  L.push(`- Deepens (stakes rise): ${p.deepens ? 'yes' : 'no'}`);
  L.push(`- Broadens (affects more people): ${p.broadens ? 'yes' : 'no'}`);
  L.push(`- First attempt outcome: ${p.firstAttemptOutcome}`);
  L.push('');
  if ((p.attempts?.length ?? 0) === 0) {
    L.push('No attempts recorded.');
  } else {
    L.push('| Chapter | Goal | Outcome | Cost | Stakes | Affected |');
    L.push('| --- | --- | --- | --- | --- | --- |');
    for (const a of p.attempts) {
      L.push(`| ${a.chapter} | ${cell(a.goal)} | ${a.outcome} | ${a.cost} | ${a.personalStakes} | ${a.peopleAffected} |`);
    }
  }
  if ((p.findings?.length ?? 0) > 0) {
    L.push('');
    for (const f of p.findings) L.push(`- ${severityTag(f)} ${f.detail}`);
  }
}

function renderFindingsBySeverity(L: string[], findings: TryFailFinding[]): void {
  if (findings.length === 0) {
    L.push('No findings — the try-fail structure and escalation look healthy.');
    return;
  }
  for (const sev of ['high', 'medium', 'low'] as const) {
    const group = findings.filter((f) => f.severity === sev);
    if (group.length === 0) continue;
    L.push('');
    L.push(`### ${sev[0].toUpperCase()}${sev.slice(1)}`);
    for (const f of group) {
      const where = f.protagonist ? ` (${f.protagonist}${typeof f.chapter === 'number' ? `, ch${f.chapter}` : ''})` : (typeof f.chapter === 'number' ? ` (ch${f.chapter})` : '');
      L.push(`- **${f.category}**${where}: ${f.detail}`);
    }
  }
}

function crucibleVerdict(r: TryFailReport): string {
  if (!r.crucible?.present) return 'absent';
  return r.crucible.strongest ?? 'none';
}

function severityTag(f: TryFailFinding): string {
  return `[${f.severity}/${f.category}]`;
}

/** Escape pipe + newline so a free-text cell can't break the markdown table. */
function cell(s: string): string {
  return String(s ?? '').replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');
}
