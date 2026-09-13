/**
 * Book contents tree (View Book §2/§3). `buildContents` turns a book manifest +
 * its bound project's steps + the data dir listing into the five-group item tree
 * the reading surface renders, and derives `run` from the project.
 *
 * The module is pure — no fs, no services — so these tests drive it entirely
 * from fixtures shaped like the production box's project-84 (24 chapters × the
 * seven deterministic romance steps).
 *
 * Run: node --import tsx --test tests/unit/book-contents.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildContents,
  resolveItem,
  type BuildInput,
  type BookViewItem,
} from '../../gateway/src/services/book-contents.js';
import { decideSave } from '../../gateway/src/services/book-save-routing.js';

// ---------------------------------------------------------------- fixtures --

/** The deterministic romance pipeline's seven steps per chapter, in order. */
const ROLE_LABELS = [
  'Scene Brief',
  'First Draft',
  'Improvement Plan',
  'Rewrite',
  'Consistency Audit',
  'Consistency Apply',
  'Humanize — De-AI Sweep',
];

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const stepFile = (s: any) => `${s.id}-${slugify(s.label)}.md`;

/** Chapter N's seven contiguous steps; chapter 1 starts at step 11 (project-84). */
function chapterSteps(ch: number, status = 'completed'): any[] {
  const first = 11 + (ch - 1) * 7;
  return ROLE_LABELS.map((role, i) => ({
    id: `project-84-step-${first + i}`,
    label: `${role} — Chapter ${ch}`,
    status,
    chapterNumber: ch,
    result: `${role} body for chapter ${ch}. `.repeat(20),
  }));
}

/** A project-84-shaped project: chapters 1..writtenThrough completed, rest pending. */
function project84(chapters = 24, writtenThrough = chapters): any {
  const steps: any[] = [
    { id: 'project-84-step-1', label: 'Character Bible', status: 'completed', result: 'cast'.repeat(60) },
    { id: 'project-84-step-2', label: 'Chapter Outline', status: 'completed', result: 'beats'.repeat(60) },
  ];
  for (let ch = 1; ch <= chapters; ch++) {
    steps.push(...chapterSteps(ch, ch <= writtenThrough ? 'completed' : 'pending'));
  }
  return { id: 'project-84', title: 'Three Months of Summer', bookSlug: 'summer', status: 'active', steps };
}

/** Every on-disk step file a completed step would have written. */
function filesFor(project: any): Array<{ name: string }> {
  return project.steps.filter((s: any) => s.status === 'completed').map((s: any) => ({ name: stepFile(s) }));
}

function input(over: Partial<BuildInput> = {}): BuildInput {
  return {
    manifest: { title: 'Three Months of Summer', pipeline: 'romance-sweet-deterministic', format: { chapterCount: 24 } },
    project: null,
    files: [],
    ...over,
  };
}

const groupOf = (groups: any[], id: string) => groups.find((g) => g.id === id)!;
const itemOf = (groups: any[], id: string): BookViewItem | undefined =>
  groups.flatMap((g: any) => g.items).find((i: BookViewItem) => i.id === id);

// ------------------------------------------------------------- group shape --

test('the five groups are always present, in order, even with no project', () => {
  const { groups, run } = buildContents(input());

  assert.deepEqual(groups.map((g) => g.id), ['front', 'manuscript', 'back', 'reference', 'launch']);
  for (const g of groups) {
    assert.equal(typeof g.label, 'string');
    assert.ok(g.label.length > 0, `${g.id} has a label`);
    assert.equal(typeof g.state, 'string');
    assert.ok(g.state.length > 0, `${g.id} has a state string`);
    assert.ok(Array.isArray(g.items), `${g.id} has items`);
  }

  assert.equal(run.status, 'none');
  assert.equal(run.frontier, 0);
  assert.equal(run.total, 24);
  assert.equal(run.projectId, undefined);
  assert.equal(run.gate, undefined);

  // A book with no run still lists its chapters as ghosts, and Reference is
  // empty because nothing has been produced or compiled.
  assert.equal(groupOf(groups, 'manuscript').items.length, 24);
  assert.equal(groupOf(groups, 'reference').items.length, 0);
  assert.equal(groupOf(groups, 'reference').state, 'not generated');
});

