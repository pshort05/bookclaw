import type { BookClawResult } from '../bookclaw-client.js';

export function toToolResult(label: string, result: BookClawResult) {
  if (!result.ok) {
    return { isError: true, content: [{ type: 'text' as const, text: `${label} failed: ${result.error}` }] };
  }
  return { content: [{ type: 'text' as const, text: JSON.stringify(result.data, null, 2) }] };
}
