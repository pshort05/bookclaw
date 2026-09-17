/**
 * Firefly-sweep checks, run against a MODULE BASE passed as argv[2].
 *
 *   local  : npx tsx tests/harness/firefly-sweep-check.mjs gateway/src
 *   deployed: docker exec <c> node /app/tests/harness/... /app/dist/gateway/src
 *
 * Covers the three changes from the 2026-09-14 Firefly Pond review sweep:
 *   1. the canon gate's Accept/Reject records a decision that is read back
 *   2. unverifiable (0 candidates) vs drifted (>1 candidates)
 *   3. "apply to every <role>" — a book role pin that beats a template pin
 *
 * The invariant guarding 1 against 2 is the load-bearing one: accepting a
 * place must change NOTHING except that the phrase stops being reported.
 *
 * Zero AI, zero network. Writes only under os.tmpdir(). Prints one
 * `PASS <name>` / `FAIL <name>` line per check; exits non-zero if any failed.
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const arg = process.argv[2];
if (!arg) { console.error('usage: firefly-sweep-check.mjs <module-base-dir>'); process.exit(2); }
const base = pathToFileURL(resolve(arg)).href;

const { entityGate } = await import(`${base}/services/canon-drift.js`);
const { recordCanonPlaces, acceptedPlacePhrases, loadCanonPlaces, canonPlacesPath } =
  await import(`${base}/services/canon-accept.js`);
const { stepRouting } = await import(`${base}/api/routes/_shared.js`);

let failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) console.log(`  PASS ${name}`);
  else { console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); failed++; }
};
const phrases = (list) => (list ?? []).map((c) => c.phrase).sort();
const hasPhrase = (list, want) => (list ?? []).some((p) => String(p).toLowerCase() === want);
const finds = (list) => (list ?? []).map((e) => `${e.find}->${e.replace}`).sort();

// ══ 1. unverifiable vs drifted vs auto-swap ═══════════════════════════════
// The live book: a hamlet anchor with NO roads reported 16 real Manhattan
// streets as invented. "Nothing to compare against" is not "wrong".
console.log('Change 2: a checker with nothing to check against says so');
{
  const roadless = 'The village of Phillipsport sits in Sullivan County.';
  const r = entityGate('She turned from Ludlow Street onto Delancey Street.', [roadless]);
  check('0 candidate roads -> unverifiable, never a gate',
    r.ambiguous.length === 0 && r.unverifiable.length === 2 && r.edits.length === 0,
    `edits=${r.edits.length} ambiguous=${r.ambiguous.length} unverifiable=${r.unverifiable.length}`);
  check('the unverifiable reason says there is no basis, not that it is wrong',
    /no basis to judge/i.test(r.unverifiable[0]?.reason ?? ''), r.unverifiable[0]?.reason);
}
{
  const twoTowns = 'Summitville Village and Wurtsboro Village are nearby.';
  const r = entityGate('They drove into Pine Cove Village.', [twoTowns]);
  check('2 candidate towns -> still an ambiguous human gate',
    r.ambiguous.length === 1 && r.unverifiable.length === 0 && r.edits.length === 0,
    `ambiguous=${JSON.stringify(phrases(r.ambiguous))} unverifiable=${r.unverifiable.length}`);
}
{
  const oneTown = 'Summitville Village is the only town.';
  const r = entityGate('They drove into Pine Cove Village.', [oneTown]);
  check('exactly 1 candidate -> silent auto-swap (unchanged)',
    r.edits.length === 1 && r.ambiguous.length === 0 && r.unverifiable.length === 0,
    `edits=${JSON.stringify(finds(r.edits))}`);
}

// ══ 2. accepting a place is KNOWN-only, never a swap target ═══════════════
// The review's HIGH finding: the anchor text also supplies the swap targets,
// so folding accepted places into it turned "never touch this" into "rewrite
// everything to this". These three are the regression guards.
console.log('Change 1: accepting a place changes nothing but what is reported');
{
  const anchor = 'Summitville Village and Wurtsboro Village are here. Main Street runs through it.';
  const doc = 'From Ludlow Street she drove to Pine Cove Village past Botany Village.';
  const before = entityGate(doc, [anchor]);
  const after = entityGate(doc, [anchor], ['botany village']);
  check('the accepted phrase stops being reported',
    hasPhrase(phrases(before.ambiguous), 'botany village')
      && !hasPhrase(phrases(after.ambiguous), 'botany village')
      && !hasPhrase(phrases(after.unverifiable), 'botany village'),
    `before=${JSON.stringify(phrases(before.ambiguous))} after=${JSON.stringify(phrases(after.ambiguous))}`);
  check('every OTHER place is decided exactly as before',
    JSON.stringify(finds(before.edits)) === JSON.stringify(finds(after.edits))
      && JSON.stringify(phrases(before.ambiguous).filter((p) => p.toLowerCase() !== 'botany village'))
         === JSON.stringify(phrases(after.ambiguous))
      && JSON.stringify(phrases(before.unverifiable)) === JSON.stringify(phrases(after.unverifiable)),
    `edits ${JSON.stringify(finds(before.edits))} -> ${JSON.stringify(finds(after.edits))}`);
}
{
  const anchor = 'Summitville Village and Wurtsboro Village are here.';
  const doc = 'They drove into Botany Village.';
  const r = entityGate(doc, [anchor], ['BOTANY VILLAGE']);
  check('an accepted phrase matches regardless of stored casing',
    r.ambiguous.length === 0 && r.unverifiable.length === 0 && r.edits.length === 0,
    `ambiguous=${JSON.stringify(phrases(r.ambiguous))}`);
}
{
  // The exact live scenario: accept ONE road on a roadless anchor.
  const roadless = 'The village of Phillipsport sits in Sullivan County.';
  const doc = 'She turned from Ludlow Street onto Bleecker Street.';
  const r = entityGate(doc, [roadless], ['delancey street']);
  check('accepting one road does NOT start swapping other streets to it',
    r.edits.length === 0 && r.unverifiable.length === 2,
    `edits=${JSON.stringify(finds(r.edits))}`);
}
{
  // An accepted place must not become an anchor: an anchorless book stays a no-op.
  const r = entityGate('She drove from Ludlow Street to Pine Cove Village.', [], ['delancey street', 'surf city']);
  check('accepted places alone are NOT an anchor — anchorless stays a no-op',
    r.edits.length === 0 && r.ambiguous.length === 0 && r.unverifiable.length === 0,
    `edits=${JSON.stringify(finds(r.edits))} ambiguous=${r.ambiguous.length}`);
}

// ══ 3. the per-book accepted store ════════════════════════════════════════
console.log('Change 1: the decision is written down and read back');
{
  const dir = mkdtempSync(join(tmpdir(), 'firefly-canon-'));
  try {
    const n = recordCanonPlaces(dir, [{ phrase: 'Botany Village', reason: 'unknown town' }], 'accepted', 'smoke');
    check('recordCanonPlaces persists an accepted phrase', n === 1, `recorded=${n}`);
    check('acceptedPlacePhrases reads it back',
      hasPhrase(acceptedPlacePhrases(dir), 'botany village'),
      JSON.stringify(acceptedPlacePhrases(dir)));
    recordCanonPlaces(dir, [{ phrase: 'Ludlow Street', reason: 'unknown road' }], 'declined', 'smoke');
    check('a DECLINED phrase is never treated as accepted',
      !hasPhrase(acceptedPlacePhrases(dir), 'ludlow street'),
      JSON.stringify(acceptedPlacePhrases(dir)));

    // A corrupt store must not silently destroy prior acceptances.
    writeFileSync(canonPlacesPath(dir), '{ this is not json');
    recordCanonPlaces(dir, [{ phrase: 'Surf City', reason: 'unknown town' }], 'accepted', 'smoke');
    check('a corrupt store is quarantined, not silently overwritten',
      readdirSync(dir).some((f) => /canon-places\.corrupt-/.test(f)),
      JSON.stringify(readdirSync(dir)));
    check('the store still works after a corrupt file',
      hasPhrase(acceptedPlacePhrases(dir), 'surf city'), JSON.stringify(acceptedPlacePhrases(dir)));
  } finally { rmSync(dir, { recursive: true, force: true }); }

  check('a missing book dir is fail-soft, not a throw', acceptedPlacePhrases(null).length === 0);
}

// ══ 4. "apply to every <role>" precedence ═════════════════════════════════
// The review's HIGH finding: 30 shipped pipelines bake a modelOverride into
// their step JSON, and a per-step override beat the stage pin — so the book
// pin never reached a chapter expanded AFTER the author set it.
console.log('Change 3: a book role pin beats the pipeline template');
const TEMPLATE = { provider: 'openrouter', model: 'google/gemini-3-pro', temperature: 0.4, source: 'template' };
const ROLE_PIN = { provider: 'claude', model: 'claude-opus-5' };
{
  const project = { roleModels: { rewrite: ROLE_PIN } };
  const step = { role: 'rewrite', taskType: 'revision', modelOverride: { ...TEMPLATE } };
  const r = stepRouting(project, step);
  check('the role pin beats a template-baked pin',
    r.provider === 'claude' && r.model === 'claude-opus-5', `${r.provider}/${r.model}`);
  check('the step keeps its pinned temperature', r.temperature === 0.4, `temp=${r.temperature}`);
}
{
  // Without a role pin, the template still governs — no regression.
  const r = stepRouting({}, { role: 'rewrite', taskType: 'revision', modelOverride: { ...TEMPLATE } });
  check('with no role pin the template still governs',
    r.provider === 'openrouter' && r.model === 'google/gemini-3-pro', `${r.provider}/${r.model}`);
}
{
  // An explicit pin the author set on THIS step still outranks the role pin.
  const project = { roleModels: { rewrite: ROLE_PIN } };
  const step = { role: 'rewrite', taskType: 'revision', modelOverride: { provider: 'openai', model: 'gpt-5' } };
  const r = stepRouting(project, step);
  check('an explicit per-step pin still beats the role pin',
    r.provider === 'openai' && r.model === 'gpt-5', `${r.provider}/${r.model}`);
}
{
  // Finding 2: roles are independent. A sibling role sharing the taskType
  // must NOT be dragged along (the old stageModels['revision'] bleed).
  const project = { roleModels: { rewrite: ROLE_PIN } };
  const sibling = { role: 'improve', taskType: 'revision', modelOverride: { ...TEMPLATE } };
  const r = stepRouting(project, sibling);
  check('a sibling role sharing the taskType is NOT dragged along',
    r.provider === 'openrouter' && r.model === 'google/gemini-3-pro', `${r.provider}/${r.model}`);
}
{
  // An unpinned future chapter step of the role inherits the book pin.
  const r = stepRouting({ roleModels: { draft: ROLE_PIN } }, { role: 'draft', taskType: 'creative_writing' });
  check('an unwritten chapter inherits the book role pin',
    r.provider === 'claude' && r.model === 'claude-opus-5', `${r.provider}/${r.model}`);
}

// ══ 5. the de-AI sweep is optional where the directions cover it ══════════
// Measured on the live book: 0 AI-tells matched across ch1-12, while the pass
// injected 4 passages and swapped 8 pronouns. The gate fix is load-bearing —
// the sweep IS the last step of a chapter, so a naive skip kills every gate.
console.log('Change 4: the de-AI sweep is optional, and the gate survives it');
{
  const { applyOptionalSteps } = await import(`${base}/services/pipeline/optional-steps.js`);
  const { computeBoundaries } = await import(`${base}/services/pipeline/gate-cadence.js`);

  const chapter = (n, sweepStatus = 'pending') => ([
    { label: `Scene Brief — Chapter ${n}`, role: 'scene_brief', chapterNumber: n, status: 'completed' },
    { label: `First Draft — Chapter ${n}`, role: 'draft', chapterNumber: n, status: 'completed' },
    { label: `Improvement Plan — Chapter ${n}`, role: 'improve', chapterNumber: n, status: 'completed' },
    { label: `Rewrite — Chapter ${n}`, role: 'rewrite', chapterNumber: n, status: 'completed' },
    { label: `Consistency Audit — Chapter ${n}`, chapterNumber: n, status: 'completed' },
    { label: `Consistency Apply — Chapter ${n}`, chapterNumber: n, status: 'completed' },
    { label: `Humanize — De-AI Sweep — Chapter ${n}`, role: 'humanize', chapterNumber: n, status: sweepStatus, optional: true },
  ]);

  const proj = { steps: chapter(2) };
  check('an optional sweep is skipped by default', applyOptionalSteps(proj, undefined) === 1
    && proj.steps.at(-1).status === 'skipped', `status=${proj.steps.at(-1).status}`);

  const applyIdx = proj.steps.findIndex((s) => /Consistency Apply/.test(s.label));
  check('the chapter gate MOVES to Consistency Apply (not lost)',
    computeBoundaries(applyIdx, proj.steps).includes('chapter'),
    `got ${JSON.stringify(computeBoundaries(applyIdx, proj.steps))}`);
  check('the skipped sweep does not itself gate',
    computeBoundaries(proj.steps.length - 1, proj.steps).length === 0);

  const forced = { steps: chapter(2) };
  check('deaiSweep:"run" keeps the sweep', applyOptionalSteps(forced, { deaiSweep: 'run' }) === 0
    && forced.steps.at(-1).status === 'pending');
  check('with the sweep running it is still the boundary',
    computeBoundaries(forced.steps.length - 1, forced.steps).includes('chapter'));

  const ran = { steps: chapter(2, 'completed') };
  applyOptionalSteps(ran, undefined);
  check('a sweep that already ran is never retro-skipped', ran.steps.at(-1).status === 'completed');
}

// the SHIPPED pipeline files must carry the flag (proves the deployed image, not the repo)
{
  const { readFileSync } = await import('node:fs');
  const libBase = arg.includes('/dist/') ? '/app/library' : 'library';
  const sweepOf = (p) => {
    const j = JSON.parse(readFileSync(`${libBase}/pipelines/${p}.json`, 'utf8'));
    const walk = (ss) => ss.flatMap((s) => (s.expand || s.parallel ? walk(s.steps ?? s.parallel ?? []) : [s]));
    return walk(j.steps ?? []).filter((s) => /De-AI|Humanize/i.test(String(s.label ?? '')));
  };
  for (const p of ['romance-spicy-deterministic', 'romance-sweet-deterministic']) {
    check(`${p} ships the sweep as optional`, sweepOf(p).every((s) => s.optional === true));
  }
  check('romantasy-production keeps its sweep mandatory',
    sweepOf('romantasy-production').every((s) => s.optional !== true));
}

// the flag must survive EXPANSION too — a pipeline JSON carrying `optional` is
// worthless if expandSteps drops it before a ProjectStep is ever built.
{
  const { expandSteps } = await import(`${base}/services/pipeline-expand.js`);
  const { readFileSync } = await import('node:fs');
  const libBase = arg.includes('/dist/') ? '/app/library' : 'library';
  const j = JSON.parse(readFileSync(`${libBase}/pipelines/romance-spicy-deterministic.json`, 'utf8'));
  const resolved = expandSteps(j.steps, { chapterCount: 3, wordsPerChapter: 1650 });
  const sweeps = resolved.filter((s) => s.role === 'humanize');
  check('expansion emits one sweep per chapter', sweeps.length === 3, `got ${sweeps.length}`);
  check('`optional` survives expansion onto every chapter',
    sweeps.every((s) => s.optional === true),
    `optional flags: ${JSON.stringify(sweeps.map((s) => s.optional))}`);
  check('no OTHER chapter step was marked optional',
    resolved.filter((s) => s.optional === true).length === 3,
    `${resolved.filter((s) => s.optional === true).length} optional steps total`);
}

console.log(failed === 0 ? '\nALL CHECKS PASSED' : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
