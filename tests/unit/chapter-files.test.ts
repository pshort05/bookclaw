/**
 * Chapter version resolution (View Book §4). One helper answers "which step /
 * file is chapter N" for every pipeline. Two callers were wrong for the
 * `romance-*-deterministic` pipelines, which write SEVEN steps per chapter:
 * manuscript assembly matched none of their file names (0 chapters assembled)
 * and gatherChapters matched too many (scene briefs, JSON audits, and TWO
 * prose steps per chapter → a duplicated manuscript).
 *
 * Run: node --import tsx --test tests/unit/chapter-files.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyRole,
  classifyChapterFile,
  chapterVersions,
  latestProseStep,
  chapterTextSteps,
} from '../../gateway/src/services/pipeline/chapter-files.js';
import { assembleManuscript, parseChapterFile } from '../../gateway/src/services/manuscript-assembly.js';
import { makeGatherChapters } from '../../gateway/src/api/routes/_shared.js';

// ---------------------------------------------------------------- fixtures --
// The deterministic romance pipeline's seven steps per chapter, in order, with
// the exact labels observed on the production box (project-84).
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

/** Chapter N's seven contiguous steps; chapter 1 starts at step 11 (project-84). */
function chapterSteps(ch: number, statuses: string[] = []): any[] {
  const first = 11 + (ch - 1) * 7;
  return ROLE_LABELS.map((role, i) => ({
    id: `project-84-step-${first + i}`,
    label: `${role} — Chapter ${ch}`,
    status: statuses[i] ?? 'completed',
    chapterNumber: ch,
    result: `${role} body for chapter ${ch}. `.repeat(20),
  }));
}

const project84Steps = (chapters = 24): any[] =>
  Array.from({ length: chapters }, (_, i) => chapterSteps(i + 1)).flat();

const stepFileName = (s: any) => `${s.id}-${slugify(s.label)}.md`;

// --------------------------------------------------------------- classifyRole
test('classifyRole maps the seven deterministic labels to their roles', () => {
  assert.equal(classifyRole('Scene Brief — Chapter 8'), 'scene-brief');
  assert.equal(classifyRole('First Draft — Chapter 8'), 'first-draft');
  assert.equal(classifyRole('Improvement Plan — Chapter 8'), 'improvement-plan');
  assert.equal(classifyRole('Rewrite — Chapter 8'), 'rewrite');
  assert.equal(classifyRole('Consistency Audit — Chapter 8'), 'consistency-audit');
  assert.equal(classifyRole('Consistency Apply — Chapter 8'), 'consistency-apply');
  assert.equal(classifyRole('Humanize — De-AI Sweep — Chapter 8'), 'humanize');
});

test('classifyRole maps write/polish and the legacy deterministic humanize label', () => {
  assert.equal(classifyRole('Write Chapter 12'), 'write');
  assert.equal(classifyRole('Write Chapter 1: The Night Shift'), 'write');
  assert.equal(classifyRole('Polish Chapter 12'), 'polish');
  assert.equal(classifyRole('Humanize (Deterministic) — Chapter 3'), 'humanize');
});

test('classifyRole returns unknown for a label it does not recognise', () => {
  assert.equal(classifyRole('Compile Manuscript'), 'unknown');
  assert.equal(classifyRole('Develop Premise'), 'unknown');
  assert.equal(classifyRole(''), 'unknown');
});

