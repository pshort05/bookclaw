/**
 * BookClaw Context Engine
 * AI-powered chapter summarization, entity tracking, and continuity checking
 * for long-form fiction projects.
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

// ═══════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════

export interface ChapterSummary {
  chapterId: string;
  chapterNumber: number;
  title: string;
  summary: string;
  wordCount: number;
  characters: string[];
  locations: string[];
  timelineMarker: string;
  plotThreads: string[];
  endingState: string;
}

export interface EntityEntry {
  name: string;
  type: 'character' | 'location' | 'item' | 'event' | 'rule';
  aliases: string[];
  description: string;
  firstAppearance: string;
  lastSeen: string;
  attributes: Record<string, string>;
  changes: Array<{ chapterId: string; description: string }>;
}

export interface ProjectContext {
  projectId: string;
  summaries: ChapterSummary[];
  entities: EntityEntry[];
  updatedAt: string;
}

export interface ContinuityIssue {
  category: 'character' | 'timeline' | 'setting' | 'naming' | 'plot_thread';
  severity: 'error' | 'warning' | 'info';
  description: string;
  chapters: string[];
  evidence: string[];
  suggestion: string;
}

export interface ContinuityReport {
  projectId: string;
  generatedAt: string;
  totalIssues: number;
  issuesByCategory: Record<string, number>;
  issues: ContinuityIssue[];
}

export type AICompleteFn = (request: {
  provider: string;
  system: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  maxTokens?: number;
  temperature?: number;
}) => Promise<{ text: string; tokensUsed: number; estimatedCost: number; provider: string }>;

export type AISelectProviderFn = (taskType: string) => { id: string };

// ═══════════════════════════════════════════════════════════
// AI Prompt Constants
// ═══════════════════════════════════════════════════════════

const SUMMARY_PROMPT = `You are a story analyst. Summarize this chapter concisely for a writing AI that will use it as context when writing future chapters.

Return ONLY valid JSON with this exact structure:
{
  "summary": "200-400 word summary of key events, revelations, and emotional beats",
  "characters": ["list of character names active in this chapter"],
  "locations": ["list of locations appearing"],
  "timelineMarker": "when this takes place (e.g., 'Day 3, evening' or 'Two weeks later')",
  "plotThreads": ["active plot threads or subplots"],
  "endingState": "1-2 sentences: where things stand at chapter end"
}`;

const ENTITY_PROMPT = `You are a story analyst. Extract named entities from this chapter text.

For each entity, provide:
- name: the primary name used
- type: "character", "location", "item", "event", or "rule" (world-building rules)
- aliases: other names/titles used (max 3, only if distinct)
- description: ONE SENTENCE based on what this chapter reveals. NOT a full bio.
- attributes: a FLAT JSON object of AT MOST 3 name->value specifics revealed in this chapter only, e.g. {"mood":"anxious","location":"hospital"}. Do NOT use {"key":...,"value":...} objects or an array — just {"attributeName":"value",...}.

CRITICAL OUTPUT CONSTRAINTS:
- Description MUST be one sentence under 25 words
- Skip entities mentioned only in passing (one mention = skip)
- Maximum 12 entities total — pick the most important
- Output MUST be valid JSON. No markdown code fences. No commentary.
- Close every brace and bracket. Truncated JSON is unusable.

Return ONLY this JSON shape:
{"entities":[{"name":"...","type":"character","aliases":[],"description":"...","attributes":{"mood":"anxious","location":"hospital"}}]}`;

const CONTINUITY_CHARACTER_PROMPT = `You are a continuity editor. Review these character profiles tracked across multiple chapters of a novel. Identify any inconsistencies, contradictions, or errors.

For each issue found, provide:
- category: "character"
- severity: "error" (definite contradiction), "warning" (likely error), or "info" (worth noting)
- description: what the inconsistency is
- chapters: which chapters are involved
- evidence: the conflicting details
- suggestion: how to fix it

Return ONLY valid JSON:
{ "issues": [ { "category": "character", "severity": "...", "description": "...", "chapters": [], "evidence": [], "suggestion": "..." } ] }

If no issues are found, return: { "issues": [] }`;

const CONTINUITY_TIMELINE_PROMPT = `You are a continuity editor. Review these timeline markers tracked across sequential chapters of a novel. Identify any chronological inconsistencies, impossible time jumps, or contradictions in the passage of time.

For each issue found, provide:
- category: "timeline"
- severity: "error" (definite contradiction), "warning" (likely error), or "info" (worth noting)
- description: what the inconsistency is
- chapters: which chapters are involved
- evidence: the conflicting details
- suggestion: how to fix it

Return ONLY valid JSON:
{ "issues": [ { "category": "timeline", "severity": "...", "description": "...", "chapters": [], "evidence": [], "suggestion": "..." } ] }

If no issues are found, return: { "issues": [] }`;

const CONTINUITY_SETTINGS_PROMPT = `You are a continuity editor. Review these location and setting descriptions tracked across multiple chapters of a novel. Also check for naming inconsistencies (character names, place names, item names that change spelling). Identify any contradictions or errors.

For each issue found, provide:
- category: "setting" or "naming"
- severity: "error" (definite contradiction), "warning" (likely error), or "info" (worth noting)
- description: what the inconsistency is
- chapters: which chapters are involved
- evidence: the conflicting details
- suggestion: how to fix it

Return ONLY valid JSON:
{ "issues": [ { "category": "...", "severity": "...", "description": "...", "chapters": [], "evidence": [], "suggestion": "..." } ] }

If no issues are found, return: { "issues": [] }`;

/**
 * Coerce an entity's `attributes` (from AI JSON) into a flat Record<string,string>.
 * The prompt asks for a flat {name:value} map, but some models emit an array of
 * {key,value} objects (or {name,value}, or single-key {name:value} objects). This
 * folds any of those into the flat map the rest of the engine expects, so an
 * off-shape response degrades one entity's attributes rather than being dropped by
 * a later Object.entries. Non-string values are stringified; unusable input → {}.
 */
