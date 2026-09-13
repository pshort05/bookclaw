/**
 * The book contents tree (View Book §2/§3).
 *
 * One shape for everything a book contains — cover, chapters, back matter,
 * reference documents, launch copy — grouped into the five fixed groups the
 * reading surface renders, plus the `run` state derived from the project bound
 * to the book. Items are **item-addressed** (`chapter:19`, `ref:compiled`), not
 * step-addressed, so the client never carries pipeline internals.
 *
 * PURE: no fs, no services, no Express. The route does the I/O and hands the
 * data in (manifest, project-or-null, the data dir listing, compiled-file info),
 * which is also what makes the whole tree unit-testable from fixtures.
 */

import { chapterVersions, classifyRole, isProseRole, latestProseStep, stepChapterNumber } from './pipeline/chapter-files.js';
import { countWords } from '../util/wordcount.js';

export type GroupId = 'front' | 'manuscript' | 'back' | 'reference' | 'launch';
export type ItemKind = 'prose' | 'document' | 'cover';

export interface ItemFlag { level: 'bad' | 'warn' | 'note'; label: string }

export interface ItemVersion {
  id: string;
  label: string;
  step?: string;
  createdAt?: string;
  latest: boolean;
  /** On-disk file for this version, relative to the book's data dir. */
  file?: string;
}

export interface BookViewItem {
  id: string;
  group: GroupId;
  title: string;
  kind: ItemKind;
  ready: boolean;
  derived?: boolean;
  words?: number;
  flags?: ItemFlag[];
  producedBy?: { skill: string; pipeline: string };
  versions: ItemVersion[];   // newest LAST; [] when !ready
}

export interface BookViewGroup { id: GroupId; label: string; state: string; items: BookViewItem[] }

export interface RunState {
  projectId?: string;
  status: 'none' | 'writing' | 'paused' | 'gated' | 'complete';
  frontier: number;
  total: number;
  gate?: { confirmationId: string; stepId: string; itemId: string; findings: unknown; expiresAt: string };
}

export interface BuildInput {
  /** The book's manifest (only the fields this module reads). */
  manifest: { title?: string; pipeline?: string; format?: { chapterCount?: number } | null } | null;
  /** The project carrying the run's state — the gated project if any, else the
   *  frontier — or null. `steps` is the WHOLE chain's steps concatenated in
   *  chain order (`chainProjectsForBook`), not just this project's: a book past
   *  its writing phase keeps its chapters in the production project and its
   *  bible/outline in planning, so resolving from the frontier alone showed no
   *  chapters and no reference documents. Chain order also settles a chapter two
   *  phases both wrote — every resolver here takes the LAST matching step, so
   *  the later phase wins. */
  project: {
    id: string;
    steps: any[];
    /** `pendingResult` is the gated step's text: it is generated BEFORE the step
     *  completes, so it lives here and not on `step.result`. */
    review?: { confirmationId: string; stepId: string; pendingResult?: string } | null;
  } | null;
  /** The book's data dir listing — used to spot a step whose file is gone, and
   *  to surface files no step claims at all (see `discoverFiles`). */
  files: Array<{ name: string; modified?: string }>;
  /** The compiled manuscript, when one has been written. `versions` are PRIOR
   *  compiles (newest first, as `listVersions` returns them). */
  compiled?: { file: string; words?: number; createdAt?: string; versions?: Array<{ id: string; createdAt?: string }> } | null;
  /** The gate's confirmation request, for findings + expiry. */
  gate?: { findings?: unknown; expiresAt?: string } | null;
  /** True while the engine holds the drive lock on the project. */
  projectIsDriving?: boolean;
}

export interface ResolvedItem {
  item: BookViewItem;
  /** The latest version's file, relative to the data dir; null when unwritten. */
  file: string | null;
  /** The latest version's step id; absent for items no project step produced. */
  stepId?: string;
  versions: ItemVersion[];
}

/** Item ids are `<group-ish>:<name>` — no separators, so no id can name a path. */
const ITEM_ID_RE = /^[a-z]+:[A-Za-z0-9][A-Za-z0-9._-]*$/;

const GROUP_LABELS: Record<GroupId, string> = {
  front: 'Front matter',
  manuscript: 'Manuscript',
  back: 'Back matter',
  reference: 'Reference',
  launch: 'Launch',
};

const slugify = (s: string): string => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-');

/** The on-disk name of a step's output (see ProjectEngine.persistStepResultFile). */
export function stepFileName(step: { id: string; label: string }): string {
  return `${step.id}-${slugify(step.label)}.md`;
}