// --------------------------------------------------------- classifyChapterFile
test('classifyChapterFile reads chapter number + role from real step-output file names', () => {
  assert.deepEqual(classifyChapterFile('project-84-step-172-scene-brief-chapter-24.md'), { number: 24, role: 'scene-brief' });
  assert.deepEqual(classifyChapterFile('project-84-step-173-first-draft-chapter-24.md'), { number: 24, role: 'first-draft' });
  assert.deepEqual(classifyChapterFile('project-84-step-174-improvement-plan-chapter-24.md'), { number: 24, role: 'improvement-plan' });
  assert.deepEqual(classifyChapterFile('project-84-step-175-rewrite-chapter-24.md'), { number: 24, role: 'rewrite' });
  assert.deepEqual(classifyChapterFile('project-84-step-176-consistency-audit-chapter-24.md'), { number: 24, role: 'consistency-audit' });
  assert.deepEqual(classifyChapterFile('project-84-step-177-consistency-apply-chapter-24.md'), { number: 24, role: 'consistency-apply' });
  assert.deepEqual(classifyChapterFile('project-84-step-178-humanize-de-ai-sweep-chapter-24.md'), { number: 24, role: 'humanize' });
  assert.deepEqual(classifyChapterFile('project-51-step-1-write-chapter-12.md'), { number: 12, role: 'write' });
  assert.deepEqual(classifyChapterFile('project-51-step-2-polish-chapter-1.md'), { number: 1, role: 'polish' });
  assert.deepEqual(classifyChapterFile('project-70-step-9-humanize-deterministic-chapter-3.md'), { number: 3, role: 'humanize' });
});

test('classifyChapterFile returns null for non-chapter files', () => {
  assert.equal(classifyChapterFile('project-51-step-65-compile-manuscript.md'), null);
  assert.equal(classifyChapterFile('project-49-step-2-develop-premise.md'), null);
  // the deep-revision whole-manuscript rewrite carries no chapter number
  assert.equal(classifyChapterFile('p-step-3-apply-macro-revisions-full-manuscript-rewrite-.md'), null);
});

// ------------------------------------------------------------ chapterVersions
test('chapterVersions returns the seven versions in pipeline order, prose tagged', () => {
  const versions = chapterVersions(project84Steps(), 8);
  assert.equal(versions.length, 7);
  assert.deepEqual(versions.map((v) => v.role), [
    'scene-brief', 'first-draft', 'improvement-plan', 'rewrite',
    'consistency-audit', 'consistency-apply', 'humanize',
  ]);
  assert.deepEqual(versions.map((v) => v.id), [
    'project-84-step-60', 'project-84-step-61', 'project-84-step-62', 'project-84-step-63',
    'project-84-step-64', 'project-84-step-65', 'project-84-step-66',
  ]);
  assert.deepEqual(versions.map((v) => v.isProse), [false, true, false, true, false, true, true]);
});

test('chapterVersions marks exactly one latest, and it is the humanize step', () => {
  const versions = chapterVersions(project84Steps(), 19);
  const latest = versions.filter((v) => v.latest);
  assert.equal(latest.length, 1);
  assert.equal(latest[0].role, 'humanize');
  assert.equal(latest[0].id, 'project-84-step-143');
});

test('chapterVersions returns [] for a chapter with no steps', () => {
  assert.deepEqual(chapterVersions(project84Steps(2), 9), []);
});

// ----------------------------------------------------------- latestProseStep
test('latestProseStep returns the de-AI sweep step for a fully written chapter', () => {
  const step = latestProseStep(project84Steps(), 24);
  assert.ok(step);
  assert.equal(step.id, 'project-84-step-178');
  assert.equal(step.label, 'Humanize — De-AI Sweep — Chapter 24');
});

test('latestProseStep falls back to the rewrite step when later prose steps are not completed', () => {
  //                         brief      draft       plan        rewrite     audit      apply      humanize
  const statuses = ['completed', 'completed', 'completed', 'completed', 'completed', 'pending', 'pending'];
  const step = latestProseStep(chapterSteps(3, statuses), 3);
  assert.ok(step);
  assert.equal(step.label, 'Rewrite — Chapter 3');
});

test('latestProseStep NEVER returns a non-prose step (brief / plan / audit)', () => {
  // Only the non-prose steps of the chapter completed.
  const statuses = ['completed', 'pending', 'completed', 'pending', 'completed', 'pending', 'pending'];
  assert.equal(latestProseStep(chapterSteps(4, statuses), 4), null);
});

test('latestProseStep returns null for an unknown chapter', () => {
  assert.equal(latestProseStep(project84Steps(2), 17), null);
});

test('latestProseStep matches on the label when chapterNumber is absent', () => {
  const steps = chapterSteps(5).map(({ chapterNumber, ...rest }) => rest);
  const step = latestProseStep(steps, 5);
  assert.ok(step);
  assert.equal(step.label, 'Humanize — De-AI Sweep — Chapter 5');
});