export function coerceAttributes(raw: any): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== 'object') return out;
  const put = (k: any, v: any) => {
    if (k == null || v == null || typeof k === 'object') return;
    out[String(k)] = typeof v === 'string' ? v : JSON.stringify(v);
  };
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      if ('key' in item && 'value' in item) put(item.key, item.value);
      else if ('name' in item && 'value' in item) put(item.name, item.value);
      else for (const [k, v] of Object.entries(item)) put(k, v); // single-key {name:value}
    }
  } else {
    for (const [k, v] of Object.entries(raw)) put(k, v);
  }
  return out;
}

// ═══════════════════════════════════════════════════════════
// Context Engine
// ═══════════════════════════════════════════════════════════

export class ContextEngine {
  private workspaceDir: string;
  private contexts: Map<string, ProjectContext> = new Map();
  private reports: Map<string, ContinuityReport> = new Map();
  private pendingWrites: Set<string> = new Set();
  private writeTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  constructor(workspaceDir: string) {
    this.workspaceDir = workspaceDir;
  }

  // ── AI JSON Parsing ──────────────────────────────────────

  /**
   * Index of the '}' that closes the object opened at `start`, matching braces
   * while skipping any that appear inside string literals. Returns -1 if the
   * object never balances (truncated output).
   */
  protected findObjectEnd(s: string, start: number): number {
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < s.length; i++) {
      const c = s[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
      } else if (c === '"') {
        inStr = true;
      } else if (c === '{') {
        depth++;
      } else if (c === '}') {
        depth--;
        if (depth === 0) return i;
      }
    }
    return -1;
  }

  protected parseAIJson(text: string): any {
    // Empty / whitespace-only response — bail with a clear error rather than
    // letting JSON.parse('{}') succeed silently.
    if (!text || !text.trim()) {
      throw new Error('AI returned empty content');
    }

    // Some models wrap output in ```json ... ``` even when the system prompt
    // forbids it, or append commentary after the JSON. Bound the object by the
    // first '{' and its MATCHING '}' (skipping braces inside string values), so
    // neither fence markers (no braces) nor trailing prose containing a stray
    // '}' can extend the candidate past the real object.
    const cleaned = text.trim();

    const start = cleaned.indexOf('{');
    if (start < 0) {
      const preview = text.substring(0, 200).replace(/\s+/g, ' ');
      throw new Error(`No valid JSON object found in AI response. First 200 chars: "${preview}"`);
    }
    // Matching close brace, or lastIndexOf as a fallback when none balances
    // (truncated output — Stage 2 recovery then takes over).
    const matchedEnd = this.findObjectEnd(cleaned, start);
    const end = matchedEnd >= 0 ? matchedEnd : cleaned.lastIndexOf('}');

    // Stage 1: well-formed response — extract substring between first { and last }.
    if (end > start) {
      const candidate = cleaned.substring(start, end + 1);
      const parsed = this.tryParse(candidate);
      if (parsed !== undefined) return parsed;
    }

    // Stage 2: truncated response (no closing brace, or parse failed even with
    // one). Try to RECOVER what we can by trimming back to the last complete
    // entity, then closing the structure.
    //
    // This is critical for entity extraction: when max_tokens cuts off the
    // response mid-entity, we still have N-1 valid entities. Throwing away
    // the whole thing wastes those N-1 entities AND the AI call. Better to
    // accept the partial result.
    const truncated = cleaned.substring(start);
    const recovered = this.recoverTruncatedJson(truncated);
    if (recovered) {
      const parsed = this.tryParse(recovered);
      if (parsed !== undefined) return parsed;
    }

    const preview = cleaned.substring(0, 300).replace(/\s+/g, ' ');
    throw new Error(`Could not parse AI JSON after recovery attempts. Snippet: "${preview}"`);
  }

  /** Try to JSON.parse with a couple of common-fix passes. Returns undefined on failure. */
  private tryParse(candidate: string): any | undefined {
    try { return JSON.parse(candidate); } catch { /* fall through */ }
    try {
      const fixed = candidate
        .replace(/,\s*([}\]])/g, '$1')         // remove trailing commas
        .replace(/(['"])?(\w+)(['"])?\s*:/g, '"$2":') // ensure quoted keys
        .replace(/:\s*'([^']*)'/g, ': "$1"');   // single quotes to double
      return JSON.parse(fixed);
    } catch { return undefined; }
  }

  /**
   * Attempt to close a truncated JSON object/array by:
   *   1. Finding the last complete element (object or value followed by `,`)
   *   2. Counting open braces/brackets vs closed to determine what's missing
   *   3. Backing off to the last comma at depth 1 inside an array, then
   *      closing brackets/braces in reverse order
   *
   * This is a best-effort heuristic — some truncations are unrecoverable,
   * but for entity extraction we frequently get N-1 complete entities and
   * one half-finished one. This salvages the N-1.
   */
  protected recoverTruncatedJson(s: string): string | null {
    if (!s || s[0] !== '{') return null;

    // Walk the string tracking string-literal context, escape sequences, and
    // brace/bracket depth. When we hit the end of input mid-string, back off.
    let inString = false;
    let escape = false;
    const stack: string[] = []; // '{' or '['
    let lastSafeIndex = -1; // last index where we are at depth 1 inside an array, after a comma
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (escape) { escape = false; continue; }
      if (c === '\\') { escape = true; continue; }
      if (c === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (c === '{' || c === '[') stack.push(c);
      else if (c === '}') stack.pop();
      else if (c === ']') stack.pop();
      else if (c === ',' && stack.length === 2 && stack[0] === '{' && stack[1] === '[') {
        // We're inside an array that's directly inside the root object —
        // this is the entity-list shape we care about. Mark this comma as
        // a safe truncation point.
        lastSafeIndex = i;
      }
    }

    // If we ended cleanly (depth 0, not in string), the original parse
    // would have worked. Recovery only helps when stack is non-empty.
    if (stack.length === 0 && !inString) return s;

    // If we ended mid-string OR mid-element, back off to the last safe comma
    // (which is between completed array elements) and close properly.
    let truncated = s;
    if (lastSafeIndex > 0) {
      truncated = s.substring(0, lastSafeIndex);
      // Recompute stack for the trimmed string.
      let depth = 0;
      const newStack: string[] = [];
      let inStr = false;
      let esc = false;
      for (const c of truncated) {
        if (esc) { esc = false; continue; }
        if (c === '\\') { esc = true; continue; }
        if (c === '"') { inStr = !inStr; continue; }
        if (inStr) continue;
        if (c === '{' || c === '[') newStack.push(c);
        else if (c === '}' || c === ']') newStack.pop();
        depth = newStack.length;
      }
      // Close every still-open container in reverse order.
      while (newStack.length > 0) {
        const open = newStack.pop()!;
        truncated += open === '{' ? '}' : ']';
      }
      return truncated;
    }

    // Fallback: just close the open containers in reverse order. Likely to
    // produce malformed JSON if we truncated mid-string, but it's worth
    // one try.
    let recovery = s;
    if (inString) recovery += '"';
    while (stack.length > 0) {
      const open = stack.pop()!;
      recovery += open === '{' ? '}' : ']';
    }
    return recovery;
  }

  // ── Persistence ──────────────────────────────────────────

  private contextDir(): string {
    return join(this.workspaceDir, 'context');
  }

  private contextPath(projectId: string): string {
    return join(this.contextDir(), `${projectId}.json`);
  }

  private reportPath(projectId: string): string {
    return join(this.contextDir(), `${projectId}-report.json`);
  }

  async loadContext(projectId: string): Promise<ProjectContext> {
    // Return cached if available
    const cached = this.contexts.get(projectId);
    if (cached) return cached;

    const filePath = this.contextPath(projectId);
    if (existsSync(filePath)) {
      const raw = await readFile(filePath, 'utf-8');
      const ctx: ProjectContext = JSON.parse(raw);
      this.contexts.set(projectId, ctx);
      return ctx;
    }

    // Create empty context
    const empty: ProjectContext = {
      projectId,
      summaries: [],
      entities: [],
      updatedAt: new Date().toISOString(),
    };
    this.contexts.set(projectId, empty);
    return empty;
  }

  async persistContext(projectId: string): Promise<void> {
    const ctx = this.contexts.get(projectId);
    if (!ctx) return;

    ctx.updatedAt = new Date().toISOString();
    await mkdir(this.contextDir(), { recursive: true });
    await writeFile(this.contextPath(projectId), JSON.stringify(ctx, null, 2));
  }

  async persistReport(projectId: string, report: ContinuityReport): Promise<void> {
    this.reports.set(projectId, report);
    await mkdir(this.contextDir(), { recursive: true });
    await writeFile(this.reportPath(projectId), JSON.stringify(report, null, 2));
  }

  /**
   * Debounced write — coalesces rapid updates into a single disk write.
   */
  private debouncedPersist(projectId: string): void {
    if (this.writeTimers.has(projectId)) {
      clearTimeout(this.writeTimers.get(projectId)!);
    }
    this.pendingWrites.add(projectId);
    const timer = setTimeout(async () => {
      this.writeTimers.delete(projectId);
      this.pendingWrites.delete(projectId);
      await this.persistContext(projectId).catch((err) => {
        console.log(`  ⚠ ContextEngine: failed to persist context for ${projectId}: ${err?.message ?? err}`);
      });
    }, 2000);
    this.writeTimers.set(projectId, timer);
  }

  // ── Core Methods ─────────────────────────────────────────

  /**
   * Generate an AI summary of a chapter and store it in the context.
   */
  async generateSummary(
    projectId: string,
    stepId: string,
    stepLabel: string,
    chapterNumber: number,
    fullText: string,
    aiComplete: AICompleteFn,
    aiSelectProvider: AISelectProviderFn,
  ): Promise<ChapterSummary> {
    const ctx = await this.loadContext(projectId);
    const provider = aiSelectProvider('general');

    const response = await aiComplete({
      provider: provider.id,
      system: SUMMARY_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Chapter ${chapterNumber}: "${stepLabel}"\n\n${fullText}`,
        },
      ],
      // Bumped from 2000 → 4096 because long chapters with rich plot threads
      // were getting truncated mid-summary, leaving ContextEngine with
      // unparseable JSON.
      maxTokens: 4096,
      temperature: 0.3,
    });

    const parsed = this.parseAIJson(response.text);

    const wordCount = fullText.split(/\s+/).filter(Boolean).length;

    const summary: ChapterSummary = {
      chapterId: stepId,
      chapterNumber,
      title: stepLabel,
      summary: parsed.summary ?? '',
      wordCount,
      characters: parsed.characters ?? [],
      locations: parsed.locations ?? [],
      timelineMarker: parsed.timelineMarker ?? '',
      plotThreads: parsed.plotThreads ?? [],
      endingState: parsed.endingState ?? '',
    };

    // Replace or append
    const existingIdx = ctx.summaries.findIndex(s => s.chapterId === stepId);
    if (existingIdx >= 0) {
      ctx.summaries[existingIdx] = summary;
    } else {
      ctx.summaries.push(summary);
    }

    // Keep sorted by chapter number
    ctx.summaries.sort((a, b) => a.chapterNumber - b.chapterNumber);

    this.debouncedPersist(projectId);
    return summary;
  }

  /**
   * Extract entities from a chapter and merge with existing entity index.
   */
  async extractEntities(
    projectId: string,
    stepId: string,
    fullText: string,
    aiComplete: AICompleteFn,
    aiSelectProvider: AISelectProviderFn,
  ): Promise<EntityEntry[]> {
    const ctx = await this.loadContext(projectId);
    const provider = aiSelectProvider('general');

    const response = await aiComplete({
      provider: provider.id,
      system: ENTITY_PROMPT,
      messages: [
        {
          role: 'user',
          content: fullText,
        },
      ],
      // Bumped from 3000 → 8192 to accommodate chapters with many characters
      // + locations + items. Combined with the tightened prompt (one-sentence
      // descriptions, max 3 attributes, max 12 entities) this gives plenty
      // of headroom without bloating cost.
      maxTokens: 8192,
      temperature: 0.2,
    });

    const parsed = this.parseAIJson(response.text);
    const newEntities: Array<{
      name: string;
      type: string;
      aliases: string[];
      description: string;
      attributes: Record<string, string>;
    }> = parsed.entities ?? [];

    // Merge with existing entities
    for (const ne of newEntities) {
      // Guard against malformed-but-parseable AI output that omits `name`
      // (or returns name:null) — dereferencing it would throw and discard the
      // entire batch.
      if (!ne?.name || typeof ne.name !== 'string') continue;
      // Run-review B3: some models (deepseek-v4-pro) return `attributes` as an
      // array of {key,value} objects instead of the flat map the prompt asks for
      // (the unbracketed form is a hard parse error caught upstream; the bracketed
      // array parses but breaks Object.entries). Coerce any accepted shape to a
      // flat Record<string,string> so entity/attribute tracking stays intact.
      ne.attributes = coerceAttributes(ne.attributes);
      const normalizedName = ne.name.toLowerCase().trim();
      const existing = ctx.entities.find(
        e =>
          e.name.toLowerCase().trim() === normalizedName ||
          e.aliases.some(a => a.toLowerCase().trim() === normalizedName),
      );

      if (existing) {
        // Update lastSeen
        existing.lastSeen = stepId;

        // Merge aliases
        for (const alias of ne.aliases ?? []) {
          if (!existing.aliases.some(a => a.toLowerCase() === alias.toLowerCase())) {
            existing.aliases.push(alias);
          }
        }

        // Detect attribute changes
        for (const [key, value] of Object.entries(ne.attributes ?? {})) {
          const oldValue = existing.attributes[key];
          if (oldValue && oldValue !== value) {
            existing.changes.push({
              chapterId: stepId,
              description: `${key} changed from "${oldValue}" to "${value}"`,
            });
          }
          existing.attributes[key] = value;
        }

        // Update description if the new one is longer / more detailed
        if (ne.description && ne.description.length > existing.description.length) {
          existing.description = ne.description;
        }
      } else {
        // New entity
        const validTypes = ['character', 'location', 'item', 'event', 'rule'] as const;
        const entityType = validTypes.includes(ne.type as any)
          ? (ne.type as EntityEntry['type'])
          : 'item';

        ctx.entities.push({
          name: ne.name,
          type: entityType,
          aliases: ne.aliases ?? [],
          description: ne.description ?? '',
          firstAppearance: stepId,
          lastSeen: stepId,
          attributes: ne.attributes ?? {},
          changes: [],
        });
      }
    }

    this.debouncedPersist(projectId);
    return ctx.entities;
  }

  /**
   * Build relevant context string for a writing step.
   * Synchronous — works entirely from in-memory data.
   */
  getRelevantContext(
    projectId: string,
    currentStepId: string,
    prompt: string,
    maxChars: number,
  ): string {
    const ctx = this.contexts.get(projectId);
    if (!ctx || (ctx.summaries.length === 0 && ctx.entities.length === 0)) {
      return '';
    }

    const parts: string[] = [];
    let charBudget = maxChars;

    const addPart = (text: string): boolean => {
      if (text.length > charBudget) return false;
      parts.push(text);
      charBudget -= text.length;
      return true;
    };

    // Like addPart, but truncates to the remaining budget rather than dropping
    // the whole block — used for priority-1 context that must not be silently
    // omitted just because it overflows maxChars.
    const addPartTruncated = (text: string): void => {
      if (charBudget <= 0) return;
      const slice = text.length > charBudget ? text.substring(0, charBudget) : text;
      parts.push(slice);
      charBudget -= slice.length;
    };

    // Find current chapter index
    const currentIdx = ctx.summaries.findIndex(s => s.chapterId === currentStepId);

    // ── Priority 1: Previous chapter summary ──
    const prevChapter =
      currentIdx > 0
        ? ctx.summaries[currentIdx - 1]
        : ctx.summaries.length > 0
          ? ctx.summaries[ctx.summaries.length - 1]
          : null;

    if (prevChapter) {
      addPartTruncated(
        `## Story Context\n\n### Previous Chapter: ${prevChapter.title}\n${prevChapter.summary}\n\n**Where things stand:** ${prevChapter.endingState}`,
      );
    } else {
      addPart('## Story Context');
    }

    // ── Priority 2: Entities mentioned in the prompt ──
    const promptLower = prompt.toLowerCase();
    const mentionedCharacters = ctx.entities.filter(
      e =>
        e.type === 'character' &&
        (promptLower.includes(e.name.toLowerCase()) ||
          e.aliases.some(a => promptLower.includes(a.toLowerCase()))),
    );
    const mentionedLocations = ctx.entities.filter(
      e =>
        e.type === 'location' &&
        (promptLower.includes(e.name.toLowerCase()) ||
          e.aliases.some(a => promptLower.includes(a.toLowerCase()))),
    );

    if (mentionedCharacters.length > 0) {
      const charBlock = mentionedCharacters
        .map(c => {
          const attrs = Object.entries(c.attributes)
            .map(([k, v]) => `${k}: ${v}`)
            .join(', ');
          return `- **${c.name}**: ${c.description}${attrs ? ` (${attrs})` : ''}`;
        })
        .join('\n');
      addPart(`\n\n### Key Characters in Scene\n${charBlock}`);
    }

    if (mentionedLocations.length > 0) {
      const locBlock = mentionedLocations
        .map(l => {
          const attrs = Object.entries(l.attributes)
            .map(([k, v]) => `${k}: ${v}`)
            .join(', ');
          return `- **${l.name}**: ${l.description}${attrs ? ` (${attrs})` : ''}`;
        })
        .join('\n');
      addPart(`\n\n### Key Locations\n${locBlock}`);
    }

    // ── Priority 3: Timeline position ──
    if (prevChapter?.timelineMarker) {
      addPart(`\n\n### Timeline Position\n${prevChapter.timelineMarker}`);
    }

    // ── Priority 4: Chapters sharing characters/locations ──
    if (charBudget > 500) {
      const currentCharacters = new Set(
        mentionedCharacters.map(c => c.name.toLowerCase()),
      );
      const currentLocations = new Set(
        mentionedLocations.map(l => l.name.toLowerCase()),
      );

      if (currentCharacters.size > 0 || currentLocations.size > 0) {
        const relatedSummaries = ctx.summaries.filter(s => {
          if (s.chapterId === currentStepId) return false;
          if (prevChapter && s.chapterId === prevChapter.chapterId) return false;
          const hasCharOverlap = s.characters.some(c =>
            currentCharacters.has(c.toLowerCase()),
          );
          const hasLocOverlap = s.locations.some(l =>
            currentLocations.has(l.toLowerCase()),
          );
          return hasCharOverlap || hasLocOverlap;
        });

        if (relatedSummaries.length > 0) {
          const block = relatedSummaries
            .slice(0, 3)
            .map(
              s =>
                `- **Ch ${s.chapterNumber} — ${s.title}**: ${s.endingState}`,
            )
            .join('\n');
          addPart(`\n\n### Relevant Earlier Events\n${block}`);
        }
      }
    }

    // ── Priority 5: Oldest summaries for overall grounding ──
    if (charBudget > 300 && ctx.summaries.length > 2) {
      const earliest = ctx.summaries
        .filter(
          s =>
            s.chapterId !== currentStepId &&
            (!prevChapter || s.chapterId !== prevChapter.chapterId),
        )
        .slice(0, 2);

      if (earliest.length > 0) {
        const block = earliest
          .map(
            s =>
              `- **Ch ${s.chapterNumber} — ${s.title}**: ${s.endingState}`,
          )
          .join('\n');
        addPart(`\n\n### Story Foundation\n${block}`);
      }
    }

    return parts.join('');
  }

  /**
   * Run a multi-phase continuity check across the entire project.
   */
  async runContinuityCheck(
    projectId: string,
    aiComplete: AICompleteFn,
    aiSelectProvider: AISelectProviderFn,
    onProgress?: (msg: string) => void,
  ): Promise<ContinuityReport> {
    const ctx = await this.loadContext(projectId);
    const provider = aiSelectProvider('consistency');
    const allIssues: ContinuityIssue[] = [];

    // ── Phase 1: Ensure entity index is populated ──
    onProgress?.('Phase 1/4: Verifying entity index...');
    if (ctx.entities.length === 0) {
      onProgress?.('Entity index empty — skipping detailed checks. Run entity extraction on chapters first.');
    }

    // ── Phase 2: Character consistency ──
    onProgress?.('Phase 2/4: Checking character consistency...');
    const characterEntities = ctx.entities.filter(e => e.type === 'character');
    if (characterEntities.length > 0) {
      const characterData = characterEntities.map(c => ({
        name: c.name,
        aliases: c.aliases,
        attributes: c.attributes,
        firstAppearance: c.firstAppearance,
        lastSeen: c.lastSeen,
        changes: c.changes,
        description: c.description,
      }));

      try {
        const response = await aiComplete({
          provider: provider.id,
          system: CONTINUITY_CHARACTER_PROMPT,
          messages: [
            {
              role: 'user',
              content: `Character profiles:\n\n${JSON.stringify(characterData, null, 2)}`,
            },
          ],
          maxTokens: 3000,
          temperature: 0.2,
        });
        const parsed = this.parseAIJson(response.text);
        for (const issue of parsed.issues ?? []) {
          allIssues.push({
            category: 'character',
            severity: issue.severity ?? 'warning',
            description: issue.description ?? '',
            chapters: issue.chapters ?? [],
            evidence: issue.evidence ?? [],
            suggestion: issue.suggestion ?? '',
          });
        }
      } catch {
        // AI parse failure — skip this phase
      }
    }

    // ── Phase 3: Timeline verification ──
    onProgress?.('Phase 3/4: Verifying timeline consistency...');
    const timelineData = ctx.summaries.map(s => ({
      chapterId: s.chapterId,
      chapterNumber: s.chapterNumber,
      title: s.title,
      timelineMarker: s.timelineMarker,
      endingState: s.endingState,
    }));

    if (timelineData.length >= 2) {
      try {
        const response = await aiComplete({
          provider: provider.id,
          system: CONTINUITY_TIMELINE_PROMPT,
          messages: [
            {
              role: 'user',
              content: `Timeline markers (in chapter order):\n\n${JSON.stringify(timelineData, null, 2)}`,
            },
          ],
          maxTokens: 3000,
          temperature: 0.2,
        });
        const parsed = this.parseAIJson(response.text);
        for (const issue of parsed.issues ?? []) {
          allIssues.push({
            category: 'timeline',
            severity: issue.severity ?? 'warning',
            description: issue.description ?? '',
            chapters: issue.chapters ?? [],
            evidence: issue.evidence ?? [],
            suggestion: issue.suggestion ?? '',
          });
        }
      } catch {
        // AI parse failure — skip
      }
    }

    // ── Phase 4: Cross-reference (settings, naming) ──
    onProgress?.('Phase 4/4: Cross-referencing locations and naming...');
    const locationEntities = ctx.entities.filter(
      e => e.type === 'location' || e.type === 'item',
    );
    const allNamedEntities = ctx.entities.map(e => ({
      name: e.name,
      type: e.type,
      aliases: e.aliases,
      attributes: e.attributes,
      firstAppearance: e.firstAppearance,
      lastSeen: e.lastSeen,
      changes: e.changes,
    }));

    if (allNamedEntities.length > 0) {
      try {
        const settingsData =
          locationEntities.length > 0 ? locationEntities : allNamedEntities;
        const response = await aiComplete({
          provider: provider.id,
          system: CONTINUITY_SETTINGS_PROMPT,
          messages: [
            {
              role: 'user',
              content: `Entity data for cross-reference:\n\n${JSON.stringify(settingsData, null, 2)}`,
            },
          ],
          maxTokens: 3000,
          temperature: 0.2,
        });
        const parsed = this.parseAIJson(response.text);
        for (const issue of parsed.issues ?? []) {
          const cat = issue.category === 'naming' ? 'naming' : 'setting';
          allIssues.push({
            category: cat as ContinuityIssue['category'],
            severity: issue.severity ?? 'warning',
            description: issue.description ?? '',
            chapters: issue.chapters ?? [],
            evidence: issue.evidence ?? [],
            suggestion: issue.suggestion ?? '',
          });
        }
      } catch {
        // AI parse failure — skip
      }
    }

    // ── Build report ──
    const issuesByCategory: Record<string, number> = {};
    for (const issue of allIssues) {
      issuesByCategory[issue.category] = (issuesByCategory[issue.category] ?? 0) + 1;
    }

    const report: ContinuityReport = {
      projectId,
      generatedAt: new Date().toISOString(),
      totalIssues: allIssues.length,
      issuesByCategory,
      issues: allIssues,
    };

    await this.persistReport(projectId, report);
    onProgress?.(`Continuity check complete: ${allIssues.length} issue(s) found.`);
    return report;
  }

  /**
   * Returns a brief (max 200 char) "where the story stands" summary from the last chapter.
   */
  getBriefSummary(projectId: string): string {
    const ctx = this.contexts.get(projectId);
    if (!ctx || ctx.summaries.length === 0) return '';

    const last = ctx.summaries[ctx.summaries.length - 1];
    const text = last.endingState || last.summary;
    return text.length > 200 ? text.substring(0, 197) + '...' : text;
  }

  /**
   * Returns the full entity list for a project.
   */
  getEntities(projectId: string): EntityEntry[] {
    const ctx = this.contexts.get(projectId);
    return ctx?.entities ?? [];
  }

  /**
   * Returns the stored continuity report, if any.
   */
  getReport(projectId: string): ContinuityReport | null {
    return this.reports.get(projectId) ?? null;
  }
}
