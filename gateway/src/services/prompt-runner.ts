import type { LibraryPrompt } from './library-types.js';
import { getOutputBudget } from '../ai/router.js';

export interface RunMeta {
  provider: string;
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  tokensUsed: number;
  estimatedCost: number;
  ms: number;
  tokensPerSecond?: number;
}

export interface RunResult {
  text: string;
  meta: RunMeta;
}

/**
 * Run a single curated writing-craft prompt over the AI router. Pure: all
 * collaborators are injected. Returns null when the named prompt is unknown.
 */
export async function runPrompt(
  deps: {
    prompts?: { get(name: string): LibraryPrompt | null };
    aiRouter: { selectProvider?(t: string, p?: string): { id: string }; complete(req: any): Promise<{ text: string; tokensUsed?: number; estimatedCost?: number; promptTokens?: number; completionTokens?: number; model?: string }> };
    costs?: { record(provider: string, tokens: number, estimatedCost?: number, bookSlug?: string): void };
  },
  promptName: string, content: string, bookSlug?: string,
): Promise<RunResult | null> {
  const prompt = deps.prompts?.get(promptName) ?? null;
  if (!prompt) return null;
  const provider = deps.aiRouter.selectProvider?.('prompt_run', prompt.model ? 'openrouter' : undefined) ?? { id: 'openrouter' };
  const model = prompt.model && provider.id === 'openrouter' ? prompt.model : undefined;
  const t0 = Date.now();
  const res = await deps.aiRouter.complete({
    provider: provider.id,
    system: prompt.systemPrompt,
    messages: [{ role: 'user', content }],
    maxTokens: getOutputBudget('prompt_run'),
    ...(model ? { model } : {}),
    ...(typeof prompt.temperature === 'number' ? { temperature: prompt.temperature } : {}),
  });
  const ms = Date.now() - t0;
  const tokensUsed = res.tokensUsed ?? ((res.promptTokens ?? 0) + (res.completionTokens ?? 0));
  const tokensPerSecond = (res.completionTokens && ms > 0) ? res.completionTokens / (ms / 1000) : undefined;
  try { deps.costs?.record(provider.id, tokensUsed, res.estimatedCost, bookSlug); } catch { /* non-fatal */ }
  const meta: RunMeta = {
    provider: provider.id,
    model: res.model ?? model ?? provider.id,
    promptTokens: res.promptTokens,
    completionTokens: res.completionTokens,
    tokensUsed,
    estimatedCost: res.estimatedCost ?? 0,
    ms,
    tokensPerSecond,
  };
  return { text: res.text, meta };
}