// ---------------------------------------------- manuscript-assembly rewiring
test('parseChapterFile still reads write/polish files (existing callers unchanged)', () => {
  assert.deepEqual(parseChapterFile('project-51-step-2-polish-chapter-1.md'), { number: 1, kind: 'polish' });
  assert.deepEqual(parseChapterFile('project-51-step-1-write-chapter-12.md'), { number: 12, kind: 'write' });
  assert.equal(parseChapterFile('project-51-step-65-compile-manuscript.md'), null);
});

test('REGRESSION: a 24-chapter deterministic project assembles to 24 chapters, not 0', () => {
  const files = project84Steps(24).map((s) => ({
    name: stepFileName(s),
    content: `## Chapter ${s.chapterNumber}: Title\n\n${s.label} body.`,
    mtime: Number(s.id.replace(/\D/g, '')),
  }));
  const r = assembleManuscript(files, { title: 'Three Months of Summer', author: 'Gia' });
  assert.equal(r.chapterCount, 24);
  assert.ok(r.wordCount > 0);
  // the de-AI sweep is the latest prose pass, so it — not the first draft — is what ships
  assert.ok(r.markdown.includes('Humanize — De-AI Sweep — Chapter 24 body.'));
  assert.ok(!r.markdown.includes('First Draft — Chapter 24 body.'));
  assert.ok(!r.markdown.includes('Scene Brief'), 'non-prose steps are never assembled');
  assert.ok(!r.markdown.includes('Consistency Audit'), 'JSON audit reports are never assembled');
});

// ------------------------------------------------------------ gatherChapters
test('gatherChapters returns ONE prose entry per chapter, not seven and not two', async () => {
  const gatherChapters = makeGatherChapters('/nonexistent-base', () => null);
  const chapters = await gatherChapters({ id: 'project-84', title: 'Three Months of Summer', steps: project84Steps(4) });
  assert.equal(chapters.length, 4);
  assert.deepEqual(chapters.map((c) => c.number), [1, 2, 3, 4]);
  for (const c of chapters) {
    assert.match(c.text, /^Humanize — De-AI Sweep body/, `chapter ${c.number} must be the latest prose version`);
  }
});

test('gatherChapters still handles a write/polish project', async () => {
  const steps = [
    { id: 's1', label: 'Write Chapter 1', status: 'completed', chapterNumber: 1, phase: 'writing', result: 'draft one. '.repeat(30) },
    { id: 's2', label: 'Polish Chapter 1', status: 'completed', chapterNumber: 1, phase: 'writing', result: 'polished one. '.repeat(30) },
    { id: 's3', label: 'Write Chapter 2', status: 'completed', chapterNumber: 2, phase: 'writing', result: 'draft two. '.repeat(30) },
  ];
  const gatherChapters = makeGatherChapters('/nonexistent-base', () => null);
  const chapters = await gatherChapters({ id: 'p', title: 'Book', steps });
  assert.equal(chapters.length, 2);
  assert.match(chapters[0].text, /^polished one/);
  assert.match(chapters[1].text, /^draft two/);
});

// -------------------------------------------- shipped pipelines (real labels)
// Every label below is copied verbatim from library/pipelines/*.json. A prose
// label the table doesn't know makes its chapter vanish from assembly, export
// and the reading surface, so each pipeline family gets its own assertion that
// the FINAL pass is what latestProseStep returns.

/** One chapter's steps from a pipeline's real `{{n}}` labels, in pipeline order. */
function pipelineChapter(labels: string[], ch: number, statuses: string[] = []): any[] {
  return labels.map((label, i) => ({
    id: `p-step-${i + 1}`,
    label: label.replace('{{n}}', String(ch)),
    status: statuses[i] ?? 'completed',
    chapterNumber: ch,
    result: `${label} body. `.repeat(20),
  }));
}