// -------------------------------------------------------------- manuscript --

test('a finished project-84 book yields 24 ready chapters, each with seven versions', () => {
  const project = project84(24);
  const { groups, run } = buildContents(input({ project, files: filesFor(project) }));
  const manuscript = groupOf(groups, 'manuscript');

  assert.equal(manuscript.items.length, 24);
  assert.equal(manuscript.state, '24 of 24 written');

  for (let ch = 1; ch <= 24; ch++) {
    const item = manuscript.items[ch - 1];
    assert.equal(item.id, `chapter:${ch}`, 'items are in chapter order');
    assert.equal(item.kind, 'prose');
    assert.equal(item.ready, true, `chapter ${ch} is ready`);
    assert.equal(item.versions.length, 7, `chapter ${ch} keeps all seven steps in the trail`);
    const latest = item.versions.filter((v) => v.latest);
    assert.equal(latest.length, 1, `chapter ${ch} has exactly one latest version`);
    // The last PROSE step is the chapter — never the JSON consistency audit.
    assert.equal(latest[0].label, `Humanize — De-AI Sweep — Chapter ${ch}`);
    assert.equal(latest[0].file, stepFile({ id: latest[0].id, label: latest[0].label }));
    assert.ok((item.words ?? 0) > 0, `chapter ${ch} carries a word count`);
    assert.ok(!item.flags?.some((f) => f.label === 'missing file'), 'no missing-file chip when the file is on disk');
  }

  assert.equal(run.projectId, 'project-84');
  assert.equal(run.frontier, 24);
  assert.equal(run.total, 24);
});

test('a half-written book stops the frontier at the last written chapter', () => {
  const project = project84(24, 9);
  const { groups, run } = buildContents(input({ project, files: filesFor(project) }));
  const manuscript = groupOf(groups, 'manuscript');

  assert.equal(run.frontier, 9);
  assert.equal(run.status, 'paused');
  assert.equal(manuscript.state, '9 of 24 written');

  for (let ch = 1; ch <= 9; ch++) {
    assert.equal(manuscript.items[ch - 1].ready, true, `chapter ${ch} is written`);
  }
  for (let ch = 10; ch <= 24; ch++) {
    const item = manuscript.items[ch - 1];
    assert.equal(item.ready, false, `chapter ${ch} is not written`);
    assert.deepEqual(item.versions, [], `chapter ${ch} has no version trail`);
    assert.equal(item.words, undefined);
  }
});

test('a step whose file is gone renders with a missing-file flag, not an error', () => {
  const project = project84(2);
  const files = filesFor(project).filter((f) => !f.name.includes('chapter-2'));
  const { groups } = buildContents(input({ project, files, manifest: { format: { chapterCount: 2 } } }));

  const ch2 = itemOf(groups, 'chapter:2')!;
  assert.equal(ch2.ready, true, 'the step exists, so the row is still ready');
  assert.ok(ch2.flags?.some((f) => f.label === 'missing file'), 'the row is chipped missing file');
});

// -------------------------------------------------------------------- run ---

test('a gated project reports status gated and points the gate at its chapter', () => {
  const project = project84(24, 8);
  // The gate paused after chapter 8's de-AI sweep (the last step of chapter 8).
  const gatedStep = project.steps.filter((s: any) => s.chapterNumber === 8).at(-1);
  project.review = { confirmationId: 'conf-77', stepId: gatedStep.id, kind: 'cadence-gate' };

  const { groups, run } = buildContents(input({
    project,
    files: filesFor(project),
    gate: { findings: { craft: ['POV slips to third person'] }, expiresAt: '2026-09-13T12:00:00.000Z' },
  }));

  assert.equal(run.status, 'gated');
  assert.equal(run.gate?.confirmationId, 'conf-77');
  assert.equal(run.gate?.stepId, gatedStep.id);
  assert.equal(run.gate?.itemId, 'chapter:8', 'the UI can jump straight to the gated chapter');
  assert.equal(run.gate?.expiresAt, '2026-09-13T12:00:00.000Z');
  assert.deepEqual(run.gate?.findings, { craft: ['POV slips to third person'] });

  const ch8 = itemOf(groups, 'chapter:8')!;
  assert.ok(ch8.flags?.some((f) => f.label === 'gate'), 'the gated chapter carries a gate chip');
});

