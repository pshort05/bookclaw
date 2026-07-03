/**
 * Rolling-summary memory (Flagship Plan 4, Task 2).
 *
 * A pure function over the ContextEngine's own stored shapes — reuses
 * `ChapterSummary`/`EntityEntry` from context-engine.ts rather than
 * reimplementing summarization. Builds a four-tier memory block for the
 * chapter about to be drafted:
 *   1. Recent chapters (the 2 immediately prior) — full summary + ending state.
 *   2. Current-arc beats (the next 6 chapters back) — one-line compressed.
 *   3. Macro events (everything older) — very short, one line each.
 *   4. Entity registry — full character/location/item roster with attributes.
 *
 * Only chapters STRICTLY BEFORE `chapterNumber` are ever included — a chapter
 * must never see its own or a future chapter's summary (that would leak
 * information the story hasn't reached yet).
 */
import type { ChapterSummary, EntityEntry } from '../context-engine.js';

const RECENT_COUNT = 2;
const ARC_COUNT = 6;
const BLOCK_CAP = 8000;

export function buildRollingSummary(args: {
  summaries: ChapterSummary[];
  entities: EntityEntry[];
  chapterNumber: number;
}): string {
  const { summaries, entities, chapterNumber } = args;

  const prior = summaries
    .filter(s => s.chapterNumber < chapterNumber)
    .sort((a, b) => a.chapterNumber - b.chapterNumber);

  if (prior.length === 0 && entities.length === 0) return '';

  const recentStart = Math.max(0, prior.length - RECENT_COUNT);
  const arcStart = Math.max(0, prior.length - RECENT_COUNT - ARC_COUNT);
  const recent = prior.slice(recentStart);
  const arc = prior.slice(arcStart, recentStart);
  const macro = prior.slice(0, arcStart);

  const parts: string[] = ['## Rolling Story Memory'];

  if (recent.length > 0) {
    parts.push(
      '### Recent Chapters (full detail)\n' +
      recent.map(s =>
        `**Ch ${s.chapterNumber} — ${s.title}**\n${s.summary}\nEnding: ${s.endingState}`
      ).join('\n\n')
    );
  }

  if (arc.length > 0) {
    parts.push(
      '### Current Arc (compressed)\n' +
      arc.map(s => `- Ch ${s.chapterNumber} — ${s.title}: ${(s.endingState || s.summary).slice(0, 150)}`).join('\n')
    );
  }

  if (macro.length > 0) {
    parts.push(
      '### Macro Events (earlier story)\n' +
      macro.map(s => `- Ch ${s.chapterNumber}: ${(s.endingState || s.summary).slice(0, 80)}`).join('\n')
    );
  }

  if (entities.length > 0) {
    parts.push(
      '### Entity Registry\n' +
      entities.map(e => {
        const attrs = Object.entries(e.attributes).map(([k, v]) => `${k}: ${v}`).join(', ');
        return `- **${e.name}** (${e.type}): ${e.description}${attrs ? ` (${attrs})` : ''}`;
      }).join('\n')
    );
  }

  let block = parts.join('\n\n');
  if (block.length > BLOCK_CAP) {
    block = block.slice(0, BLOCK_CAP) + '\n…[truncated]';
  }
  return block;
}