test('romance-*-full: Intimacy is the final prose pass, outranking Humanize', () => {
  const labels = [
    'Scene Brief — Chapter {{n}}', 'First Draft — Chapter {{n}}', 'Improvement Plan — Chapter {{n}}',
    'Rewrite — Chapter {{n}}', 'Humanize — Chapter {{n}}', 'Intimacy — Chapter {{n}}',
  ];
  assert.equal(classifyRole('Intimacy — Chapter 6'), 'intimacy');
  const step = latestProseStep(pipelineChapter(labels, 6), 6);
  assert.equal(step?.label, 'Intimacy — Chapter 6');
  assert.deepEqual(
    chapterVersions(pipelineChapter(labels, 6), 6).map((v) => v.isProse),
    [false, true, false, true, true, true],
  );
});

test('humanize-claude / humanize-gemini: the numbered passes are prose, pass 10 is latest', () => {
  const labels = [
    'Pass 1: Grammar Foundation — Chapter {{n}}', 'Pass 2: AI-Word Cleaning — Chapter {{n}}',
    'Pass 3: Overwritten-Language Reduction — Chapter {{n}}', 'Pass 4: Sensory Enhancement — Chapter {{n}}',
    'Pass 5: Subtlety Creation — Chapter {{n}}', 'Pass 6: Dialogue Enhancement — Chapter {{n}}',
    'Pass 7: Weak-Language Cleanup — Chapter {{n}}', 'Pass 8: Strategic Imperfections — Chapter {{n}}',
    'Pass 8.5: Structural-Construction Elimination — Chapter {{n}}',
    'Pass 9: Final Pattern Verification — Chapter {{n}}', 'Pass 10: Final AI-Word Sweep — Chapter {{n}}',
  ];
  const steps = pipelineChapter(labels, 2);
  assert.ok(chapterVersions(steps, 2).every((v) => v.isProse), 'every de-AI pass rewrites the chapter');
  assert.equal(latestProseStep(steps, 2)?.label, 'Pass 10: Final AI-Word Sweep — Chapter 2');
  // The Gemini variant spells the same passes without hyphens.
  assert.equal(classifyRole('Pass 2: AI Word Cleaning — Chapter 2'), classifyRole('Pass 2: AI-Word Cleaning — Chapter 2'));
  // …and the same labels must classify from the on-disk file name, whose slug
  // carries the step-id prefix (this is what the file-based assembler reads).
  assert.deepEqual(
    classifyChapterFile('project-90-step-24-pass-10-final-ai-word-sweep-chapter-2.md'),
    { number: 2, role: 'humanize-pass' },
  );
  assert.deepEqual(
    classifyChapterFile('project-91-step-3-apply-line-edits-chapter-7.md'),
    { number: 7, role: 'apply-edits' },
  );
  assert.deepEqual(classifyChapterFile('project-92-step-6-intimacy-chapter-4.md'), { number: 4, role: 'intimacy' });
  assert.deepEqual(classifyChapterFile('project-93-step-2-draft-scene-chapter-1.md'), { number: 1, role: 'first-draft' });
  // A critique sibling is still not the chapter, from disk either.
  assert.equal(classifyChapterFile('project-91-step-2-line-edit-critique-chapter-7.md'), null);
  assert.equal(classifyChapterFile('project-91-step-2-copyedit-pass-chapter-7.md'), null);
});

test('editorial-*: the Apply pass is prose, its critique/audit sibling is not', () => {
  const families: Array<[string, string]> = [
    ['Copyedit Pass — Chapter {{n}}', 'Apply Copyedits — Chapter {{n}}'],
    ['Line-Edit Critique — Chapter {{n}}', 'Apply Line Edits — Chapter {{n}}'],
    ['Developmental Critique — Chapter {{n}}', 'Apply Developmental Edits — Chapter {{n}}'],
    ['Proofread Pass — Chapter {{n}}', 'Apply Proofreading Fixes — Chapter {{n}}'],
    ['Alpha-Feedback Analysis — Chapter {{n}}', 'Apply Alpha-Read Revisions — Chapter {{n}}'],
    ['Fingerprint Audit — Chapter {{n}}', 'Apply Fingerprint Fixes — Chapter {{n}}'],
  ];
  for (const family of families) {
    const steps = pipelineChapter(family, 4);
    const versions = chapterVersions(steps, 4);
    assert.deepEqual(versions.map((v) => v.isProse), [false, true], `${family[0]} is a report, ${family[1]} is the chapter`);
    assert.equal(latestProseStep(steps, 4)?.label, family[1].replace('{{n}}', '4'));
  }
  // "Consistency Apply" keeps its own role rather than collapsing into the
  // editorial Apply bucket.
  assert.equal(classifyRole('Consistency Apply — Chapter 4'), 'consistency-apply');
});

