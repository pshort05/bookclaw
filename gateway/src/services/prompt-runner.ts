import type { LibraryPrompt } from './library-types.js';
import { getOutputBudget } from '../ai/router.js';

/**
 * Run a single curated writing-craft prompt over the AI router. Pure: all
 * collaborators are injected. Returns null when the named prompt is unknown.
 */
export async function runPrompt(
  deps: {
    prompts?: { get(name: string): LibraryPrompt | null };
    aiRouter: { selectProvider?(t: string, p?: string): { id: string }; complete(req: any): Promise<{ text: string; tokensUsed?: number; estimatedCost?: number }> };
    costs?: { record(provider: string, tokens: number, estimatedCost?: number, bookSlug?: string): void };
  },
  promptName: string, content: string, bookSlug?: string,
): Promise<{ text: string } | null> {
  const prompt = deps.prompts?.get(promptName) ?? null;
  if (!prompt) return null;
  const provider = deps.aiRouter.selectProvider?.('prompt_run', prompt.model ? 'openrouter' : undefined) ?? { id: 'openrouter' };
  const model = prompt.model && provider.id === 'openrouter' ? prompt.model : undefined;
  const res = await deps.aiRouter.complete({
    provider: provider.id,
    system: prompt.systemPrompt,
    messages: [{ role: 'user', content }],
    maxTokens: getOutputBudget('prompt_run'),
    ...(model ? { model } : {}),
    ...(typeof prompt.temperature === 'number' ? { temperature: prompt.temperature } : {}),
  });
  try { deps.costs?.record(provider.id, res.tokensUsed ?? 0, res.estimatedCost, bookSlug); } catch { /* non-fatal */ }
  return { text: res.text };
}
