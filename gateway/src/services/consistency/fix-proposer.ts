/**
 * Builds the temperature-0 prompt that asks the model to propose surgical prose
 * edits for selected consistency findings, and leniently parses the response.
 * The model proposes ONLY — application is the deterministic string replace in
 * fix-apply.ts. No file access, no writes here.
 */
import { jsonrepair } from 'jsonrepair';
import type { ConsistencyFinding } from './types.js';

/** A parsed model proposal — ProposedEdit minus the `anchored` flag (set later). */
export interface FixProposal {
  findingId: string;
  canonicalValue: string;
  targetChapter: string;
  oldPhrase: string;
  newPhrase: string;
  note: string;
}

const SYSTEM = `You are a meticulous literary continuity editor. You propose SURGICAL prose edits that reconcile specific consistency findings, and you return STRICT JSON only — no prose, no markdown, no explanation.

You are given a single chapter's prose and a list of findings detected in it. For each finding you can fix, return one edit object. The edit must be a minimal find/replace anchored to the chapter's actual words.

Rules:
- "oldPhrase" MUST be an EXACT, VERBATIM substring of the provided chapter prose — copy the characters exactly (same words, punctuation, capitalization, spacing). Do not paraphrase, normalize, or quote a phrase that is not present verbatim.
- Keep "oldPhrase" as SHORT as possible while still being UNIQUE in the chapter (a phrase that appears only once). If the conflicting detail appears in several places, return one edit per place, each with a distinct unique oldPhrase.
- "newPhrase" is the corrected text that should replace oldPhrase. Change only what the finding requires; leave the surrounding wording intact.
- For a "canon-divergence" finding, ALWAYS edit the prose to MATCH the canonical/bible value (the bible is the source of truth). For other findings, edit the prose toward the canonical/consistent value implied by the finding.
- If you cannot find an exact verbatim substring to anchor a finding, OMIT that finding from the output rather than inventing one.
- Return a JSON ARRAY of edit objects. Return [] if you can fix nothing.

Each edit object has exactly:
{
  "findingId": string,        // the id of the finding this edit resolves
  "canonicalValue": string,   // the value the prose should express after the edit
  "targetChapter": string,    // the chapter label being edited
  "oldPhrase": string,        // EXACT verbatim substring of the chapter to replace
  "newPhrase": string,        // replacement text
  "note": string              // one short sentence explaining the fix
}`;

function refDesc(ref: ConsistencyFinding['a'] | ConsistencyFinding['b']): string {
  if ('chapter' in ref) return `${ref.chapter} (quote: "${ref.quote}")`;
  return `canon source ${ref.canonSource} (quote: "${ref.quote}")`;
}

export function buildFixPrompt(
  chapterText: string,
  findings: ConsistencyFinding[],
): { system: string; user: string } {
  const lines = findings.map((f) => {
    const id = f.id ?? '';
    return [
      `- findingId: ${id}`,
      `  category: ${f.category}`,
      `  entity: ${f.entity}`,
      `  attribute: ${f.attribute}`,
      `  here: ${refDesc(f.a)}`,
      `  conflicts with: ${refDesc(f.b)}`,
      `  explanation: ${f.explanation}`,
      `  suggestedFix: ${f.suggestedFix}`,
    ].join('\n');
  });

  const user = `Findings to fix in this chapter:\n\n${lines.join('\n\n')}\n\n---\n\nChapter prose:\n\n${chapterText}`;
  return { system: SYSTEM, user };
}

/** Coerce one parsed object into a FixProposal, or null if it lacks the required fields. */
function coerce(raw: unknown): FixProposal | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const findingId = typeof o.findingId === 'string' ? o.findingId : '';
  const oldPhrase = typeof o.oldPhrase === 'string' ? o.oldPhrase : '';
  const newPhrase = typeof o.newPhrase === 'string' ? o.newPhrase : '';
  if (findingId === '' || oldPhrase === '' || newPhrase === '') return null;
  return {
    findingId,
    canonicalValue: typeof o.canonicalValue === 'string' ? o.canonicalValue : '',
    targetChapter: typeof o.targetChapter === 'string' ? o.targetChapter : '',
    oldPhrase,
    newPhrase,
    note: typeof o.note === 'string' ? o.note : '',
  };
}

/**
 * Lenient parse of the proposer's response. Strips code fences, slices the
 * outermost array/object when wrapped in prose, falls back to jsonrepair, coerces
 * each entry and drops malformed ones (missing findingId/oldPhrase/newPhrase).
 * NEVER throws — an unrecoverable response yields [].
 */
export function parseFixProposals(raw: string): FixProposal[] {
  if (typeof raw !== 'string') return [];
  const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  if (!stripped) return [];

  // Prefer the outermost array; fall back to the outermost object. Slicing lets
  // us recover JSON embedded in prose ("Here are the edits: [...]").
  const start = stripped.indexOf('[');
  const end = stripped.lastIndexOf(']');
  const objStart = stripped.indexOf('{');
  const objEnd = stripped.lastIndexOf('}');

  const candidates: string[] = [];
  if (start !== -1 && end > start) candidates.push(stripped.slice(start, end + 1));
  if (objStart !== -1 && objEnd > objStart) candidates.push(stripped.slice(objStart, objEnd + 1));
  candidates.push(stripped);

  for (const candidate of candidates) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      try {
        parsed = JSON.parse(jsonrepair(candidate));
      } catch {
        continue;
      }
    }
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    const out = arr.map(coerce).filter((e): e is FixProposal => e !== null);
    if (out.length > 0) return out;
    // A valid-but-empty array is a legitimate "nothing to fix" — return it.
    if (Array.isArray(parsed)) return [];
  }
  return [];
}
