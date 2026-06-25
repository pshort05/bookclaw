export interface PromptRunReportInput {
  prompt: string;
  file: string;
  output: string;
  meta?: { provider?: string; model?: string; tokensUsed?: number; estimatedCost?: number; ms?: number };
}

/** Pure renderer: a prompt run -> a reviewable markdown report + a one-line summary. */
export function renderPromptRunReport(r: PromptRunReportInput): { title: string; markdown: string; summary: string } {
  const m = r.meta ?? {};
  const providerModel = m.provider ? `${m.provider}${m.model ? '/' + m.model : ''}` : 'unknown';
  const L: string[] = [];
  L.push('# Prompt Run report');
  L.push('');
  L.push(`- Prompt: ${r.prompt}`);
  L.push(`- Source file: ${r.file}`);
  L.push(`- Model: ${providerModel}`);
  if (typeof m.tokensUsed === 'number') L.push(`- Tokens: ${m.tokensUsed.toLocaleString()}`);
  if (typeof m.estimatedCost === 'number') L.push(`- Est. cost: $${m.estimatedCost.toFixed(4)}`);
  if (typeof m.ms === 'number') L.push(`- Elapsed: ${(m.ms / 1000).toFixed(1)}s`);
  L.push('');
  L.push('## Output');
  L.push('');
  L.push(r.output);
  L.push('');
  return { title: 'Prompt Run report', markdown: L.join('\n'), summary: `${r.prompt} on ${r.file} — ${providerModel}` };
}