test('scene-drafter: Draft Scene is the chapter, the brief before it is not', () => {
  const steps = pipelineChapter(['Scene Brief — Chapter {{n}}', 'Draft Scene — Chapter {{n}}'], 3);
  assert.equal(classifyRole('Draft Scene — Chapter 3'), 'first-draft');
  assert.deepEqual(chapterVersions(steps, 3).map((v) => v.isProse), [false, true]);
  assert.equal(latestProseStep(steps, 3)?.label, 'Draft Scene — Chapter 3');
});

// ---------------------------------------------------------- chapterTextSteps
test('chapterTextSteps returns the resolved prose step, one per chapter', () => {
  const resolved = chapterTextSteps(project84Steps(3));
  assert.deepEqual(resolved.map((c) => c.number), [1, 2, 3]);
  for (const { number, step } of resolved) {
    assert.equal(step.label, `Humanize — De-AI Sweep — Chapter ${number}`);
  }
});

test('chapterTextSteps still yields a chapter when NO label is a recognised prose role', () => {
  // An unknown future pipeline: nothing in the role table matches, so a
  // prose-role-only filter would export an empty book.
  const steps = [1, 2].flatMap((ch) => [
    { id: `x-${ch}-1`, label: `Dream Up Chapter ${ch}`, status: 'completed', chapterNumber: ch, result: 'notes. '.repeat(60) },
    { id: `x-${ch}-2`, label: `Spin Chapter ${ch}`, status: 'completed', chapterNumber: ch, result: `spun chapter ${ch}. `.repeat(60) },
  ]);
  const resolved = chapterTextSteps(steps);
  assert.deepEqual(resolved.map((c) => c.number), [1, 2]);
  assert.deepEqual(resolved.map((c) => c.step.id), ['x-1-2', 'x-2-2'], 'the last completed step with substantial text');
});

test('chapterTextSteps ignores an unrecognised step with no substantial text', () => {
  const steps = [
    { id: 'y-1', label: 'Ponder Chapter 1', status: 'completed', chapterNumber: 1, result: 'ok' },
    { id: 'y-2', label: 'Ponder Chapter 2', status: 'pending', chapterNumber: 2, result: 'long. '.repeat(60) },
  ];
  assert.deepEqual(chapterTextSteps(steps), []);
});

test('chapterTextSteps never returns a gated, un-approved step (compile ships approved text)', () => {
  // A cadence gate fires BEFORE completeStep, so the gated step is still active
  // and its text lives only on project.review.pendingResult.
  const statuses = ['completed', 'completed', 'completed', 'completed', 'completed', 'completed', 'active'];
  const steps = chapterSteps(7, statuses);
  const resolved = chapterTextSteps(steps);
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].step.label, 'Consistency Apply — Chapter 7', 'the last APPROVED prose pass');
});

// ------------------------------------------- POST /api/books/:slug/compile --
// Compile used to readdir the WHOLE book data dir and rank the files by name +
// mtime. Two projects bound to one book is a supported state, so a sibling
// project's chapters leaked into the compiled book; and because a step's .md is
// written BEFORE its human-review gate opens, the newest file could be text the
// human has not approved. It now resolves chapters through the same step-based
// path View Book uses: the frontier project's steps, completed passes only.

