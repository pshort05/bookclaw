# Downloadable Reports Subsystem Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (core, Tasks 1-2-3-5-6) and dispatch Task 4's three emitters to parallel subagents. Steps use checkbox (`- [ ]`).

**Goal:** A generic reports subsystem that writes each analysis engine's report as timestamped, downloadable `.md`+`.json` files under a book's `data/reports/`, with a REST API and a studio Reports page; wire all four engines (consistency, beta-reader, structure, plot-promises).

**Architecture:** A `ReportsService` writes/lists/prunes per-book `data/reports/` (keep-last-N per kind, `index.json` for fast listing with filename fallback). Routes serve them via the existing `serveFile`. Each engine, at its completion point, renders markdown (pure renderer) and calls `reports.write`, fail-soft.

**Tech Stack:** TypeScript (NodeNext, `.js` imports), Express, `node:test` via tsx, React/Vite studio, bash smoke.

## Global Constraints

- `REPORT_KEEP = 10` per kind. `ReportKind = 'consistency' | 'beta-reader' | 'structure' | 'plot-promises'`.
- Report id = `<kind>-<stamp>`, stamp = UTC `YYYYMMDDTHHMMSSZ`. id regex `^[a-z-]+-\d{8}T\d{6}Z$`.
- Files under `<book data dir>/reports/`; `BookService.dataDirOf(slug)` gives the data dir (null if book missing).
- Fail-soft everywhere: report emission/listing never throws into a caller or breaks an engine run.
- `.js` import extensions (NodeNext). `SLUG_RE` from `book-types.js`; `safePath`, `serveFile` from `routes/_shared.js`.

---

### Task 1: `ReportsService` + types

**Files:**
- Create: `gateway/src/services/reports.ts`
- Test: `tests/unit/reports-service.test.ts`

**Interfaces (Produces):**
- `type ReportKind`, `const REPORT_KEEP=10`, `const KIND_LABELS`, `interface ReportMeta { id; kind; title; generatedAt; summary; formats: ('md'|'json')[] }`.
- `class ReportsService { constructor(books: { dataDirOf(slug: string|null): string|null });
   static stamp(d?: Date): string;
   write(slug, kind, { title; markdown; json; summary? }, timestamp?): { id: string } | null;
   list(slug): ReportMeta[];
   resolvePath(slug, id, format: 'md'|'json'): string | null }`.

- [ ] **Step 1: Write failing tests** — `tests/unit/reports-service.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, existsSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReportsService, REPORT_KEEP } from '../../gateway/src/services/reports.js';

function svc() {
  const root = mkdtempSync(join(tmpdir(), 'reports-'));
  const dataDir = join(root, 'data');
  mkdirSync(dataDir, { recursive: true });
  const s = new ReportsService({ dataDirOf: (slug) => (slug === 'b1' ? dataDir : null) });
  return { s, root, reportsDir: join(dataDir, 'reports') };
}

test('write creates .md + .json + index entry; list returns it', () => {
  const { s, root, reportsDir } = svc();
  try {
    const r = s.write('b1', 'consistency', { title: 'Consistency', markdown: '# C', json: { findings: [] }, summary: '0 findings' }, '20260625T010000Z');
    assert.deepEqual(r, { id: 'consistency-20260625T010000Z' });
    assert.ok(existsSync(join(reportsDir, 'consistency-20260625T010000Z.md')));
    assert.ok(existsSync(join(reportsDir, 'consistency-20260625T010000Z.json')));
    const list = s.list('b1');
    assert.equal(list.length, 1);
    assert.equal(list[0].kind, 'consistency');
    assert.equal(list[0].summary, '0 findings');
    assert.deepEqual(list[0].formats.sort(), ['json', 'md']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('prune keeps newest REPORT_KEEP per kind', () => {
  const { s, root, reportsDir } = svc();
  try {
    for (let i = 0; i < REPORT_KEEP + 4; i++) {
      const stamp = `202606${String(10 + i).padStart(2, '0')}T010000Z`;
      s.write('b1', 'consistency', { title: 'C', markdown: 'x', json: {} }, stamp);
    }
    s.write('b1', 'beta-reader', { title: 'B', markdown: 'y', json: {} }, '20260625T020000Z');
    const cons = s.list('b1').filter((m) => m.kind === 'consistency');
    assert.equal(cons.length, REPORT_KEEP);
    const mdFiles = readdirSync(reportsDir).filter((f) => f.startsWith('consistency-') && f.endsWith('.md'));
    assert.equal(mdFiles.length, REPORT_KEEP);              // older .md deleted
    assert.ok(s.list('b1').some((m) => m.kind === 'beta-reader')); // other kinds untouched
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('resolvePath guards traversal + bad format; null for missing', () => {
  const { s, root } = svc();
  try {
    s.write('b1', 'consistency', { title: 'C', markdown: 'x', json: {} }, '20260625T010000Z');
    assert.ok(s.resolvePath('b1', 'consistency-20260625T010000Z', 'md'));
    assert.equal(s.resolvePath('b1', '../../etc/passwd', 'md'), null);
    assert.equal(s.resolvePath('b1', 'consistency-20260625T010000Z', 'txt' as any), null);
    assert.equal(s.resolvePath('b1', 'nope-20260625T010000Z', 'json'), null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('list reconstructs from filenames when index.json is missing', () => {
  const { s, root, reportsDir } = svc();
  try {
    s.write('b1', 'consistency', { title: 'C', markdown: 'x', json: {} }, '20260625T010000Z');
    rmSync(join(reportsDir, 'index.json'), { force: true });
    const list = s.list('b1');
    assert.equal(list.length, 1);
    assert.equal(list[0].id, 'consistency-20260625T010000Z');
    assert.equal(list[0].kind, 'consistency');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run — expect fail** (`node --import tsx --test tests/unit/reports-service.test.ts` → cannot find module).

- [ ] **Step 3: Implement** — `gateway/src/services/reports.ts`:

```ts
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import { join, resolve, sep } from 'path';

