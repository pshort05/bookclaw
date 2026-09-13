/**
 * Consistency-feedback checks, run against a MODULE BASE passed as argv[2].
 *
 *   local  : npx tsx tests/harness/consistency-feedback-check.mjs gateway/src
 *   deployed: docker exec <c> node /app/tests/harness/... /app/dist/gateway/src
 *
 * The point of the base-dir indirection is that the SAME assertions run against
 * the source tree and against the built artifact inside a deployed container —
 * so a deploy smoke proves the shipped code has the fix, not just the repo.
 *
 * Zero AI, zero network, zero writes. Prints one `PASS <name>` / `FAIL <name>`
 * line per check and exits non-zero if any failed.
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const arg = process.argv[2];
if (!arg) { console.error('usage: consistency-feedback-check.mjs <module-base-dir>'); process.exit(2); }
// A bare path would be read as a package specifier — resolve to a file URL so
// the same argument works for a relative source dir and an absolute /app/dist.
const base = pathToFileURL(resolve(arg)).href;

const { resolveAnalyzeApplyBlock } = await import(`${base}/api/routes/_shared.js`);
const { maybeOpenCadenceGate } = await import(`${base}/services/human-review.js`);
const { countContradictions, resolveThreshold, CONTRADICTION_GATE_DEFAULT } =
  await import(`${base}/services/consistency/continuity-gate.js`);

let failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) console.log(`  PASS ${name}`);
  else { console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); failed++; }
};

// ── fixtures: the REAL deterministic-romance step shapes ──────────────────
const FLAG = { kind: 'contradiction', detail: "Gia's occupation is \"owns the bakery\" but was \"one pair of hands\" in chapter-1.", span: 'own something' };
const chapterSteps = (n, contradictions = 1) => [
  { id: `s${n}1`, label: `Scene Brief — Chapter ${n}`, role: 'scene_brief', skill: 'romance-sweet-scene-brief', taskType: 'outline', chapterNumber: n, status: 'completed', result: 'brief' },
  { id: `s${n}2`, label: `First Draft — Chapter ${n}`, role: 'draft', skill: 'romance-sweet-first-draft', taskType: 'creative_writing', chapterNumber: n, status: 'completed', result: 'The postcard went up first. '.repeat(40),
    continuityFlags: Array.from({ length: contradictions }, (_, i) => ({ ...FLAG, detail: `${FLAG.detail} [${i}]` })) },
  { id: `s${n}3`, label: `Improvement Plan — Chapter ${n}`, role: 'improve', skill: 'romance-sweet-improvement-plan', taskType: 'revision', chapterNumber: n, status: 'completed', result: 'plan' },
  { id: `s${n}4`, label: `Rewrite — Chapter ${n}`, role: 'rewrite', skill: 'romance-sweet-rewrite', taskType: 'creative_writing', chapterNumber: n, status: 'active' },
  { id: `s${n}5`, label: `Consistency Audit — Chapter ${n}`, skill: 'romance-consistency-audit', taskType: 'revision', chapterNumber: n, status: 'pending' },
  { id: `s${n}6`, label: `Consistency Apply — Chapter ${n}`, skill: 'deterministic-apply', taskType: 'general', chapterNumber: n, status: 'pending' },
  { id: `s${n}7`, label: `Humanize — De-AI Sweep — Chapter ${n}`, role: 'humanize', skill: 'romance-deai-audit', taskType: 'general', chapterNumber: n, status: 'pending' },
];

const stubCritics = {
  craftCritic: { analyze: () => ({ flags: [] }) },
  dialogueAuditor: { audit: () => ({ flags: [] }) },
};

// ══ Feature 1 — findings reach the Rewrite prompt ═════════════════════════
console.log('Feature 1: continuity flags reach the rewrite prompt');
{
  const project = { steps: chapterSteps(2) };
  const rewrite = project.steps.find((s) => s.role === 'rewrite');
  const block = resolveAnalyzeApplyBlock({ services: stubCritics, project, step: rewrite });
  check('romance Rewrite step receives the findings block', typeof block === 'string' && block.includes('Analysis Findings'), `got: ${JSON.stringify(String(block).slice(0, 60))}`);
  check('the block names the continuity contradiction', String(block).includes("Gia's occupation"), 'flag detail missing from the block');
}
{
  const project = { steps: chapterSteps(2) };
  const brief = project.steps.find((s) => s.role === 'scene_brief');
  const block = resolveAnalyzeApplyBlock({ services: stubCritics, project, step: brief });
  check('a non-rewrite step receives nothing', block === '', `got: ${JSON.stringify(String(block).slice(0, 40))}`);
}
{
  // the legacy code-generated pipelines must not regress
  const project = { steps: [
    { id: 'w1', label: 'Write Chapter 3', skill: 'write', chapterNumber: 3, status: 'completed', result: 'legacy prose '.repeat(40), continuityFlags: [FLAG] },
    { id: 'r1', label: 'Polish Chapter 3', skill: 'revise', role: 'rewrite', chapterNumber: 3, status: 'active' },
  ] };
  const block = resolveAnalyzeApplyBlock({ services: stubCritics, project, step: project.steps[1] });
  check('legacy write/revise pipeline still gets its block', String(block).includes('Analysis Findings'), 'legacy shape regressed');
}

// ══ Feature 2 — contradictions force a gate ═══════════════════════════════
console.log('Feature 2: a pile of contradictions stops the run');
check('threshold default is 6', CONTRADICTION_GATE_DEFAULT === 6, `got ${CONTRADICTION_GATE_DEFAULT}`);
check('countContradictions ignores other kinds',
  countContradictions([{ kind: 'contradiction' }, { kind: 'knowledge' }, { kind: 'timeline' }]) === 1);
check('env override is honoured', resolveThreshold('3') === 3);
check('env "0" disables the gate', resolveThreshold('0') === 0);
check('garbage env falls back to the default', resolveThreshold('not-a-number') === CONTRADICTION_GATE_DEFAULT);

const mkDeps = () => {
  const created = [];
  return {
    created,
    // Mirrors the real GateLike / EngineLike surfaces, so the gate goes through
    // its normal path rather than its fail-soft catch (which also reports
    // gated:true and would make this check pass for the wrong reason).
    deps: {
      gate: {
        createRequest: async (r) => { created.push(r); return { id: `conf-${created.length}` }; },
        checkDecision: () => ({ status: 'pending', request: null }),
        recordOutcome: async () => ({}),
      },
      engine: {
        listProjects: () => [],
        getProject: () => null,
        parkForReview: () => {},
        applyReviewResume: () => {},
        clearReview: () => {},
      },
    },
  };
};

// the gate fires at the SWEEP step, while the flags live on the DRAFT step
async function gateFor(contradictions, extra = {}) {
  const project = { id: 'p1', type: 'romance', steps: chapterSteps(2, contradictions) };
  const sweep = project.steps.find((s) => s.role === 'humanize');
  const { deps } = mkDeps();
  return maybeOpenCadenceGate(deps, project, sweep, 'chapter prose '.repeat(50), { ...stubCritics, ...extra });
}

{
  const r = await gateFor(9);
  check('9 contradictions force a gate at a non-boundary chapter', r.gated === true, `gated=${r.gated}`);
}
{
  const r = await gateFor(3);
  check('3 contradictions do NOT force a gate', r.gated === false, `gated=${r.gated}`);
}
{
  const r = await gateFor(9, { headless: true });
  check('headless runs are never stopped by it', r.gated === false, `gated=${r.gated}`);
}
{
  // The gate must fire ONCE per chapter, at the last prose step — not at every
  // prose step. Firing at the draft would also pre-empt the rewrite, which is
  // the pass Feature 1 exists to feed.
  const project = { id: 'p1', type: 'romance', steps: chapterSteps(2, 9) };
  const draft = project.steps.find((s) => s.role === 'draft');
  const { deps } = mkDeps();
  const r = await maybeOpenCadenceGate(deps, project, draft, 'chapter prose '.repeat(50), stubCritics);
  check('the DRAFT step does not gate (once per chapter, after the rewrite)', r.gated === false, `gated=${r.gated}`);
}
{
  const project = { id: 'p1', type: 'romance', steps: chapterSteps(2, 9) };
  const sweep = project.steps.find((s) => s.role === 'humanize');
  const { deps, created } = mkDeps();
  await maybeOpenCadenceGate(deps, project, sweep, 'chapter prose '.repeat(50), stubCritics);
  const payload = created[0]?.payload?.findings?.contradictions;
  check('the gate payload is human-readable text, not a JSON blob',
    typeof payload === 'string' && payload.includes('contradictions in chapter 2'),
    `got ${typeof payload}: ${JSON.stringify(String(payload).slice(0, 60))}`);
}

console.log(failed === 0 ? '\nALL CHECKS PASSED' : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
