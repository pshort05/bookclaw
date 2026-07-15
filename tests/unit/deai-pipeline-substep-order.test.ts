/**
 * Composition guard for the chunked two-pass de-AI sweep (F2, scrutiny #1).
 *
 * The per-chapter edit composition is only correct because of the substep ORDER
 * inside the `expand:'chapters'` group of the deterministic romance pipelines:
 *
 *   Scene Brief -> First Draft -> Consistency Audit -> Consistency Apply
 *   (skill `deterministic-apply`) -> De-AI Sweep (skill `romance-deai-audit`).
 *
 * runDeaiSweepStep.resolveSweepBaseDraft prefers the completed `deterministic-apply`
 * output as its base, so the consistency edits are preserved and the sweep builds
 * on them. If the sweep were ever ordered BEFORE the consistency-apply, that base
 * would not exist yet and the sweep would silently fall back to the raw draft,
 * dropping the consistency corrections. This test locks the order so that
 * regression is caught at the data layer.
 *
 * It also pins two F2 invariants the design calls out:
 *   - the De-AI Sweep step carries NO `modelOverride` (per-pass models resolve from
 *     the book's deai_pass1/deai_pass2 stage slots, not a step pin);
 *   - the consistency-apply step is the drift-proof `deterministic-apply`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PIPELINES = ['romance-sweet-deterministic.json', 'romance-spicy-deterministic.json'];

function chapterSubsteps(pipelineFile: string): any[] {
  const pipeline = JSON.parse(readFileSync(join(REPO_ROOT, 'library', 'pipelines', pipelineFile), 'utf8'));
  const group = (pipeline.steps ?? []).find((s: any) => s?.expand === 'chapters' && Array.isArray(s.steps));
  assert.ok(group, `${pipelineFile}: has an expand:'chapters' group`);
  return group.steps;
}

for (const file of PIPELINES) {
  test(`${file}: consistency-apply precedes the de-AI sweep (composition base is preserved)`, () => {
    const subs = chapterSubsteps(file);
    const applyIdx = subs.findIndex((s) => s.skill === 'deterministic-apply');
    const sweepIdx = subs.findIndex((s) => s.skill === 'romance-deai-audit');
    assert.ok(applyIdx >= 0, `${file}: has a deterministic-apply (Consistency Apply) substep`);
    assert.ok(sweepIdx >= 0, `${file}: has a romance-deai-audit (De-AI Sweep) substep`);
    assert.ok(
      applyIdx < sweepIdx,
      `${file}: Consistency Apply (deterministic-apply, idx ${applyIdx}) MUST precede the ` +
      `De-AI Sweep (romance-deai-audit, idx ${sweepIdx}) so the sweep's base is the ` +
      `consistency-corrected chapter, not the raw draft.`,
    );
    // The sweep is the LAST per-chapter substep — its output is the final chapter.
    assert.equal(sweepIdx, subs.length - 1, `${file}: the De-AI Sweep is the final per-chapter substep`);
  });

  test(`${file}: the De-AI Sweep step drops its modelOverride (per-pass stage slots own the models)`, () => {
    const subs = chapterSubsteps(file);
    const sweep = subs.find((s) => s.skill === 'romance-deai-audit');
    assert.ok(sweep, `${file}: has a romance-deai-audit substep`);
    assert.equal(
      sweep.modelOverride,
      undefined,
      `${file}: the sweep step must NOT pin a modelOverride — resolveDeaiPassModel reads ` +
      `deai_pass1/deai_pass2 stage slots (defaults Gemini then Haiku).`,
    );
  });

  test(`${file}: the full per-chapter draft->audit->apply->sweep spine is present and ordered`, () => {
    const subs = chapterSubsteps(file);
    const draftIdx = subs.findIndex((s) => s.role === 'draft');
    const consAuditIdx = subs.findIndex((s) => s.skill === 'romance-consistency-audit');
    const applyIdx = subs.findIndex((s) => s.skill === 'deterministic-apply');
    const sweepIdx = subs.findIndex((s) => s.skill === 'romance-deai-audit');
    assert.ok(
      draftIdx >= 0 && consAuditIdx > draftIdx && applyIdx > consAuditIdx && sweepIdx > applyIdx,
      `${file}: expected First Draft(${draftIdx}) < Consistency Audit(${consAuditIdx}) < ` +
      `Consistency Apply(${applyIdx}) < De-AI Sweep(${sweepIdx}).`,
    );
  });
}