// A cadence gate fires BEFORE engine.completeStep, so the gated step is still
// `active` with an empty result and its text lives only on review.pendingResult.
// The gated pass IS the chapter's current version — otherwise the reading pane
// shows the pre-gate text, and the editor's save lands on the previous pass's
// file only to be destroyed when the gate resumes.
function gatedProject(chapters: number, gatedChapter: number, gatedIndex: number): any {
  const project = project84(chapters, gatedChapter - 1);
  const mine = project.steps.filter((s: any) => s.chapterNumber === gatedChapter);
  mine.forEach((s: any, i: number) => {
    if (i < gatedIndex) s.status = 'completed';
    else if (i === gatedIndex) { s.status = 'active'; s.result = ''; }
    else s.status = 'pending';
  });
  project.review = {
    confirmationId: 'conf-91',
    stepId: mine[gatedIndex].id,
    kind: 'cadence-gate',
    pendingResult: `pending gate text for chapter ${gatedChapter}. `.repeat(20),
  };
  return project;
}

test('an ACTIVE gated step is the chapter\'s latest version, not the pass before it', () => {
  const project = gatedProject(24, 9, 6);            // gated on the de-AI sweep
  const built = input({ project, files: filesFor(project) });
  const { groups, run } = buildContents(built);

  const ch9 = itemOf(groups, 'chapter:9')!;
  assert.equal(ch9.ready, true, 'the gated chapter is readable');
  const latest = ch9.versions.filter((v) => v.latest);
  assert.equal(latest.length, 1);
  assert.equal(latest[0].id, run.gate!.stepId, 'the gated step is the current version');
  assert.ok((ch9.words ?? 0) > 0, 'the pending text carries the word count');
  assert.equal(run.gate?.itemId, 'chapter:9');

  // …so the editor routes the save through the gate rather than writing the
  // previous pass's file (which applyReviewResume would then overwrite).
  const resolved = resolveItem(built, 'chapter:9')!;
  assert.equal(resolved.stepId, run.gate!.stepId);
  assert.equal(decideSave({
    versionIsLatest: true,
    itemReady: resolved.item.ready,
    itemIsDerived: !!resolved.item.derived,
    gateStepId: run.gate?.stepId,
    itemLatestStepId: resolved.stepId,
    projectIsDriving: false,
  }).mode, 'gate-edit');
});

test('a chapter gated on its FIRST prose step is still ready, with a version trail', () => {
  const project = gatedProject(24, 10, 1);           // gated on the first draft
  const built = input({ project, files: filesFor(project) });
  const { groups, run } = buildContents(built);

  const ch10 = itemOf(groups, 'chapter:10')!;
  assert.equal(ch10.ready, true, 'without this the gate panel has no row to render');
  assert.ok(ch10.versions.length > 0, 'the gated pass is in the trail');
  assert.equal(ch10.versions.filter((v) => v.latest)[0].id, run.gate!.stepId);
  assert.equal(run.gate?.itemId, 'chapter:10', 'the gate panel needs the item id');
  assert.ok(ch10.flags?.some((f) => f.label === 'gate'), 'the gated chapter carries a gate chip');
  assert.equal(resolveItem(built, 'chapter:10')!.stepId, run.gate!.stepId);
});

test('a gate on a non-prose step leaves the chapter on its last completed prose pass', () => {
  const project = gatedProject(24, 11, 4);           // gated on the consistency AUDIT
  const { groups, run } = buildContents(input({ project, files: filesFor(project) }));

  const ch11 = itemOf(groups, 'chapter:11')!;
  const latest = ch11.versions.filter((v) => v.latest);
  assert.equal(latest.length, 1);
  assert.equal(latest[0].label, 'Rewrite — Chapter 11', 'a JSON audit is never the chapter text');
  assert.notEqual(latest[0].id, run.gate!.stepId);
});

test('a project the engine is driving reports writing; a finished one reports complete', () => {
  const driving = buildContents(input({ project: project84(24, 12), projectIsDriving: true })).run;
  assert.equal(driving.status, 'writing');

  const done = project84(24);
  assert.equal(buildContents(input({ project: done, files: filesFor(done) })).run.status, 'complete');
});