export type ReportKind = 'consistency' | 'beta-reader' | 'structure' | 'plot-promises';
export const REPORT_KEEP = 10;
export const KIND_LABELS: Record<ReportKind, string> = {
  consistency: 'Consistency', 'beta-reader': 'Beta Reader', structure: 'Structure & Length', 'plot-promises': 'Plot Promises',
};
const KINDS = new Set<string>(Object.keys(KIND_LABELS));
const ID_RE = /^[a-z-]+-\d{8}T\d{6}Z$/;

export interface ReportMeta { id: string; kind: ReportKind; title: string; generatedAt: string; summary: string; formats: Array<'md' | 'json'>; }
interface BooksLike { dataDirOf(slug: string | null): string | null; }
interface IndexFile { reports: ReportMeta[]; }

export class ReportsService {
  constructor(private books: BooksLike) {}

  static stamp(d: Date = new Date()): string {
    return d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  }

  private dir(slug: string): string | null {
    const data = this.books.dataDirOf(slug);
    return data ? join(data, 'reports') : null;
  }

  private readIndex(dir: string): IndexFile {
    try {
      const raw = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf-8'));
      if (raw && Array.isArray(raw.reports)) return raw as IndexFile;
    } catch { /* fall through */ }
    return { reports: [] };
  }
  private writeIndex(dir: string, idx: IndexFile): void {
    writeFileSync(join(dir, 'index.json'), JSON.stringify(idx, null, 2), 'utf-8');
  }

  write(slug: string, kind: ReportKind, r: { title: string; markdown: string; json: unknown; summary?: string }, timestamp?: string): { id: string } | null {
    try {
      if (!KINDS.has(kind)) return null;
      const dir = this.dir(slug);
      if (!dir) return null;
      mkdirSync(dir, { recursive: true });
      const id = `${kind}-${timestamp ?? ReportsService.stamp()}`;
      if (!ID_RE.test(id)) return null;
      writeFileSync(join(dir, `${id}.md`), r.markdown, 'utf-8');
      writeFileSync(join(dir, `${id}.json`), JSON.stringify(r.json, null, 2), 'utf-8');
      const idx = this.readIndex(dir);
      idx.reports = idx.reports.filter((m) => m.id !== id);
      idx.reports.push({ id, kind, title: r.title, generatedAt: new Date().toISOString(), summary: r.summary ?? '', formats: ['md', 'json'] });
      this.writeIndex(dir, idx);
      this.prune(dir, kind);
      return { id };
    } catch (e) {
      console.log(`  ⚠ reports.write(${slug}/${kind}) failed: ${(e as Error)?.message ?? e}`);
      return null;
    }
  }

