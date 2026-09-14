/**
 * "Change all" — apply a model pick to a step's ROLE across the whole book.
 *
 * Owner semantics (2026-09-14): changing chapter 7's First Draft applies to
 * EVERY First Draft, never to another role (a scene brief is never dragged onto
 * the draft's model). The load-bearing write is the ROLE-KEYED book slot
 * `manifest.roleModels`, which stepRouting resolves above a pipeline-baked
 * template modelOverride and below an explicit per-step pin — so chapters that
 * expand LATER inherit it, and a sibling role sharing the same taskType does not.
 *
 * Route: POST /api/books/:slug/models/role  (books.routes.ts — sibling of
 * POST /api/books/:slug/models, which keeps its own taskType stageModels).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'net';
import { LibraryService } from '../../gateway/src/services/library.js';
import { BookService } from '../../gateway/src/services/book.js';
import { ProjectEngine } from '../../gateway/src/services/projects.js';
import { expandSteps } from '../../gateway/src/services/pipeline-expand.js';
import { mountBooks } from '../../gateway/src/api/routes/books.routes.js';
import { applyBookModelConfig, stepRouting } from '../../gateway/src/api/routes/_shared.js';

const fakeSkills = { getSkillCatalog: () => [], getSkillByName: () => undefined } as never;

/** A model pick baked into a pipeline template and copied onto an expanded step. */
const TEMPLATE_PIN = { provider: 'openrouter', model: 'google/gemini-3-pro', temperature: 0.7, source: 'template' as const };

function write(base: string, rel: string, body: string): void {
  const p = join(base, rel);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, body, 'utf-8');
}

async function makeBookSvc(root: string): Promise<BookService> {
  const builtin = join(root, 'library');
  write(builtin, 'authors/default/SOUL.md', 'soul');
  write(builtin, 'voices/default/STYLE-GUIDE.md', 'voice');
  write(builtin, 'pipelines/novel-pipeline.json', JSON.stringify({ schemaVersion: 1, name: 'novel-pipeline', label: 'Novel', description: 'd', dynamic: true, steps: [] }));
  const lib = new LibraryService(builtin, join(root, 'workspace', 'library'), fakeSkills);
  await lib.loadAll();
  const svc = new BookService(join(root, 'workspace', 'books'), lib, '9.9.9');
  await svc.initialize();
  return svc;
}

/**
 * The book's real CHAIN (two phases of pipeline `pl-1`, phase 1 already
 * completed) plus a DUPLICATE chain `pl-2` from a second "start" click, plus a
 * project of another book. Deliberately shaped so the fixture can catch the
 * mistakes the endpoint must not make:
 *   - `rewrite` spans two taskTypes (revision + final_edit) — a taskType-keyed
 *     pin would silently miss one of them;
 *   - `improve` shares taskType `revision` with `rewrite` — a taskType-keyed pin
 *     would bleed onto it;
 *   - s5/s6 carry a TEMPLATE-baked override, the shape a later-expanded chapter
 *     step arrives with;
 *   - the completed phase (p1) and the abandoned chain (p3) must be handled
 *     differently from the live phase.
 */
function seedProjects(slug: string) {
  return [
    {
      id: 'project-1', bookSlug: slug, pipelineId: 'pl-1', pipelinePhase: 1, status: 'completed', updatedAt: '2020-01-01T00:00:00.000Z',
      steps: [
        { id: 's1', label: 'First Draft — Chapter 1', role: 'draft', taskType: 'creative_writing', status: 'completed' },
        { id: 's2', label: 'Scene Brief — Chapter 1', role: 'scene_brief', taskType: 'outline', status: 'completed', modelOverride: { provider: 'gemini' } },
      ],
    },
    {
      id: 'project-2', bookSlug: slug, pipelineId: 'pl-1', pipelinePhase: 2, status: 'active', updatedAt: '2020-01-01T00:00:00.000Z',
      steps: [
        { id: 's3', label: 'First Draft — Chapter 2', role: 'draft', taskType: 'creative_writing', status: 'pending', modelOverride: { provider: 'ollama', model: 'dolphin', temperature: 0.95 } },
        { id: 's4', label: 'Continuity — Chapter 2', role: 'continuity', taskType: 'consistency', status: 'pending' },
        { id: 's5', label: 'Improvement Plan — Chapter 2', role: 'improve', taskType: 'revision', status: 'pending', modelOverride: { ...TEMPLATE_PIN } },
        { id: 's6', label: 'Rewrite — Chapter 2', role: 'rewrite', taskType: 'revision', status: 'pending', modelOverride: { ...TEMPLATE_PIN } },
        { id: 's7', label: 'Humanize & Final Polish — Chapter 2', role: 'rewrite', taskType: 'final_edit', status: 'pending' },
      ],
    },
    {
      // Duplicate chain from a second "start" click — abandoned, never stamped.
      id: 'project-3', bookSlug: slug, pipelineId: 'pl-2', pipelinePhase: 1, status: 'active', updatedAt: '2020-01-01T00:00:00.000Z',
      steps: [{ id: 's8', label: 'First Draft — Chapter 1', role: 'draft', taskType: 'creative_writing', status: 'pending' }],
    },
    {
      id: 'project-9', bookSlug: 'some-other-book', pipelineId: 'pl-9', pipelinePhase: 1, status: 'active',
      steps: [{ id: 's9', label: 'First Draft — Chapter 1', role: 'draft', taskType: 'creative_writing', status: 'pending' }],
    },
  ] as any[];
}