// ------------------------------------------------------------ ghost items ---

test('unwritten items carry the skill and pipeline that would produce them', () => {
  const { groups } = buildContents(input());

  for (const group of groups) {
    for (const item of group.items) {
      if (item.ready) continue;
      assert.ok(item.producedBy, `${item.id} ghost row names its producer`);
      assert.ok(item.producedBy!.skill.length > 0, `${item.id} names a skill`);
      assert.ok(item.producedBy!.pipeline.length > 0, `${item.id} names a pipeline`);
      assert.deepEqual(item.versions, [], `${item.id} ghost row has no versions`);
    }
  }

  // Every catalogued group has ghosts when nothing has been produced.
  for (const id of ['front', 'manuscript', 'back', 'launch']) {
    assert.ok(groupOf(groups, id).items.some((i: BookViewItem) => !i.ready), `${id} has ghost rows`);
  }
  for (const id of ['front', 'back', 'launch']) {
    assert.equal(groupOf(groups, id).state, 'not generated');
  }
  // The manuscript counts against the declared chapter count rather than
  // collapsing to "not generated" — the total is the useful part.
  assert.equal(groupOf(groups, 'manuscript').state, '0 of 24 written');

  // The design's producer table, spot-checked.
  assert.equal(itemOf(groups, 'front:cover')!.producedBy!.skill, 'cover-designer');
  assert.equal(itemOf(groups, 'front:cover')!.kind, 'cover');
  assert.equal(itemOf(groups, 'front:title')!.producedBy!.pipeline, 'format-export');
  assert.equal(itemOf(groups, 'back:newsletter')!.producedBy!.skill, 'blurb-writer');
  assert.equal(itemOf(groups, 'launch:categories')!.producedBy!.skill, 'research');
  assert.equal(itemOf(groups, 'launch:ad-copy')!.producedBy!.skill, 'ad-copy');
  assert.equal(itemOf(groups, 'launch:amazon-description')!.producedBy!.pipeline, 'book-launch');
});

test('optional items are chipped optional and are never counted as missing', () => {
  const { groups } = buildContents(input());
  const chipped = (id: string) => itemOf(groups, id)!.flags?.some((f) => f.level === 'note' && f.label === 'optional');

  assert.ok(chipped('front:dedication'), 'Dedication is optional');
  assert.ok(chipped('front:also-by'), 'front Also-by is optional');
  assert.ok(!chipped('front:title'), 'the title page is not optional');
  assert.ok(!chipped('back:acknowledgements'), 'acknowledgements are not optional');
});

// -------------------------------------------------------------- reference ---

test('reference lists the compiled book first, and only when a compiled file exists', () => {
  const project = project84(24);
  const files = filesFor(project);

  const without = buildContents(input({ project, files }));
  assert.equal(itemOf(without.groups, 'ref:compiled'), undefined, 'no compiled row without a compiled file');
  // Non-chapter steps still surface as reference documents.
  assert.deepEqual(
    groupOf(without.groups, 'reference').items.map((i: BookViewItem) => i.id),
    ['ref:character-bible', 'ref:chapter-outline'],
  );
  assert.equal(groupOf(without.groups, 'reference').state, '2 documents');

  const withCompiled = buildContents(input({
    project,
    files: [...files, { name: 'compiled-manuscript.md' }],
    compiled: { file: 'compiled-manuscript.md', words: 81234, createdAt: '2026-09-12T09:00:00.000Z', versions: [{ id: 'v2' }, { id: 'v1' }] },
  }));
  const reference = groupOf(withCompiled.groups, 'reference');
  assert.equal(reference.items[0].id, 'ref:compiled', 'the compiled book is the first Reference row');
  assert.equal(reference.items[0].derived, true);
  assert.equal(reference.items[0].kind, 'document');
  assert.equal(reference.items[0].ready, true);
  assert.equal(reference.items[0].words, 81234);
  // Earlier compiles stay in the trail; only the current file is latest.
  assert.equal(reference.items[0].versions.length, 3);
  assert.equal(reference.items[0].versions.at(-1)!.latest, true);
  assert.equal(reference.items[0].versions.at(-1)!.file, 'compiled-manuscript.md');
  assert.equal(reference.items[0].versions.filter((v) => v.latest).length, 1);
});