  private prune(dir: string, kind: ReportKind): void {
    const idx = this.readIndex(dir);
    const ofKind = idx.reports.filter((m) => m.kind === kind).sort((a, b) => b.id.localeCompare(a.id));
    const remove = ofKind.slice(REPORT_KEEP);
    for (const m of remove) {
      for (const f of [`${m.id}.md`, `${m.id}.json`]) { try { unlinkSync(join(dir, f)); } catch { /* gone */ } }
    }
    if (remove.length) {
      const removeIds = new Set(remove.map((m) => m.id));
      idx.reports = idx.reports.filter((m) => !removeIds.has(m.id));
      this.writeIndex(dir, idx);
    }
  }

  list(slug: string): ReportMeta[] {
    const dir = this.dir(slug);
    if (!dir || !existsSync(dir)) return [];
    const idx = this.readIndex(dir);
    let metas = idx.reports;
    if (metas.length === 0) {
      // Fallback: reconstruct from filenames.
      const seen = new Map<string, ReportMeta>();
      let files: string[] = [];
      try { files = readdirSync(dir); } catch { return []; }
      for (const f of files) {
        const m = f.match(/^([a-z-]+)-(\d{8}T\d{6}Z)\.(md|json)$/);
        if (!m || !KINDS.has(m[1])) continue;
        const id = `${m[1]}-${m[2]}`;
        const e = seen.get(id) ?? { id, kind: m[1] as ReportKind, title: KIND_LABELS[m[1] as ReportKind], generatedAt: isoFromStamp(m[2]), summary: '', formats: [] as Array<'md'|'json'> };
        if (!e.formats.includes(m[3] as 'md' | 'json')) e.formats.push(m[3] as 'md' | 'json');
        seen.set(id, e);
      }
      metas = [...seen.values()];
    }
    return metas.slice().sort((a, b) => b.id.localeCompare(a.id));
  }

  resolvePath(slug: string, id: string, format: 'md' | 'json'): string | null {
    if (format !== 'md' && format !== 'json') return null;
    if (!ID_RE.test(id)) return null;
    const dir = this.dir(slug);
    if (!dir) return null;
    const resolvedBase = resolve(dir);
    const p = resolve(dir, `${id}.${format}`);
    if (p !== resolvedBase && !p.startsWith(resolvedBase + sep)) return null;
    return existsSync(p) ? p : null;
  }
}