/** Prose word count — heading lines excluded, so a chapter's count is its story. */
export function proseWords(text: string): number {
  return countWords(String(text ?? '').split('\n').filter((l) => !/^\s*#/.test(l)).join(' ').trim());
}

/**
 * The fixed item catalog (design §2's producer table). `match` classifies a
 * project's non-chapter step onto an item by its slugified label; an item with
 * no matching step renders as a ghost row naming its skill + pipeline.
 * Predicates rather than bare regexes so the few ambiguous labels ("back cover
 * blurb" vs "cover", "cover concepts" vs "cover") stay readable.
 */
interface CatalogEntry {
  id: string;
  group: GroupId;
  title: string;
  kind: ItemKind;
  skill: string;
  pipeline: string;
  optional?: boolean;
  match: (slug: string) => boolean;
}

const CATALOG: CatalogEntry[] = [
  // ── front ────────────────────────────────────────────────────────────────
  { id: 'front:cover', group: 'front', title: 'Cover', kind: 'cover', skill: 'cover-designer', pipeline: 'book-launch',
    match: (s) => /(^|-)cover(-|$)/.test(s) && !/blurb|concept/.test(s) },
  { id: 'front:title', group: 'front', title: 'Title page', kind: 'prose', skill: 'format', pipeline: 'format-export',
    match: (s) => /title-page/.test(s) },
  { id: 'front:copyright', group: 'front', title: 'Copyright page', kind: 'prose', skill: 'format', pipeline: 'format-export',
    match: (s) => /copyright/.test(s) },
  { id: 'front:dedication', group: 'front', title: 'Dedication', kind: 'prose', skill: 'format', pipeline: 'format-export', optional: true,
    match: (s) => /dedication/.test(s) },
  { id: 'front:also-by', group: 'front', title: 'Also by this author', kind: 'prose', skill: 'format', pipeline: 'format-export', optional: true,
    match: (s) => /also-by/.test(s) && /front/.test(s) },

  // ── back ─────────────────────────────────────────────────────────────────
  { id: 'back:acknowledgements', group: 'back', title: 'Acknowledgements', kind: 'prose', skill: 'format', pipeline: 'format-export',
    match: (s) => /acknowledg/.test(s) },
  { id: 'back:about-the-author', group: 'back', title: 'About the author', kind: 'prose', skill: 'format', pipeline: 'format-export',
    match: (s) => /about-the-author/.test(s) },
  { id: 'back:newsletter', group: 'back', title: 'Newsletter call-to-action', kind: 'prose', skill: 'blurb-writer', pipeline: 'format-export',
    match: (s) => /newsletter/.test(s) },
  { id: 'back:also-by', group: 'back', title: 'Also-by list', kind: 'prose', skill: 'format', pipeline: 'format-export', optional: true,
    match: (s) => /also-by/.test(s) && !/front/.test(s) },

  // ── launch ───────────────────────────────────────────────────────────────
  { id: 'launch:blurb', group: 'launch', title: 'Back cover blurb', kind: 'document', skill: 'blurb-writer', pipeline: 'book-launch',
    match: (s) => /(^|-)blurb(-|$)/.test(s) && !/amazon/.test(s) },
  { id: 'launch:amazon-description', group: 'launch', title: 'Amazon book description', kind: 'document', skill: 'blurb-writer', pipeline: 'book-launch',
    match: (s) => /(amazon.*description|book-description)/.test(s) },
  { id: 'launch:categories', group: 'launch', title: 'Amazon categories & keywords', kind: 'document', skill: 'research', pipeline: 'book-launch',
    match: (s) => /categor|keyword/.test(s) },
  { id: 'launch:ad-copy', group: 'launch', title: 'Ad copy', kind: 'document', skill: 'ad-copy', pipeline: 'book-launch',
    match: (s) => /ad-copy/.test(s) },
  { id: 'launch:social', group: 'launch', title: 'Social launch posts', kind: 'document', skill: 'blurb-writer', pipeline: 'book-launch',
    match: (s) => /social/.test(s) },
  { id: 'launch:checklist', group: 'launch', title: 'Launch checklist & timeline', kind: 'document', skill: 'format', pipeline: 'book-launch',
    match: (s) => /checklist/.test(s) },
  { id: 'launch:cover-concepts', group: 'launch', title: 'Book cover concepts', kind: 'document', skill: 'cover-designer', pipeline: 'book-launch',
    match: (s) => /cover-concept/.test(s) },
];

/** Chapters are produced by the book's own pipeline rather than the catalog. */
const chapterProducer = (input: BuildInput) => ({
  skill: 'write',
  pipeline: input.manifest?.pipeline || 'novel-pipeline',
});

/** Continuity findings attached to a chapter's steps, as row chips. */
function continuityChips(steps: any[]): ItemFlag[] {
  const flags: ItemFlag[] = [];
  for (const step of steps) {
    for (const f of (step?.continuityFlags ?? [])) {
      flags.push({ level: f?.kind === 'contradiction' ? 'bad' : 'warn', label: String(f?.detail ?? f?.kind ?? '').slice(0, 120) });
    }
  }
  return flags;
}

/**
 * The step a human-review gate is holding, when it is one chapter's prose pass.
 * Contents-level knowledge: `latestProseStep` stays strict (completed-only), and
 * the gated step is promoted to "current version" only here, where the review
 * state is known.
 */
function gatedProseStep(input: BuildInput): any | null {
  const stepId = input.project?.review?.stepId;
  if (!stepId) return null;
  const step = (input.project?.steps ?? []).find((s) => s.id === stepId);
  if (!step || stepChapterNumber(step) === null) return null;
  return isProseRole(classifyRole(step.label)) ? step : null;
}

/** The chapter count the book declares, falling back to what the steps show. */
function chapterCountOf(input: BuildInput): number {
  const declared = Number(input.manifest?.format?.chapterCount);
  if (Number.isFinite(declared) && declared > 0) return Math.floor(declared);
  const numbers = (input.project?.steps ?? []).map(stepChapterNumber).filter((n): n is number => n !== null);
  return numbers.length ? Math.max(...numbers) : 0;
}

/** Short human text for a group header. */
function groupState(id: GroupId, items: BookViewItem[], total: number): string {
  const ready = items.filter((i) => i.ready).length;
  if (id === 'reference') return ready === 0 ? 'not generated' : `${ready} document${ready === 1 ? '' : 's'}`;
  if (id === 'manuscript') return total === 0 ? 'not generated' : `${ready} of ${total} written`;
  if (ready === 0) return 'not generated';
  return `${ready} of ${items.length} written`;
}

/** Build one catalog/reference item backed by a single project step. */
function itemFromStep(
  entry: Pick<CatalogEntry, 'id' | 'group' | 'title' | 'kind'> & { optional?: boolean },
  step: any,
  onDisk: Set<string>,
): BookViewItem {
  const file = stepFileName(step);
  const flags: ItemFlag[] = [];
  if (entry.optional) flags.push({ level: 'note', label: 'optional' });
  if (!onDisk.has(file)) flags.push({ level: 'warn', label: 'missing file' });
  const ready = step.status === 'completed';
  return {
    id: entry.id,
    group: entry.group,
    title: entry.title,
    kind: entry.kind,
    ready,
    ...(ready && entry.kind === 'prose' ? { words: proseWords(step.result ?? '') } : {}),
    ...(flags.length ? { flags } : {}),
    versions: ready
      ? [{ id: step.id, label: step.label, step: step.id, createdAt: step.completedAt ?? step.createdAt, latest: true, file }]
      : [],
  };
}

/** `manuscript.md` → "Manuscript"; `beta_read-notes.md` → "Beta Read Notes". */
function humaniseFileName(name: string): string {
  return name.replace(/\.md$/i, '').replace(/[-_.]+/g, ' ').trim().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/**
 * Markdown in the data dir that no item already surfaces, as Reference documents.
 *
 * Older/imported books predate per-book project binding: no project is bound at
 * all, and the data dir holds a whole-book `manuscript.md` rather than
 * per-chapter step files. A step-only tree rendered those books COMPLETELY
 * EMPTY — 14 of 21 on the production box (2026-09-12) — against the design's own
 * rule that "contents still lists whatever files exist. A book can be read
 * without a run." These items are authored content, so they stay editable; with
 * no owning step they save through the plain `file` path.
 */
function discoverFiles(input: BuildInput, claimedFiles: Set<string>, takenIds: Set<string>): BookViewItem[] {
  const out: BookViewItem[] = [];
  for (const f of input.files ?? []) {
    const name = String(f?.name ?? '');
    if (!name || name.startsWith('.') || !/\.md$/i.test(name)) continue;
    if (claimedFiles.has(name) || name === input.compiled?.file) continue;
    const base = `ref:${slugify(name.replace(/\.md$/i, ''))}`.replace(/-+$/, '');
    if (!ITEM_ID_RE.test(base)) continue;              // a name that slugifies to nothing
    let id = base;
    for (let n = 2; takenIds.has(id); n++) id = `${base}-${n}`;
    takenIds.add(id);
    out.push({
      id, group: 'reference', title: humaniseFileName(name), kind: 'document', ready: true,
      versions: [{ id: `file:${name}`, label: 'Current', createdAt: f.modified, latest: true, file: name }],
    });
  }
  return out;
}

/** A ghost row: nothing written yet, so it names what would write it. */
function ghostItem(entry: CatalogEntry): BookViewItem {
  const flags: ItemFlag[] = entry.optional ? [{ level: 'note', label: 'optional' }] : [];
  return {
    id: entry.id,
    group: entry.group,
    title: entry.title,
    kind: entry.kind,
    ready: false,
    ...(flags.length ? { flags } : {}),
    producedBy: { skill: entry.skill, pipeline: entry.pipeline },
    versions: [],
  };
}

export function buildContents(input: BuildInput): { groups: BookViewGroup[]; run: RunState } {
  const steps: any[] = input.project?.steps ?? [];
  const onDisk = new Set((input.files ?? []).map((f) => f.name));
  const total = chapterCountOf(input);

  // Every step that is not a chapter step is a candidate for a catalog item or,
  // failing that, a Reference document.
  const nonChapterSteps = steps.filter((s) => stepChapterNumber(s) === null);
  const claimed = new Set<string>();

  // ── front / back / launch: the fixed catalog ──────────────────────────────
  const catalogItems = CATALOG.map((entry) => {
    const step = nonChapterSteps.find((s) => !claimed.has(s.id) && entry.match(slugify(s.label)));
    if (!step) return ghostItem(entry);
    claimed.add(step.id);
    const item = itemFromStep(entry, step, onDisk);
    if (!item.ready) item.producedBy = { skill: entry.skill, pipeline: entry.pipeline };
    return item;
  });

  // ── manuscript: one row per declared chapter ──────────────────────────────
  const producer = chapterProducer(input);
  const gatedStep = gatedProseStep(input);
  const manuscript: BookViewItem[] = [];
  for (let n = 1; n <= total; n++) {
    // A cadence gate fires BEFORE the engine completes the step, so the gated
    // step is still `active` and `latestProseStep` (completed-only, by design)
    // returns the PREVIOUS pass. The pass under review is what the human is
    // reading and editing, so it is this chapter's current version — without
    // this the reading pane shows pre-gate text and the editor's save lands on
    // the previous pass's file, to be destroyed when the gate resumes.
    const latest = (stepChapterNumber(gatedStep) === n ? gatedStep : null) ?? latestProseStep(steps, n);
    const mine = steps.filter((s) => stepChapterNumber(s) === n);
    if (!latest) {
      manuscript.push({
        id: `chapter:${n}`, group: 'manuscript', title: `Chapter ${n}`, kind: 'prose',
        ready: false, producedBy: producer, versions: [],
      });
      continue;
    }
    const file = stepFileName(latest);
    const flags = continuityChips(mine);
    if (!onDisk.has(file)) flags.push({ level: 'warn', label: 'missing file' });
    const text = latest === gatedStep ? (input.project?.review?.pendingResult ?? latest.result) : latest.result;
    manuscript.push({
      id: `chapter:${n}`, group: 'manuscript', title: `Chapter ${n}`, kind: 'prose',
      ready: true,
      words: proseWords(text ?? ''),
      ...(flags.length ? { flags } : {}),
      versions: chapterVersions(steps, n).map((v) => ({
        id: v.id, label: v.label, step: v.id, createdAt: v.createdAt, latest: v.id === latest.id,
        file: stepFileName({ id: v.id, label: v.label }),
      })),
    });
  }

  // ── reference: the compiled book first, then discovered documents ─────────
  const reference: BookViewItem[] = [];
  if (input.compiled?.file) {
    const priors = [...(input.compiled.versions ?? [])].reverse();   // listVersions is newest-first
    reference.push({
      id: 'ref:compiled', group: 'reference', title: 'Compiled book', kind: 'document',
      ready: true, derived: true,
      ...(input.compiled.words !== undefined ? { words: input.compiled.words } : {}),
      flags: [{ level: 'note', label: 'derived' }],
      versions: [
        ...priors.map((v) => ({
          id: v.id, label: 'Earlier compile', createdAt: v.createdAt, latest: false,
          file: `.versions/${input.compiled!.file}/${v.id}.md`,
        })),
        { id: 'current', label: 'Compiled', createdAt: input.compiled.createdAt, latest: true, file: input.compiled.file },
      ],
    });
  }
  const seenRefIds = new Set<string>();
  for (const step of nonChapterSteps) {
    if (claimed.has(step.id)) continue;
    let id = `ref:${slugify(step.label)}`.replace(/-+$/, '');
    if (!ITEM_ID_RE.test(id)) continue;                 // a label that slugifies to nothing
    for (let n = 2; seenRefIds.has(id); n++) id = `ref:${slugify(step.label)}-${n}`;
    seenRefIds.add(id);
    const item = itemFromStep({ id, group: 'reference', title: step.label, kind: 'document' }, step, onDisk);
    if (!item.ready) item.producedBy = { skill: step.skill || 'write', pipeline: input.manifest?.pipeline || 'novel-pipeline' };
    reference.push(item);
  }

  // …then whatever else is on disk. `manuscript.md` is the whole book on the
  // older shape, so it leads Reference, ahead of the compiled row and the
  // documents the steps produced.
  const claimedFiles = new Set(
    [...catalogItems, ...manuscript, ...reference]
      .flatMap((i) => i.versions.map((v) => v.file))
      .filter((f): f is string => !!f),
  );
  const discovered = discoverFiles(input, claimedFiles, new Set(reference.map((i) => i.id)));
  const isWholeManuscript = (i: BookViewItem) => i.versions[0]?.file?.toLowerCase() === 'manuscript.md';
  reference.unshift(...discovered.filter(isWholeManuscript));
  reference.push(...discovered.filter((i) => !isWholeManuscript(i)));

  const byGroup = (id: GroupId) => catalogItems.filter((i) => i.group === id);
  const groups: BookViewGroup[] = [
    { id: 'front', label: GROUP_LABELS.front, state: '', items: byGroup('front') },
    { id: 'manuscript', label: GROUP_LABELS.manuscript, state: '', items: manuscript },
    { id: 'back', label: GROUP_LABELS.back, state: '', items: byGroup('back') },
    { id: 'reference', label: GROUP_LABELS.reference, state: '', items: reference },
    { id: 'launch', label: GROUP_LABELS.launch, state: '', items: byGroup('launch') },
  ];
  for (const g of groups) g.state = groupState(g.id, g.items, total);

  // ── run ───────────────────────────────────────────────────────────────────
  const run = buildRun(input, groups, total);

  // The gated row carries a chip beside its consistency chips (design §6).
  if (run.gate?.itemId) {
    const gated = groups.flatMap((g) => g.items).find((i) => i.id === run.gate!.itemId);
    if (gated) gated.flags = [...(gated.flags ?? []), { level: 'note', label: 'gate' }];
  }

  return { groups, run };
}

function buildRun(input: BuildInput, groups: BookViewGroup[], total: number): RunState {
  const project = input.project;
  if (!project) return { status: 'none', frontier: 0, total };

  const steps: any[] = project.steps ?? [];
  let frontier = 0;
  for (let n = 1; n <= total; n++) if (latestProseStep(steps, n)) frontier = n;

  const allDone = steps.length > 0 && steps.every((s) => s.status === 'completed' || s.status === 'skipped');
  const status: RunState['status'] = project.review ? 'gated'
    : input.projectIsDriving ? 'writing'
    : allDone ? 'complete'
    : 'paused';

  const run: RunState = { projectId: project.id, status, frontier, total };

  if (project.review) {
    const stepId = project.review.stepId;
    const owner = groups.flatMap((g) => g.items).find((i) => i.versions.some((v) => v.id === stepId));
    run.gate = {
      confirmationId: project.review.confirmationId ?? '',
      stepId,
      itemId: owner?.id ?? '',
      findings: input.gate?.findings,
      expiresAt: input.gate?.expiresAt ?? '',
    };
  }
  return run;
}

/**
 * One item by id, with the files behind each of its versions. Returns null for
 * an unknown id and for anything that isn't a well-formed item id — the id can
 * therefore never name a path, before `safePath` gets a second say in the route.
 */
export function resolveItem(input: BuildInput, itemId: string): ResolvedItem | null {
  if (!ITEM_ID_RE.test(String(itemId ?? ''))) return null;
  const { groups } = buildContents(input);
  const item = groups.flatMap((g) => g.items).find((i) => i.id === itemId);
  if (!item) return null;
  const latest = item.versions.find((v) => v.latest) ?? item.versions.at(-1);
  return {
    item,
    file: latest?.file ?? null,
    ...(latest?.step ? { stepId: latest.step } : {}),
    versions: item.versions,
  };
}
