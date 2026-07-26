/**
 * Verbalized Sampling — the engine behind the writer-facing "Alternate Takes".
 * Provider-agnostic: wraps whatever AI-complete function it's handed, composes a
 * VS envelope onto the caller's craft prompt (envelope LAST so it defines only the
 * output format, never overwriting craft), parses k candidate "takes", and fails
 * OPEN to a single direct completion. Owns no pipeline state. See
 * docs/superpowers/specs/2026-07-26-verbalized-sampling-design.md.
 */
export interface VsConfig { k: number; probabilityThreshold: number; variant: 'standard' | 'cot' | 'multi'; }
export interface VsCandidate { index: number; text: string; }
export interface VsResult { candidates: VsCandidate[]; degraded: boolean; variant: VsConfig['variant']; k: number; }
export interface VsRouting { provider: string; model?: string; temperature?: number; }
export type VsComplete = (req: { provider: string; system: string; messages: Array<{ role: 'user' | 'assistant'; content: string }>; maxTokens?: number; temperature?: number; model?: string }) => Promise<{ text: string }>;

export const VS_DEFAULTS: VsConfig = { k: 5, probabilityThreshold: 0.10, variant: 'cot' };

export function composeVsPrompt(basePrompt: string, config: VsConfig): string {
  const cot = config.variant === 'cot'
    ? 'First think briefly about what the most obvious/typical response would be, then deliberately spread AWAY from it. '
    : '';
  const envelope =
    `\n\n---\nRESPONSE FORMAT (Alternate Takes): ${cot}Give exactly ${config.k} DISTINCT candidates, each genuinely different in direction, not surface rewordings. ` +
    `Bias toward lower-probability (less typical) responses — each candidate's estimated probability should be under ${config.probabilityThreshold}. ` +
    `Output ONLY the ${config.k} blocks, nothing before or after, each on its own line:\n` +
    `<take p="0.07">the candidate</take>`;
  return `${basePrompt}${envelope}`;
}

const TAKE_RE = /<take\s+p\s*=\s*"?([0-9]*\.?[0-9]+)"?\s*>([\s\S]*?)<\/take>/gi;

export function parseTakes(raw: string, k: number): VsCandidate[] | null {
  const out: VsCandidate[] = [];
  let m: RegExpExecArray | null;
  TAKE_RE.lastIndex = 0;
  while ((m = TAKE_RE.exec(raw)) !== null) {
    const prob = Number(m[1]);
    const text = m[2].trim();
    if (!Number.isFinite(prob) || !text) return null; // probability required + non-empty
    out.push({ index: out.length, text });
  }
  if (out.length !== k) return null;
  return out;
}

export async function runVerbalizedSampling(args: {
  basePrompt: string; systemPrompt: string; routing: VsRouting; config: VsConfig; complete: VsComplete; maxTokens?: number;
}): Promise<VsResult> {
  const { basePrompt, systemPrompt, routing, config, complete } = args;
  const maxTokens = args.maxTokens ?? Math.min(8192, 512 * config.k);
  const composed = composeVsPrompt(basePrompt, config);
  const call = (prompt: string, mt: number) => complete({
    provider: routing.provider, system: systemPrompt,
    messages: [{ role: 'user', content: prompt }],
    maxTokens: mt, temperature: routing.temperature, model: routing.model,
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await call(composed, maxTokens);
      const parsed = parseTakes(res.text, config.k);
      if (parsed) return { candidates: parsed, degraded: false, variant: config.variant, k: config.k };
    } catch { /* fall through to retry / fallback */ }
  }
  // Fail open: one plain direct completion, flagged degraded, no candidates to pick.
  console.log('  ⚠ Alternate Takes: VS output unparseable after retry — degrading to a single direct completion');
  const direct = await call(basePrompt, maxTokens);
  return { candidates: [{ index: 0, text: direct.text }], degraded: true, variant: config.variant, k: config.k };
}
