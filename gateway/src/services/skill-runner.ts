/**
 * SkillRunner (multi-step skills Phase A) — executes a skill's phases as a chain
 * of OpenRouter calls, each with its own model + temperature, passing each phase's
 * output forward as {{previous}}. Retries the FAILING phase (call throws OR returns
 * empty/whitespace output) up to `retries` (0–4), then throws. The last phase's
 * output is returned (becomes the pipeline step's output).
 *
 * The AI call is injected (a thin `complete` fn over AIRouter) so this is pure of
 * pipeline/provider wiring and unit-testable. Each phase routes to its own provider
 * (default OpenRouter when a phase sets none).
 */
import type { SkillStep } from '../skills/loader.js';

export interface SkillCompletionRequest {
  provider: string;
  system: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  model?: string;
  temperature?: number;
}
export type SkillCompleteFn = (req: SkillCompletionRequest) => Promise<{ text: string }>;

/**
 * Substitute the three supported template tokens (whitespace-tolerant). Single
 * pass with a replacer FUNCTION so substituted values are inserted verbatim —
 * no `$&`/`$1`/`` $` `` replacement-pattern interpretation, and a token literal
 * that appears inside a substituted value (e.g. LLM output containing
 * "{{guidance}}") is not re-expanded.
 */
export function renderSkillPrompt(tpl: string, vars: { input: string; previous: string; guidance: string }): string {
  return tpl.replace(/\{\{\s*(input|previous|guidance)\s*\}\}/g, (_m, key: string) => (vars as Record<string, string>)[key] ?? '');
}

/**
 * Pipeline bridge: if `skillName` resolves to an EXECUTABLE skill (has steps),
 * run its phases and return the chain output. Returns null for a passive/unknown
 * skill (caller falls back to its normal single-call generation). On failure
 * returns the `[AI provider failure] …` sentinel the step-execution paths already
 * detect (→ failStep). Records each phase's cost (aiRouter.complete doesn't).
 */
export async function runExecutableSkillStep(
  deps: {
    skills?: { getSkillByName(n: string): { steps?: SkillStep[]; retries?: number; content?: string } | undefined };
    aiRouter: { complete(req: SkillCompletionRequest): Promise<{ text: string; tokensUsed?: number; estimatedCost?: number }> };
    costs?: { record(provider: string, tokens: number, estimatedCost?: number, bookSlug?: string): void };
  },
  skillName: string | undefined,
  input: string,
  bookSlug?: string,
): Promise<string | null> {
  if (!skillName) return null;
  const skill = deps.skills?.getSkillByName?.(skillName);
  if (!skill?.steps?.length) return null;
  const complete: SkillCompleteFn = async (req) => {
    const res = await deps.aiRouter.complete(req);
    try { deps.costs?.record(req.provider, res.tokensUsed ?? 0, res.estimatedCost, bookSlug); } catch { /* non-fatal */ }
    return res;
  };
  try {
    return await new SkillRunner(complete).run(skill, input, skill.content ?? '');
  } catch (e) {
    return `[AI provider failure] ${(e as Error)?.message ?? String(e)}`;
  }
}

/**
 * Passive step-skill injection (config-not-code pipelines, F2). Returns the
 * markdown block to APPEND to a step's project context when the step references
 * a non-executable ("passive") skill, or '' when there's no skill / no content.
 * Mirrors the executable-skill resolution: prefer the book's FROZEN snapshot
 * (copy-on-create isolation) when the project is bound to a book, else fall back
 * to the mutable global SkillLoader. Shared by the bridge path (startAndRunProject)
 * and the studio run paths (projects.routes.ts /execute + /auto-execute), which
 * previously skipped passive-skill content entirely.
 */
export function passiveSkillBlock(
  deps: {
    skills?: { getSkillByName(n: string): { name?: string; content?: string } | undefined };
    books?: { skillContentOf(slug: string | null, name: string): string | null };
  },
  skillName: string | undefined,
  bookSlug?: string | null,
): string {
  if (!skillName) return '';
  const snapshot = bookSlug ? deps.books?.skillContentOf(bookSlug, skillName) ?? null : null;
  if (snapshot) return `\n\n# Skill: ${skillName}\n\n${snapshot}`;
  const skillData = deps.skills?.getSkillByName?.(skillName);
  if (skillData) return `\n\n# Skill: ${skillData.name}\n\n${skillData.content}`;
  return '';
}

export class SkillRunner {
  constructor(private complete: SkillCompleteFn) {}

  async run(skill: { name?: string; steps?: SkillStep[]; retries?: number }, input: string, guidance = ''): Promise<string> {
    const steps = skill.steps ?? [];
    if (steps.length === 0) throw new Error(`Skill "${skill.name ?? '?'}" has no executable steps`);
    const retries = Math.max(0, Math.min(4, skill.retries ?? 0));

    let previous = '';
    for (const [i, step] of steps.entries()) {
      const content = renderSkillPrompt(step.prompt, { input, previous, guidance });
      let output: string | null = null;
      let lastErr: unknown;
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          const res = await this.complete({
            provider: step.provider ?? 'openrouter',  // multi-provider; default preserves legacy OpenRouter-only skills
            system: '',
            messages: [{ role: 'user', content }],
            model: step.model,
            ...(typeof step.temperature === 'number' ? { temperature: step.temperature } : {}),
          });
          if ((res?.text ?? '').trim()) { output = res.text; break; }
          lastErr = new Error('empty output');
        } catch (e) {
          lastErr = e;
        }
      }
      if (output === null) {
        throw new Error(`Skill "${skill.name ?? '?'}" phase "${step.name ?? step.model ?? `#${i + 1}`}" failed after ${retries + 1} attempt(s): ${(lastErr as Error)?.message ?? String(lastErr)}`);
      }
      previous = output;
    }
    return previous;
  }
}
