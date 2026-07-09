/**
 * Output-hygiene guard (2026-07-08): every narrative/canon pipeline step must
 * declare an explicit output contract so chat framing (preambles, "Next Steps:"
 * epilogues, "would you like…" solicitations) can't leak into the saved
 * chapter/canon file. Deliverable steps — completion reports (`general`),
 * marketing copy (`marketing`), research briefs (`research`), style analysis
 * (`style_analysis`) — are exempt: commentary there IS the deliverable.
 *
 * This makes the invariant self-enforcing for SHIPPED library pipelines: a new
 * or edited pipeline JSON step fails the build if it omits an output contract.
 * Scope note: this guard inspects `library/pipelines/*.json` only. It does NOT
 * cover runtime-only prompts — an AI-planned dynamic project or a single-step
 * custom project (whose prompt is the raw user description) — for those, the
 * save-time `stripMetaCommentary` pass is the backstop, not this guard.
 *
 * Run: node --import tsx --test tests/unit/pipeline-output-contract.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const NARRATIVE = new Set(['creative_writing', 'final_edit', 'book_bible', 'outline', 'consistency', 'revision']);
// Any one of these phrases counts as an explicit output contract. Broad on
// purpose: it must recognize the varied phrasings the already-protected
// pipelines use ("output … only", "do not add … commentary", "contain only the
// report", "… artifact only") so the guard flags ONLY genuinely-unprotected
// steps, never steps that already declare a contract in different words.
const CONTRACT = /(no\b[^.\n]{0,40}\b(commentary|preamble|meta-?commentary|changelog|changes? log|author'?s notes?|explanations?|questions|word count)\b|output\b[^.\n]{0,40}\bonly\b|contain only|respond only|only with the|artifact only|only the (outline|dossier|report|document|critique|analysis|profiles?|audit)|output exactly one|no text before or after|only valid json|do not\b[^.\n]{0,40}\b(commentary|preamble|changelog|changes? log|recap|rewrite)|prose only)/i;

interface Step { label?: string; taskType?: string; promptTemplate?: string; steps?: Step[]; }

function walk(steps: Step[] | undefined, file: string, out: string[]): void {
  for (const step of steps ?? []) {
    if (Array.isArray(step.steps)) walk(step.steps, file, out);
    if (typeof step.promptTemplate !== 'string') continue;
    if (!step.taskType || !NARRATIVE.has(step.taskType)) continue;
    if (!CONTRACT.test(step.promptTemplate)) out.push(`${file}: "${step.label}" (${step.taskType})`);
  }
}

test('every narrative/canon pipeline step declares an output contract', () => {
  const dir = join(REPO_ROOT, 'library', 'pipelines');
  const missing: string[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    const pipeline = JSON.parse(readFileSync(join(dir, f), 'utf8')) as { steps?: Step[] };
    walk(pipeline.steps, f, missing);
  }
  assert.deepEqual(missing, [], `steps missing an output contract:\n${missing.join('\n')}`);
});