async function harness(root: string) {
  const books = await makeBookSvc(root);
  const created = await books.create({ title: 'Role Models', author: 'default', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
  const slug = created.slug;
  const projects = seedProjects(slug);
  // The REAL engine: chainProjectsForBook / frontierProjectForBook / saveState
  // must behave exactly as they do in production (a hand-rolled "first
  // non-completed" stub hides the duplicate-chain case entirely).
  const engine = new ProjectEngine(undefined, root);
  const store = (engine as any).projects as Map<string, any>;
  for (const p of projects) store.set(p.id, p);
  const gateway: any = { getProjectEngine: () => engine, getServices: () => ({ books }) };
  const app = express();
  app.use(express.json());
  mountBooks(app as any, gateway, root);
  const server = app.listen(0);
  await new Promise<void>((r) => server.once('listening', () => r()));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (path: string, body: unknown) => fetch(`${url}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const project = (id: string) => projects.find((p) => p.id === id)!;
  const step = (id: string) => projects.flatMap((p) => p.steps).find((s: any) => s.id === id);
  const manifest = async () => (await books.open(slug))!.manifest as any;
  const stateFile = join(root, 'workspace', '.config', 'projects-state.json');
  return { books, slug, projects, post, project, step, manifest, server, stateFile };
}

test('a role applies across the book CHAIN — every step of that role, no other role, no abandoned chain', async () => {
  const root = mkdtempSync(join(tmpdir(), 'role-models-'));
  const h = await harness(root);
  try {
    const res = await h.post(`/api/books/${h.slug}/models/role`, { stepId: 's3', provider: 'openrouter', model: 'anthropic/claude-opus-4' });
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.role, 'draft');
    // s1 (completed phase) + s3 (live phase). NOT s8 — that chain was abandoned.
    assert.equal(body.appliedSteps, 2);
    assert.equal(body.touchedProjects, 2);

    for (const id of ['s1', 's3']) {
      assert.deepEqual(
        { provider: h.step(id)!.modelOverride?.provider, model: h.step(id)!.modelOverride?.model },
        { provider: 'openrouter', model: 'anthropic/claude-opus-4' },
        `step ${id} should carry the new pin`,
      );
    }
    assert.equal(h.step('s8')!.modelOverride, undefined, 'the abandoned duplicate chain must not be re-pinned');
    assert.equal(h.step('s9')!.modelOverride, undefined, 'a different book is never touched');
    assert.deepEqual(h.step('s2')!.modelOverride, { provider: 'gemini' }, 'another role keeps its own override');
    assert.equal(h.step('s4')!.modelOverride, undefined, 'a role with no override stays unpinned');
  } finally { h.server.close(); rmSync(root, { recursive: true, force: true }); }
});

test('a role spanning two taskTypes is applied to BOTH of its steps', async () => {
  const root = mkdtempSync(join(tmpdir(), 'role-models-'));
  const h = await harness(root);
  try {
    // `rewrite` rides taskType 'revision' (s6) and 'final_edit' (s7) — the shape
    // that made a taskType-majority tally silently skip the minority.
    const res = await h.post(`/api/books/${h.slug}/models/role`, { role: 'rewrite', provider: 'claude' });
    assert.equal((await res.json()).appliedSteps, 2);
    assert.equal(h.step('s6')!.modelOverride.provider, 'claude');
    assert.equal(h.step('s7')!.modelOverride.provider, 'claude');
    // The sibling role sharing taskType 'revision' keeps the template's pick.
    assert.deepEqual(h.step('s5')!.modelOverride, TEMPLATE_PIN);
  } finally { h.server.close(); rmSync(root, { recursive: true, force: true }); }
});

test('the book slot is role-keyed, so it never bleeds onto a sibling role with the same taskType', async () => {
  const root = mkdtempSync(join(tmpdir(), 'role-models-'));
  const h = await harness(root);
  try {
    const res = await h.post(`/api/books/${h.slug}/models/role`, { role: 'rewrite', provider: 'claude', model: 'auto:newest-opus' });
    assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
    const manifest = await h.manifest();
    assert.deepEqual(manifest.roleModels, { rewrite: { provider: 'claude', model: 'auto:newest-opus' } });
    assert.equal(manifest.stageModels, undefined, 'a taskType stage pin must NOT be written by this endpoint');

    // A chapter expanded LATER arrives carrying the template's baked override.
    const future: any = {};
    applyBookModelConfig(future, manifest);
    const rewrite = stepRouting(future, { role: 'rewrite', taskType: 'revision', modelOverride: { ...TEMPLATE_PIN } });
    assert.equal(rewrite.provider, 'claude');
    assert.equal(rewrite.model, 'auto:newest-opus');
    assert.equal(rewrite.temperature, 0.7, "the step's own pinned temperature is not disturbed by a model change");
    // The sibling role on the same taskType still routes to the template's pick.
    const improve = stepRouting(future, { role: 'improve', taskType: 'revision', modelOverride: { ...TEMPLATE_PIN } });
    assert.deepEqual({ provider: improve.provider, model: improve.model }, { provider: 'openrouter', model: 'google/gemini-3-pro' });
  } finally { h.server.close(); rmSync(root, { recursive: true, force: true }); }
});

test('a chapter expanded from a REAL pipeline template routes to the role pin, not the template model', async () => {
  const root = mkdtempSync(join(tmpdir(), 'role-models-'));
  const h = await harness(root);
  try {
    await h.post(`/api/books/${h.slug}/models/role`, { role: 'rewrite', provider: 'claude', model: 'auto:newest-opus' });
    const project: any = {};
    applyBookModelConfig(project, await h.manifest());

    // The real shipped pipeline + the real expander: `Rewrite — Chapter {{n}}`
    // bakes openrouter/google/gemini-3-pro into every expanded chapter step.
    const pipeline = JSON.parse(readFileSync(join(process.cwd(), 'library/pipelines/romantasy-production.json'), 'utf-8'));
    const steps = expandSteps(pipeline.steps, { chapterCount: 3 } as any);
    const rewrite = steps.find((s) => s.label === 'Rewrite — Chapter 1');
    assert.ok(rewrite, 'the pipeline must still expand a per-chapter Rewrite step');
    assert.equal(rewrite!.modelOverride?.model, 'google/gemini-3-pro', 'fixture check: the template still bakes a model');

    const r = stepRouting(project, { ...rewrite, role: 'rewrite' });
    assert.equal(r.provider, 'claude', 'the book role pin must beat the template-baked override');
    assert.equal(r.model, 'auto:newest-opus');

    // Unpinned roles in the same expansion still run on the template's pick.
    const humanize = steps.find((s) => s.label === 'Humanize & Final Polish — Chapter 1')!;
    const hr = stepRouting(project, { ...humanize, role: 'humanize' });
    assert.deepEqual({ provider: hr.provider, model: hr.model }, { provider: 'openrouter', model: 'google/gemini-3-pro' });
  } finally { h.server.close(); rmSync(root, { recursive: true, force: true }); }
});

test('an explicit per-step pin still beats the book role pin', async () => {
  const root = mkdtempSync(join(tmpdir(), 'role-models-'));
  const h = await harness(root);
  try {
    await h.post(`/api/books/${h.slug}/models/role`, { role: 'draft', provider: 'openrouter', model: 'anthropic/claude-opus-4' });
    const project: any = {};
    applyBookModelConfig(project, await h.manifest());
    // No `source` marker = the author pinned this one step in the Write rail.
    const r = stepRouting(project, { role: 'draft', taskType: 'creative_writing', modelOverride: { provider: 'openai', model: 'gpt-4o' } });
    assert.deepEqual({ provider: r.provider, model: r.model }, { provider: 'openai', model: 'gpt-4o' });
  } finally { h.server.close(); rmSync(root, { recursive: true, force: true }); }
});

test('the live project and the on-disk project state both receive the change', async () => {
  const root = mkdtempSync(join(tmpdir(), 'role-models-'));
  const h = await harness(root);
  try {
    await h.post(`/api/books/${h.slug}/models/role`, { role: 'draft', provider: 'claude' });
    // The frontier project (the live phase) is synced in memory, so a running
    // book picks the change up on its NEXT step without a restart.
    assert.deepEqual(h.project('project-2').roleModels, { draft: { provider: 'claude' } });
    // A finished phase's recency must not be disturbed by a re-stamp.
    assert.equal(h.project('project-1').updatedAt, '2020-01-01T00:00:00.000Z');
    assert.notEqual(h.project('project-2').updatedAt, '2020-01-01T00:00:00.000Z');

    // The step stamps are in-memory + debounced (1 s) — assert they really land.
    await new Promise((r) => setTimeout(r, 1400));
    assert.ok(existsSync(h.stateFile), 'project state must be persisted');
    const saved = JSON.parse(readFileSync(h.stateFile, 'utf-8'));
    const s3 = saved.projects.flatMap((p: any) => p.steps).find((s: any) => s.id === 's3');
    assert.equal(s3.modelOverride.provider, 'claude');
  } finally { h.server.close(); rmSync(root, { recursive: true, force: true }); }
});

test('a conflicting per-step override on the target role is replaced; clearing removes both halves', async () => {
  const root = mkdtempSync(join(tmpdir(), 'role-models-'));
  const h = await harness(root);
  try {
    // s3 is pinned to ollama/dolphin — a conflicting pin on the target role.
    await h.post(`/api/books/${h.slug}/models/role`, { role: 'draft', provider: 'claude' });
    assert.equal(h.step('s3')!.modelOverride.provider, 'claude');
    assert.equal(h.step('s3')!.modelOverride.model, undefined, 'the stale model id must not survive the provider change');

    const res = await h.post(`/api/books/${h.slug}/models/role`, { role: 'draft', provider: '' });
    assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
    for (const id of ['s1', 's3']) assert.equal(h.step(id)!.modelOverride, undefined, `step ${id} should be cleared`);
    assert.equal((await h.manifest()).roleModels, undefined);
    assert.deepEqual(h.step('s2')!.modelOverride, { provider: 'gemini' }, 'another role is untouched by the clear');
  } finally { h.server.close(); rmSync(root, { recursive: true, force: true }); }
});

test('temperature is never silently altered by a bulk model change', async () => {
  const root = mkdtempSync(join(tmpdir(), 'role-models-'));
  const h = await harness(root);
  try {
    await h.books.setTemperatures(h.slug, { creative: 0.88, surgical: 0.2 });
    await h.post(`/api/books/${h.slug}/models/role`, { role: 'draft', provider: 'openrouter', model: 'anthropic/claude-opus-4' });
    // The step's own pinned temperature survives the provider/model swap — the
    // per-step endpoint drops it, and the OpenRouter path defaults an omitted
    // temperature to 0.7, which would silently re-write the book's creative heat.
    assert.equal(h.step('s3')!.modelOverride.temperature, 0.95);
    // The book's Creative/Surgical buckets are untouched.
    assert.deepEqual((await h.manifest()).temperatures, { creative: 0.88, surgical: 0.2 });
  } finally { h.server.close(); rmSync(root, { recursive: true, force: true }); }
});

test('validation: bad provider, bad model id, unknown slug, unknown role', async () => {
  const root = mkdtempSync(join(tmpdir(), 'role-models-'));
  const h = await harness(root);
  try {
    const cases: Array<[string, unknown, number]> = [
      [`/api/books/${h.slug}/models/role`, { role: 'draft', provider: 'notaprovider' }, 400],
      [`/api/books/${h.slug}/models/role`, { role: 'draft', provider: 'claude', model: 'bad model id!' }, 400],
      [`/api/books/no-such-book/models/role`, { role: 'draft', provider: 'claude' }, 404],
      [`/api/books/${h.slug}/models/role`, { role: 'not_a_role', provider: 'claude' }, 400],
      [`/api/books/${h.slug}/models/role`, { provider: 'claude' }, 400],
      [`/api/books/${h.slug}/models/role`, { stepId: 'nope', provider: 'claude' }, 404],
      // A step that exists only in the abandoned duplicate chain is not addressable.
      [`/api/books/${h.slug}/models/role`, { stepId: 's8', provider: 'claude' }, 404],
    ];
    for (const [path, body, expected] of cases) {
      const res = await h.post(path, body);
      assert.equal(res.status, expected, `${path} ${JSON.stringify(body)} → ${res.status} (${JSON.stringify(await res.json())})`);
    }
    // Nothing was mutated by the rejected calls.
    assert.equal(h.step('s1')!.modelOverride, undefined);
  } finally { h.server.close(); rmSync(root, { recursive: true, force: true }); }
});

test('a read-only book is refused with 409, not 500', async () => {
  const root = mkdtempSync(join(tmpdir(), 'role-models-'));
  const h = await harness(root);
  try {
    // Written by a newer app → classifyVersion 'readonly' (no hyphen), which the
    // route's error mapping must recognise.
    const file = join(root, 'workspace', 'books', h.slug, 'book.json');
    const manifest = JSON.parse(readFileSync(file, 'utf-8'));
    manifest.schemaVersion = 99;
    writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');

    const res = await h.post(`/api/books/${h.slug}/models/role`, { role: 'draft', provider: 'claude' });
    assert.equal(res.status, 409, JSON.stringify(await res.clone().json()));
    // Fails closed: nothing was stamped in memory either.
    assert.equal(h.step('s3')!.modelOverride.provider, 'ollama');
  } finally { h.server.close(); rmSync(root, { recursive: true, force: true }); }
});