function isoFromStamp(stamp: string): string {
  // 20260625T010000Z -> 2026-06-25T01:00:00Z
  const m = stamp.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z` : stamp;
}
```

- [ ] **Step 4: Run — expect pass** (4 tests).

---

### Task 2: Reports REST API + service registration

**Files:**
- Create: `gateway/src/api/routes/reports.routes.ts`
- Modify: `gateway/src/api/routes.ts` (import + `mountReports(app, gateway, baseDir)` call alongside the other mounts)
- Modify: `gateway/src/init/phase-03-soul-memory.ts` (construct `gw.reports = new ReportsService(gw.books)` after `gw.books` exists; if books isn't ready in phase-03, construct in the phase where `gw.books` is created — grep `gw.books =` and place it right after)
- Modify: `gateway/src/index.ts` (add `public reports?: ReportsService;` near `consistencyStore`; add `reports: this.reports,` to the services object ~line 1320)

**Interfaces (Consumes):** `ReportsService` (Task 1), `serveFile`/`safePath` (`_shared.js`), `SLUG_RE` (`book-types.js`).

- [ ] **Step 1: Implement the route module** — `gateway/src/api/routes/reports.routes.ts`:

```ts
import { Application, Request, Response } from 'express';
import { SLUG_RE } from '../../services/book-types.js';
import { serveFile } from './_shared.js';

export function mountReports(app: Application, gateway: any, _baseDir: string): void {
  const services = gateway.getServices();

  app.get('/api/books/:slug/reports', (req: Request, res: Response) => {
    const slug = String(req.params.slug);
    if (!SLUG_RE.test(slug) || !services.books?.exists?.(slug)) return res.status(404).json({ error: 'Book not found' });
    res.json({ reports: services.reports?.list(slug) ?? [] });
  });

  app.get('/api/books/:slug/reports/:id', (req: Request, res: Response) => {
    const slug = String(req.params.slug);
    const id = String(req.params.id);
    const format = req.query.format === 'json' ? 'json' : 'md';
    if (!SLUG_RE.test(slug) || !services.books?.exists?.(slug)) return res.status(404).json({ error: 'Book not found' });
    const p = services.reports?.resolvePath(slug, id, format);
    if (!p) return res.status(404).json({ error: 'Report not found' });
    serveFile(res, p, `${id}.${format}`, !!req.query.download).catch(() => res.destroy());
  });
}
```

- [ ] **Step 2: Register** — in `gateway/src/api/routes.ts`, add `import { mountReports } from './routes/reports.routes.js';` and `mountReports(app, gateway, baseDir);` next to `mountConsistency(...)`. In `gateway/src/index.ts` add the field + services-object entry. In the init phase that has `gw.books`, add `gw.reports = new ReportsService(gw.books);` and `import { ReportsService } from '../services/reports.js';`.

- [ ] **Step 3: Type-check** — `npx tsc --noEmit` → clean. (API exercised by the smoke, Task 6.)

---

### Task 3: Consistency emitter + renderer (the template the fan-out copies)

**Files:**
- Create: `gateway/src/services/reports/render-consistency.ts`
- Modify: `gateway/src/api/routes/consistency.routes.ts` (emit in the audit `.then(report)`)
- Test: `tests/unit/report-render-consistency.test.ts`

**Interfaces (Produces):** `renderConsistencyReport(report: AuditReport): { title: string; markdown: string; summary: string }`.

- [ ] **Step 1: Failing test** — `tests/unit/report-render-consistency.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderConsistencyReport } from '../../gateway/src/services/reports/render-consistency.js';

test('renders summary + findings grouped with chapter refs', () => {
  const report: any = {
    findings: [{ category: 'contradiction', severity: 'high', entity: 'John', attribute: 'eye_color',
      a: { chapter: 'chapter-2', scene: 0, quote: 'green eyes' }, b: { chapter: 'chapter-1', scene: 0, quote: 'blue eyes' },
      explanation: "John's eye_color differs", suggestedFix: 'reconcile' }],
    chaptersScanned: 5, factCount: 20, knowledgeEventCount: 2, nonCanonicalSceneCount: 1,
    reverseIndex: [{ entity: 'John', attribute: 'eye_color', chapters: ['chapter-1', 'chapter-2'], isCanon: true }],
    orphanFacts: [{ entity: 'Sword', attribute: 'location', valueRaw: 'the vault', world: 'w1' }],
    generatedAt: '2026-06-25T01:00:00Z',
  };
  const out = renderConsistencyReport(report);
  assert.match(out.title, /Consistency/);
  assert.match(out.markdown, /# Consistency/);
  assert.match(out.markdown, /eye_color/);
  assert.match(out.markdown, /chapter-2/);
  assert.match(out.markdown, /chapter-1/);     // reverse index / finding ref
  assert.match(out.markdown, /Sword/);          // orphan facts
  assert.match(out.summary, /1 finding/);
});

test('handles an empty report', () => {
  const out = renderConsistencyReport({ findings: [], chaptersScanned: 0, factCount: 0, knowledgeEventCount: 0, nonCanonicalSceneCount: 0, reverseIndex: [], orphanFacts: [], generatedAt: '2026-06-25T01:00:00Z' } as any);
  assert.match(out.markdown, /# Consistency/);
  assert.match(out.summary, /0 findings/);
});
```

- [ ] **Step 2: Run — expect fail.**

- [ ] **Step 3: Implement** — `gateway/src/services/reports/render-consistency.ts`:

```ts
import type { AuditReport } from '../consistency/audit.js';
import type { ConsistencyFinding } from '../consistency/types.js';

const SEV_ORDER = ['high', 'medium', 'low'] as const;

export function renderConsistencyReport(report: AuditReport): { title: string; markdown: string; summary: string } {
  const f = report.findings ?? [];
  const summary = `${f.length} finding${f.length === 1 ? '' : 's'} across ${report.chaptersScanned} chapter(s)`;
  const L: string[] = [];
  L.push('# Consistency report');
  L.push('');
  L.push(`_Generated ${report.generatedAt}_`);
  L.push('');
  L.push(`- Chapters scanned: ${report.chaptersScanned}`);
  L.push(`- Facts: ${report.factCount} · Knowledge events: ${report.knowledgeEventCount} · Non-canonical scenes: ${report.nonCanonicalSceneCount}`);
  L.push(`- Findings: ${f.length}`);
  L.push('');
  L.push('## Findings');
  if (f.length === 0) L.push('No consistency findings.');
  for (const sev of SEV_ORDER) {
    const group = f.filter((x) => x.severity === sev);
    if (!group.length) continue;
    L.push('');
    L.push(`### ${sev.toUpperCase()} (${group.length})`);
    for (const x of group) L.push(renderFinding(x));
  }
  if (report.reverseIndex?.length) {
    L.push('');
    L.push('## Impact index (fact → chapters)');
    for (const r of report.reverseIndex) L.push(`- **${r.entity} · ${r.attribute}**${r.isCanon ? ' _(canon)_' : ''}: ${r.chapters.join(', ')}`);
  }
  if (report.orphanFacts?.length) {
    L.push('');
    L.push('## Orphan canon facts (never dramatized)');
    for (const o of report.orphanFacts) L.push(`- **${o.entity} · ${o.attribute}**: "${o.valueRaw}"${o.world ? ` _(world: ${o.world})_` : ''}`);
  }
  L.push('');
  return { title: 'Consistency report', markdown: L.join('\n'), summary };
}