// ------------------------------------------------------------ resolveItem ---

test('resolveItem returns the latest version of a chapter', () => {
  const project = project84(24);
  const resolved = resolveItem(input({ project, files: filesFor(project) }), 'chapter:19');

  assert.ok(resolved, 'chapter:19 resolves');
  assert.equal(resolved!.item.id, 'chapter:19');
  // Chapter 19's seven steps start at 137; the de-AI sweep is the seventh.
  assert.equal(resolved!.stepId, 'project-84-step-143');
  assert.equal(resolved!.file, 'project-84-step-143-humanize-de-ai-sweep-chapter-19.md');
  assert.equal(resolved!.versions.length, 7);
});

test('resolveItem refuses unknown ids and anything that could escape the data dir', () => {
  const project = project84(24);
  const built = input({ project, files: filesFor(project) });

  assert.equal(resolveItem(built, 'chapter:99'), null, 'a chapter past the book is unknown');
  assert.equal(resolveItem(built, 'ref:nope'), null, 'an undiscovered document is unknown');
  assert.equal(resolveItem(built, 'nonsense'), null, 'an unshaped id is unknown');
  assert.equal(resolveItem(built, ''), null, 'an empty id is unknown');

  for (const escape of [
    '../../../etc/passwd',
    'chapter:../../etc/passwd',
    'ref:../.vault/vault.enc',
    'front:..%2F..%2Fbook.json',
    'ref:compiled/../../book.json',
  ]) {
    assert.equal(resolveItem(built, escape), null, `${escape} must not resolve`);
  }
});

// ------------------------------------------------------- the whole CHAIN ----
// A book past the writing phase has a launch/format project as its FRONTIER,
// and that project holds no chapter steps. Resolving contents from the frontier
// alone therefore showed "0 of 32 written" and an empty Reference group for
// exactly the finished books a reader wants to read (found on Mercury,
// 2026-09-12). The route now hands `buildContents` every step in the book's
// chain, in chain order.

/** Planning-phase steps: the reference documents earlier phases produce. */
function planningSteps(): any[] {
  return [
    { id: 'project-660-step-1', label: 'Character Bible', status: 'completed', result: 'cast '.repeat(60) },
    { id: 'project-660-step-2', label: 'Chapter Outline', status: 'completed', result: 'beats '.repeat(60) },
  ];
}

/** Launch-phase steps: one per launch catalog entry. */
const LAUNCH_LABELS = [
  'Back Cover Blurb',
  'Amazon Book Description',
  'Amazon Categories & Keywords',
  'Ad Copy',
  'Social Launch Posts',
  'Launch Checklist & Timeline',
  'Book Cover Concepts',
];
function launchSteps(): any[] {
  return LAUNCH_LABELS.map((label, i) => ({
    id: `project-665-step-${i + 1}`, label, status: 'completed', result: `${label} copy. `.repeat(20),
  }));
}

/** The chain's steps, concatenated in chain order, on the FRONTIER project's id. */
function chainProject(writtenThrough = 24): any {
  const production = project84(24, writtenThrough);
  return {
    id: 'project-665', title: 'My Second Test Medical Romance', bookSlug: 'medical', status: 'active',
    steps: [...planningSteps(), ...production.steps, ...launchSteps()],
  };
}

test('a book whose FRONTIER is its launch project still shows the chapters the production project wrote', () => {
  const project = chainProject();
  const { groups, run } = buildContents(input({ project, files: filesFor(project) }));

  // The Mercury bug: "0 of 32 written" on a finished book.
  assert.equal(groupOf(groups, 'manuscript').state, '24 of 24 written');
  assert.equal(groupOf(groups, 'manuscript').items.filter((i: BookViewItem) => i.ready).length, 24);
  assert.equal(run.frontier, 24);
  assert.equal(run.projectId, 'project-665', 'run still names the project carrying the state');

  // …and "0 reference documents", because the bible and outline live in the
  // planning project earlier in the same chain.
  const reference = groupOf(groups, 'reference');
  assert.ok(reference.items.some((i: BookViewItem) => i.id === 'ref:character-bible'), 'the character bible is reference');
  assert.ok(reference.items.some((i: BookViewItem) => i.id === 'ref:chapter-outline'), 'the chapter outline is reference');

  // The launch copy that DID show before must keep showing.
  assert.equal(groupOf(groups, 'launch').state, '7 of 7 written');
});