/** Boot the books routes over a temp data dir holding `files`, then POST compile. */
async function compileBook(project: any, files: Array<{ name: string; content: string }>) {
  const { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } = await import('fs');
  const { join } = await import('path');
  const { tmpdir } = await import('os');
  const express = (await import('express')).default;
  const { mountBooks } = await import('../../gateway/src/api/routes/books.routes.js');

  const dir = mkdtempSync(join(tmpdir(), 'bookclaw-compile-'));
  for (const f of files) writeFileSync(join(dir, f.name), f.content, 'utf-8');

  const services: any = {
    books: {
      exists: () => true,
      dataDirOf: () => dir,
      open: async () => ({ manifest: { title: 'Three Months of Summer', format: { chapterCount: 2 } } }),
      listFiles: () => readdirSync(dir).map((name) => ({ name })),
    },
    confirmationGate: { get: () => null },
  };
  const gateway: any = {
    getServices: () => services,
    getProjectEngine: () => ({ frontierProjectForBook: () => project, isDriving: () => false }),
  };
  const app = express();
  mountBooks(app as any, gateway, dir);
  const server = app.listen(0);
  await new Promise<void>((r) => server.once('listening', () => r()));
  const port = (server.address() as any).port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/books/summer/compile`, { method: 'POST' });
    const body = await res.json();
    return { status: res.status, body, markdown: readFileSync(join(dir, 'compiled-manuscript.md'), 'utf-8') };
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    rmSync(dir, { recursive: true, force: true });
  }
}

test('compile ships the frontier project\'s APPROVED chapters, not a sibling\'s and not gated text', async () => {
  // Chapter 1 finished; chapter 2 is paused at a gate on its de-AI sweep, which
  // is still `active` — its file is already on disk, holding un-approved text.
  const steps = [
    ...chapterSteps(1),
    ...chapterSteps(2, ['completed', 'completed', 'completed', 'completed', 'completed', 'completed', 'active']),
  ];
  const gated = steps.at(-1)!;
  gated.result = '';
  const project = {
    id: 'project-84', title: 'Three Months of Summer', bookSlug: 'summer', steps,
    review: { confirmationId: 'conf-5', stepId: gated.id, kind: 'cadence-gate', pendingResult: 'UNAPPROVED pending text.' },
  };

  const files = steps.map((s) => ({
    name: stepFileName(s),
    content: `# ${s.label}\n\n## Chapter ${s.chapterNumber}\n\n${s.id === gated.id ? 'UNAPPROVED pending text.' : `${s.label} body.`}`,
  }));
  // A SECOND project bound to the same book, writing into the same data dir.
  files.push({
    name: 'project-99-step-4-humanize-de-ai-sweep-chapter-3.md',
    content: '# Humanize — De-AI Sweep — Chapter 3\n\n## Chapter 3\n\nSIBLING PROJECT body.',
  });

  const { status, body, markdown } = await compileBook(project, files);
  assert.equal(status, 200);
  assert.equal(body.chapters, 2, 'only the frontier project\'s two chapters');
  assert.ok(markdown.includes('Humanize — De-AI Sweep — Chapter 1 body.'), 'chapter 1 ships its latest prose pass');
  assert.ok(markdown.includes('Consistency Apply — Chapter 2 body.'), 'chapter 2 ships the last APPROVED pass');
  assert.ok(!markdown.includes('UNAPPROVED'), 'the gated pass is not compiled until it is approved');
  assert.ok(!markdown.includes('SIBLING PROJECT'), 'a sibling project sharing the book dir never leaks in');
  assert.ok(!markdown.includes('Scene Brief'), 'non-prose steps are never compiled');
});

test('gatherChapters still exports a chapter when NO label is a recognised prose role', async () => {
  // Narrowing to recognised prose roles emptied EPUB/DOCX export, the
  // beta-reader gate and lesson extraction for any pipeline whose labels the
  // role table doesn't know. Recognising the shipped labels shrinks that set;
  // it must not be the only defence.
  const steps = [1, 2, 3].flatMap((ch) => [
    { id: `u-${ch}-1`, label: `Weave Chapter ${ch}`, status: 'completed', chapterNumber: ch, result: `woven ${ch}. `.repeat(60) },
    { id: `u-${ch}-2`, label: `Burnish Chapter ${ch}`, status: 'completed', chapterNumber: ch, result: `burnished ${ch}. `.repeat(60) },
  ]);
  const gatherChapters = makeGatherChapters('/nonexistent-base', () => null);
  const chapters = await gatherChapters({ id: 'p', title: 'Book', steps });
  assert.deepEqual(chapters.map((c) => c.number), [1, 2, 3]);
  for (const c of chapters) assert.match(c.text, /^burnished/, 'the chapter is its last completed pass');
});