function chapRef(ref: any): string {
  if (ref?.chapter) return `${ref.chapter}${ref.scene != null ? `:${ref.scene}` : ''}`;
  if (ref?.canonSource) return ref.canonSource;
  return '—';
}
function renderFinding(x: ConsistencyFinding): string {
  return [
    '',
    `- **${x.entity} · ${x.attribute}** (${x.category})`,
    `  - ${x.explanation}`,
    `  - ${chapRef(x.a)} vs ${chapRef(x.b)}`,
    `  - Fix: ${x.suggestedFix}`,
  ].join('\n');
}
```

- [ ] **Step 4: Run — expect pass.**

- [ ] **Step 5: Emit in the route** — in `gateway/src/api/routes/consistency.routes.ts`, inside the audit `.then((report) => { ... })` (after the existing activity log + before/after the socket emit), add:

```ts
        try {
          const r = renderConsistencyReport(report);
          services.reports?.write(slug, 'consistency', { title: r.title, markdown: r.markdown, json: report, summary: r.summary });
        } catch (e) { /* fail-soft: report emission must not break the audit */ }
```
and add `import { renderConsistencyReport } from '../../services/reports/render-consistency.js';` at the top.

- [ ] **Step 6: tsc + run the consistency + reports unit tests** → clean/pass.

---

### Task 4: The other three emitters (FAN OUT — one subagent each, parallel)

Each follows Task 3's pattern exactly: a pure renderer in `gateway/src/services/reports/render-<kind>.ts` returning `{ title, markdown, summary }`, a unit test `tests/unit/report-render-<kind>.test.ts`, and a fail-soft `services.reports?.write(...)` call at the engine's completion point. Project-keyed engines resolve the book via `engine.getProject(projectId)?.bookSlug` and **skip (no write, no throw) when bookSlug is absent**.

- [ ] **4a — beta-reader** (project-keyed). Renderer `renderBetaReaderReport(report: BetaReaderReport)` (import type from `../beta-reader.js`): markdown with aggregate (avgTension, avgWantToContinue, weakest/strongest chapter, topEmotions, topConfusions) + per-archetype/per-chapter feedback; summary `"${chapterCount} chapters · ${archetypeCount} readers"`. Emit in `gateway/src/api/routes/export.routes.ts` `POST /api/projects/:id/beta-reader` after `const report = await beta.scanManuscript(...)` (the `project` is already in scope; use `project.bookSlug`). Test asserts markdown contains an aggregate value + a chapter, and the empty/edge case.
- [ ] **4b — structure** (book-keyed). Renderer `renderStructureReport(input: { structure?: unknown; mapping?: unknown; length: LengthReview })` (import `LengthReview` type from `../format-review.js`): markdown with the per-chapter length table (chapter, words, target, delta), totals, form-band check + genre range, and the beat→outline mapping if present; summary `"${totalWords} words, ${withinBand ? 'in band' : 'OUT OF BAND'}"`. Emit in `gateway/src/api/routes/format-review.routes.ts` on `PUT /api/books/:slug/structure-review` (after the save succeeds): build the length review (reuse the same `buildLengthReview` inputs the GET length-review route uses) + the saved structure mapping, then `services.reports?.write(slug, 'structure', {...})`. Test asserts the length table + band line render.
- [ ] **4c — plot-promises** (project-keyed). Renderer `renderPlotPromisesReport(report: PromiseAuditReport)` (import type from `../plot-promises.js`): markdown with closureRate + counts (paidOff/partial/open/intentionallyUnpaid/dropped), the atRiskPromises list (title, introduced/closed chapters), and redHerringWarnings; summary `"${totalPromises} promises, ${closureRate}% closed"`. Emit in `gateway/src/api/routes/knowledge.routes.ts` on the plot-promises **audit** route (where the `PromiseAuditReport` is produced and `project` is available ~line 466): resolve `project.bookSlug`, render, `services.reports?.write(...)`. Test asserts the counts + at-risk section render.

Each subagent: write renderer + test (TDD), wire the emit, run its own test + `npx tsc --noEmit`. Touch only its renderer file, its test file, and its one route file. Do NOT edit `reports.ts`, `reports.routes.ts`, or another emitter's files.

---

### Task 5: Studio Reports page + Rail link + panel links

**Files:**
- Create: `frontend/studio/src/routes/Reports.tsx` (+ `Reports.module.css`)
- Modify: `frontend/studio/src/main.tsx` (route `path="reports"`), `frontend/studio/src/Rail.tsx` (NavLink to `/reports`)
- Modify: `frontend/studio/src/routes/Consistency.tsx` + `StructureLength.tsx` (a "Download latest report" link)

- [ ] **Step 1: Reports page** — fetch `GET /api/books/active/reports`? No — reports are per book; use the active book slug (mirror how Consistency.tsx resolves the active book). Fetch `GET /api/books/:slug/reports`, group by `kind` (using the kind labels), list each version newest-first with: a **View** button (fetch `/api/books/:slug/reports/:id?format=md` as text, show in a panel/`<pre>`) and **Download .md** / **Download .json** links (`?format=…&download=1`). Empty state when none. Match the existing route component + CSS-module conventions (see `Consistency.tsx`).
- [ ] **Step 2: Register route + Rail link** — `main.tsx`: `<Route path="reports" element={<Reports />} />` + import; `Rail.tsx`: a NavLink `to="/reports"` labelled "Reports" (reuse the existing NavLink markup; pick a simple inline SVG icon).
- [ ] **Step 3: Panel links** — in `Consistency.tsx` and `StructureLength.tsx`, after a report exists, add a "Download latest report" link that resolves the newest report of that kind from `GET …/reports` and links to its `.md?download=1`.
- [ ] **Step 4: Build** — `npm run build:frontend` exit 0.

---

### Task 6: Smoke + full verification

**Files:** Modify `tests/consistency-smoke.sh`.

- [ ] **Step 1: Extend the smoke** — after the consistency audit completes and the report is ready, assert: a `consistency-*.md` and `consistency-*.json` exist under `${DATA_DIR}/reports/`; `GET /api/books/:slug/reports` returns a list whose newest entry has `kind:"consistency"`; `GET /api/books/:slug/reports/<id>?format=md` returns 200 with markdown (contains `# Consistency`); and after a second audit run the reports dir holds ≤ `REPORT_KEEP` consistency versions. Guard behind the existing `REPORT_JSON` availability check (skip gracefully on a weak model / unavailable DB).
- [ ] **Step 2: Run** — `bash tests/consistency-smoke.sh` (local; LLM-dependent asserts skip on a weak model — the report-file asserts are deterministic given the audit ran).
- [ ] **Step 3: Full verify** — `npx tsc --noEmit` clean; `node --import tsx --test tests/unit/*.test.ts` green; `npm run build:frontend` exit 0.

---

## Self-Review

**Spec coverage:** generic store + history + keep-N (Task 1) ✓; REST API list/serve + guards (Task 2) ✓; 4 emitters + renderers + project→book resolution + fail-soft (Tasks 3, 4) ✓; Reports page + panel links (Task 5) ✓; smoke + unit tests (Tasks 1-6) ✓; data/reports/ layout + index.json + filename fallback (Task 1) ✓.

**Placeholder scan:** Task 2/Task 5 say "place after `gw.books`" / "mirror Consistency.tsx" — these point at concrete existing anchors, not vague work. Task 4's three renderers give signatures + required sections + emit file/location + test assertions (the fan-out implements bodies from the Task 3 template). No TBDs.

**Type consistency:** `ReportsService.write(slug, kind, {title,markdown,json,summary?}, timestamp?)`, `list`, `resolvePath`, `ReportKind`, `REPORT_KEEP`, id regex `^[a-z-]+-\d{8}T\d{6}Z$`, and `render<Kind>Report(...) → {title,markdown,summary}` are used identically across tasks. The route serves `${id}.${format}` matching `resolvePath`.