test('when two chain phases both wrote chapter N, the LATER phase is its current version', () => {
  const project = chainProject();
  const revision = {
    id: 'project-670-step-4', label: 'Revision Rewrite — Chapter 5', status: 'completed',
    chapterNumber: 5, result: 'the revised chapter five. '.repeat(30),
  };
  project.steps.push(revision);                       // a later chain phase

  const built = input({ project, files: [...filesFor(project), { name: stepFile(revision) }] });
  const { groups } = buildContents(built);

  const ch5 = itemOf(groups, 'chapter:5')!;
  assert.equal(ch5.versions.filter((v) => v.latest).length, 1);
  assert.equal(ch5.versions.filter((v) => v.latest)[0].id, revision.id, 'the later pass is the chapter');
  assert.equal(resolveItem(built, 'chapter:5')!.stepId, revision.id);
});

test('a gate held by a NON-frontier project still gates its chapter and routes the edit', () => {
  // Production is gated at chapter 12 while the chain's frontier is elsewhere;
  // `run` derives from the project that carries the gate.
  const project = chainProject(11);
  const mine = project.steps.filter((s: any) => s.chapterNumber === 12);
  mine.forEach((s: any, i: number) => {
    if (i < 6) s.status = 'completed';
    else if (i === 6) { s.status = 'active'; s.result = ''; }
    else s.status = 'pending';
  });
  project.review = {
    confirmationId: 'conf-12', stepId: mine[6].id, kind: 'cadence-gate',
    pendingResult: 'pending gate text for chapter 12. '.repeat(20),
  };

  const built = input({ project, files: filesFor(project) });
  const { run } = buildContents(built);

  assert.equal(run.status, 'gated');
  assert.equal(run.gate?.stepId, mine[6].id);
  assert.equal(run.gate?.itemId, 'chapter:12');

  const resolved = resolveItem(built, 'chapter:12')!;
  assert.equal(resolved.stepId, run.gate!.stepId, 'the gated pass is the editable version');
  assert.equal(decideSave({
    versionIsLatest: true,
    itemReady: resolved.item.ready,
    itemIsDerived: !!resolved.item.derived,
    gateStepId: run.gate?.stepId,
    itemLatestStepId: resolved.stepId,
    projectIsDriving: false,
  }).mode, 'gate-edit');
});

// ------------------------------ the route: GET /api/books/:slug/contents ----
// `buildContents` is pure, so the Mercury failure lived one level up: the route
// resolved the book's project with `frontierProjectForBook`, which returns the
// chain's CURRENT phase. Past the writing phase that is the launch project,
// which holds no chapter steps — so a finished book reported "0 of 32 written"
// and no reference documents. The route must gather the WHOLE chain.

