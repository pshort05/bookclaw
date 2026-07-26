import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/** One Alternate Takes pick — the preference-dataset / future fine-tuning corpus record. */
export interface TakesLogRecord {
  id: string; at: string; bookSlug: string; projectId: string; stepId: string; role: string;
  variant: string; k: number; threshold: number; provider: string; model: string; contextRef: string;
  candidates: Array<{ index: number; text: string }>; chosenIndex: number; edited: boolean;
  diversityScore: number | null; degraded: boolean;
}

/**
 * Append one selection to the book's Alternate Takes preference log
 * (`<dataDir>/vs-selections.jsonl`). Fail-soft — logging never blocks a pick.
 * `dataDir` is the book's resolved data directory (as used by persistStepResultFile).
 */
export function appendTakesLog(dataDir: string, rec: TakesLogRecord): void {
  try {
    mkdirSync(dataDir, { recursive: true });
    appendFileSync(join(dataDir, 'vs-selections.jsonl'), JSON.stringify(rec) + '\n', 'utf-8');
  } catch (err) {
    console.log(`  ⚠ Alternate Takes: could not append selection log: ${(err as Error)?.message || err}`);
  }
}
