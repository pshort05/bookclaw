/**
 * Scene-heat classifier (Flagship Plan 2, Task 2).
 *
 * Asks a cheap model to rate a scene brief's {spice, violence} 0-10, parses
 * the response with a tolerant JSON repair (same fallback used by
 * context-engine.ts / the consistency extractor), clamps to 0-10, and fails
 * soft to {spice:0, violence:0} on any error — an unclassifiable scene is
 * treated as non-explicit rather than blocking the pipeline.
 */
import { jsonrepair } from 'jsonrepair';
import type { HeatScore } from './heat.js';

/** Build the heat_check prompt sent to the classifier model. */
export function heatCheckPrompt(sceneBrief: string): string {
  return `Rate this scene brief for content intensity on a 0-10 scale for two axes:\n` +
    `- spice: sexual/romantic explicitness (0 = none, 10 = explicit)\n` +
    `- violence: graphic violence/gore (0 = none, 10 = graphic)\n\n` +
    `Scene brief:\n${sceneBrief}\n\n` +
    `Respond with ONLY a JSON object: {"spice": <0-10>, "violence": <0-10>}`;
}

function clamp(n: unknown): number {
  const num = typeof n === 'number' && Number.isFinite(n) ? n : 0;
  return Math.max(0, Math.min(10, num));
}

/** System prompt sent with every heat_check completion request. */
const HEAT_CHECK_SYSTEM = 'You rate a scene brief\'s content intensity. Return JSON {"spice":0-10,"violence":0-10} only.';

export async function classifyScene(
  sceneBrief: string,
  complete: (req: any) => Promise<{ text: string }>,
  model: { provider: string; model?: string },
): Promise<HeatScore> {
  try {
    const res = await complete({
      messages: [{ role: 'user', content: heatCheckPrompt(sceneBrief) }],
      provider: model.provider,
      ...(model.model ? { model: model.model } : {}),
      system: HEAT_CHECK_SYSTEM,
    });
    const text = res?.text ?? '';
    let parsed: any;
    try { parsed = JSON.parse(text); }
    catch {
      try { parsed = JSON.parse(jsonrepair(text)); }
      catch { return { spice: 0, violence: 0 }; }
    }
    return { spice: clamp(parsed?.spice), violence: clamp(parsed?.violence) };
  } catch {
    return { spice: 0, violence: 0 };
  }
}