/** Boot the books routes over a temp data dir and GET the contents tree. */
async function getContents(chain: any[], frontier: any) {
  const { mkdtempSync, writeFileSync, readdirSync, rmSync } = await import('fs');
  const { join } = await import('path');
  const { tmpdir } = await import('os');
  const express = (await import('express')).default;
  const { mountBooks } = await import('../../gateway/src/api/routes/books.routes.js');

  const dir = mkdtempSync(join(tmpdir(), 'bookclaw-contents-'));
  for (const p of chain) {
    for (const s of p.steps) {
      if (s.status === 'completed') writeFileSync(join(dir, stepFile(s)), `# ${s.label}\n\n${s.result}`, 'utf-8');
    }
  }

  const services: any = {
    books: {
      exists: () => true,
      dataDirOf: () => dir,
      open: async () => ({ manifest: { title: 'My Second Test Medical Romance', pipeline: 'romance-sweet-deterministic', format: { chapterCount: 24 } } }),
      listFiles: () => readdirSync(dir).map((name) => ({ name })),
    },
    confirmationGate: { get: () => null },
  };
  const gateway: any = {
    getServices: () => services,
    getProjectEngine: () => ({
      chainProjectsForBook: () => chain,
      frontierProjectForBook: () => frontier,
      isDriving: () => false,
    }),
  };
  const app = express();
  mountBooks(app as any, gateway, dir);
  const server = app.listen(0);
  await new Promise<void>((r) => server.once('listening', () => r()));
  const port = (server.address() as any).port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/books/medical/contents`);
    return { status: res.status, body: await res.json() as any };
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    rmSync(dir, { recursive: true, force: true });
  }
}

test('GET /contents on a book in its LAUNCH phase still reports the chapters and reference docs', async () => {
  const planning = { id: 'project-660', bookSlug: 'medical', status: 'completed', steps: planningSteps() };
  const production = { id: 'project-663', bookSlug: 'medical', status: 'completed', steps: project84(24).steps };
  const launch = { id: 'project-665', bookSlug: 'medical', status: 'completed', steps: launchSteps() };

  const { status, body } = await getContents([planning, production, launch], launch);
  assert.equal(status, 200);

  assert.equal(groupOf(body.groups, 'manuscript').state, '24 of 24 written');
  assert.equal(body.run.frontier, 24, 'the frontier is the last written chapter, not 0');
  assert.equal(body.run.projectId, 'project-665', 'run still names the project that carries the state');
  assert.ok(groupOf(body.groups, 'reference').items.some((i: any) => i.id === 'ref:character-bible'));
  assert.ok(groupOf(body.groups, 'reference').items.some((i: any) => i.id === 'ref:chapter-outline'));
  assert.equal(groupOf(body.groups, 'launch').state, '7 of 7 written');
});

test('GET /contents derives run from the GATED project even when it is not the frontier', async () => {
  const production = { id: 'project-663', bookSlug: 'medical', status: 'paused', steps: project84(24, 11).steps };
  const mine = production.steps.filter((s: any) => s.chapterNumber === 12);
  mine.forEach((s: any, i: number) => {
    if (i < 6) s.status = 'completed';
    else if (i === 6) { s.status = 'active'; s.result = ''; }
    else s.status = 'pending';
  });
  (production as any).review = {
    confirmationId: 'conf-12', stepId: mine[6].id, kind: 'cadence-gate',
    pendingResult: 'pending gate text for chapter 12. '.repeat(20),
  };
  const launch = { id: 'project-665', bookSlug: 'medical', status: 'pending', steps: launchSteps().map((s) => ({ ...s, status: 'pending' })) };

  const { status, body } = await getContents([production, launch], launch);
  assert.equal(status, 200);
  assert.equal(body.run.status, 'gated');
  assert.equal(body.run.projectId, 'project-663', 'the gate belongs to production, so run names it');
  assert.equal(body.run.gate?.stepId, mine[6].id);
  assert.equal(body.run.gate?.itemId, 'chapter:12');
});

// --------------------------------------------- files no project step claims --
// The production regression (Neptune, 2026-09-12): 14 of 21 books rendered a
// COMPLETELY EMPTY View Book. They are older/imported books that predate
// per-book project binding — no project at all, and a data dir holding a
// whole-book `manuscript.md` rather than per-chapter step files. A step-only
// tree therefore found nothing. The design's Error handling section already
// requires the opposite: "contents still lists whatever files exist. A book can
// be read without a run."

test('a book with NO project and only manuscript.md on disk is still readable', () => {
  const built = input({
    project: null,
    files: [{ name: 'manuscript.md', modified: '2026-03-04T10:00:00.000Z' }],
  });
  const { groups, run } = buildContents(built);

  assert.equal(run.status, 'none', 'no project bound → run.status none');
  assert.equal(run.projectId, undefined);
  assert.equal(groupOf(groups, 'manuscript').state, '0 of 24 written', 'the group state stays honest');

  const reference = groupOf(groups, 'reference');
  const manuscript = reference.items[0];
  assert.ok(manuscript, 'Reference is not empty');
  assert.equal(manuscript.id, 'ref:manuscript');
  assert.equal(manuscript.title, 'Manuscript');
  assert.equal(manuscript.kind, 'document');
  assert.equal(manuscript.ready, true);
  assert.ok(!manuscript.derived, 'authored content, not derived');
  assert.equal(manuscript.versions.length, 1);
  assert.equal(manuscript.versions[0].latest, true);
  assert.equal(manuscript.versions[0].file, 'manuscript.md');
  assert.equal(manuscript.versions[0].createdAt, '2026-03-04T10:00:00.000Z');
  assert.equal(reference.state, '1 document');
});

test('a discovered file resolves and saves through the plain file path', () => {
  const built = input({ project: null, files: [{ name: 'manuscript.md' }] });
  const resolved = resolveItem(built, 'ref:manuscript');

  assert.ok(resolved, 'ref:manuscript resolves');
  assert.equal(resolved!.file, 'manuscript.md');
  assert.equal(resolved!.stepId, undefined, 'no owning step — never a step-result update');

  const { run } = buildContents(built);
  assert.equal(decideSave({
    versionIsLatest: true,
    itemReady: resolved!.item.ready,
    itemIsDerived: !!resolved!.item.derived,
    gateStepId: run.gate?.stepId,
    itemLatestStepId: resolved!.stepId,
    projectIsDriving: false,
  }).mode, 'file');
});

test('an unclaimed file joins Reference once, without shadowing the step documents', () => {
  const project = project84(24);
  const files = [...filesFor(project), { name: 'notes.md', modified: '2026-09-01T00:00:00.000Z' }];
  const { groups, run } = buildContents(input({ project, files }));

  // The chapters still come from the steps.
  assert.equal(groupOf(groups, 'manuscript').state, '24 of 24 written');
  assert.equal(run.frontier, 24);

  const ids = groupOf(groups, 'reference').items.map((i: BookViewItem) => i.id);
  assert.deepEqual(ids, ['ref:character-bible', 'ref:chapter-outline', 'ref:notes']);
  assert.equal(ids.filter((id) => id === 'ref:notes').length, 1, 'discovered exactly once');
  assert.equal(itemOf(groups, 'ref:notes')!.title, 'Notes');
});

test('a file a step already claims is never duplicated as a discovered file', () => {
  const project = project84(24);
  const files = filesFor(project);                    // every step file, nothing else
  const { groups } = buildContents(input({ project, files }));

  const reference = groupOf(groups, 'reference');
  assert.deepEqual(reference.items.map((i: BookViewItem) => i.id), ['ref:character-bible', 'ref:chapter-outline']);

  // No chapter step file leaks into Reference either.
  const chapterFile = stepFile(project.steps.find((s: any) => s.chapterNumber === 7));
  assert.ok(!reference.items.some((i: BookViewItem) => i.versions.some((v) => v.file === chapterFile)));
});

test('the compiled book stays derived while discovered files are not, and manuscript.md sorts first', () => {
  const project = project84(24);
  const { groups } = buildContents(input({
    project,
    files: [...filesFor(project), { name: 'compiled-manuscript.md' }, { name: 'manuscript.md' }, { name: 'notes.md' }],
    compiled: { file: 'compiled-manuscript.md', words: 81234, createdAt: '2026-09-12T09:00:00.000Z' },
  }));
  const reference = groupOf(groups, 'reference');

  assert.deepEqual(
    reference.items.map((i: BookViewItem) => i.id),
    ['ref:manuscript', 'ref:compiled', 'ref:character-bible', 'ref:chapter-outline', 'ref:notes'],
  );
  assert.equal(itemOf(groups, 'ref:compiled')!.derived, true);
  assert.ok(!itemOf(groups, 'ref:manuscript')!.derived);
  assert.ok(!itemOf(groups, 'ref:notes')!.derived);
  // The compiled file is never discovered a second time under its own name.
  assert.ok(!reference.items.some((i: BookViewItem) => i.id === 'ref:compiled-manuscript'));

  assert.equal(decideSave({
    versionIsLatest: true, itemReady: true, itemIsDerived: true, projectIsDriving: false,
  }).mode, 'refuse', 'the compiled output stays locked');
});

test('dotfiles and non-markdown files are never discovered', () => {
  const { groups } = buildContents(input({
    project: null,
    files: [{ name: '.state.json' }, { name: 'cover.png' }, { name: 'outline.docx' }, { name: 'manuscript.md' }],
  }));
  assert.deepEqual(groupOf(groups, 'reference').items.map((i: BookViewItem) => i.id), ['ref:manuscript']);
});
