# Chunked Two-Pass De-AI Sweep + Banned-Terms Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automate the author's manual "second pass" de-AI edit and restore full-chapter detection recall, by (a) a zero-cost deterministic banned-terms replace + forbidden-words injection, (b) chunking the chapter into ~1,000-word windows for the de-AI audit, and (c) a capped two-pass (broad → second-reader) sweep with per-pass model config — all while keeping the shipped **audit → deterministic-apply** contract unchanged.

**Architecture:** All new logic lives in pure, unit-testable modules under `gateway/src/services/deai/`. The existing `deterministic-apply.ts` (`applyDeAiEdits`, `parseAuditEdits`, `DeAiEdit`, `runDeterministicApply`, `makeScopedRewriteFn`) is **consumed, not modified**. A single orchestrator `runChunkedDeAiSweep()` takes injected `audit` + `apply` callables (so it is testable with fakes) and encapsulates banned-terms → pass 1 → apply → pass 2 → apply. Wiring into `projects.routes.ts` intercepts the existing `romance-deai-audit` step; the pipeline JSONs and the per-book `stageModels` map gain `deai_pass1`/`deai_pass2` slots.

**Tech Stack:** Node.js 22 + TypeScript via `tsx` (NodeNext, `.js` import specifiers). Tests are **`node:test`** (NOT vitest) with `node:assert/strict`, run through `tsx`. No new dependencies (CSV parsed by hand — literal, quote-aware; three columns).

## Global Constraints

- **Test runner is `node:test`, not vitest.** Every test file: `import { test } from 'node:test'; import assert from 'node:assert/strict';`. Run one file with:
  `node --import tsx --test --experimental-test-isolation=none tests/unit/<name>.test.ts`
- **Imports use `.js` extensions** even for `.ts` sources (NodeNext). Match this in every new file.
- **The deterministic-apply contract is UNCHANGED.** Do not edit `applyDeAiEdits`, `parseAuditEdits`, `DeAiEdit`, or `ApplyResult`. Banned-terms gets its OWN function + own stats shape.
- **Narration only.** Both the deterministic banned-terms replace AND the ban-only forbidden-words injection skip dialogue (text inside `"` `“` `”`) and Markdown (headers `#…`, horizontal rules `---`, and `*italic*` markers). This mirrors the audit skill's existing "never flag dialogue / Markdown" rule.
- **Banned-terms matching:** case-INSENSITIVE match, case-PRESERVING replace, word-boundary aware. Literal phrases only — no regex, no morphology inference (author lists variants explicitly).
- **Two passes capped at 2.** Short-circuit any pass whose merged edit list is empty (no apply, no wasted call). A single window's audit error is fail-soft: skip that window, log `⚠`, continue.
- **Per-pass model defaults:** pass 1 = Gemini (non-Anthropic, catches Opus tells), pass 2 = Haiku (different family, byte-exact quoting). Configurable via the per-book `stageModels` slots `deai_pass1` / `deai_pass2`; a set slot overrides the default.
- **Length-neutral.** The sweep never regenerates the chapter; only named `find` spans are touched by `applyDeAiEdits`. Extra passes cannot flatten voice (structurally bounded by the applier).

---

## Shared-file coordination (Canon Drift Gate overlap)

The sibling feature **Canon Drift Gate** (`docs/superpowers/specs/2026-07-14-canon-drift-gate-design.md`, same date) edits several of the same files. Sequence to avoid conflicts:

| Shared file | This plan | Canon Drift Gate | Conflict-avoidance |
|-------------|-----------|------------------|--------------------|
| `library/pipelines/romance-sweet-deterministic.json` + `romance-spicy-deterministic.json` | Task 11 replaces the single `romance-deai-audit`/`deterministic-apply` pair semantics (adds pass config; see Task 11 note) | Reorders steps 3↔4, inserts Gate A/B `*-canon-audit` + apply steps before chapters | **Land one feature's pipeline-JSON edit fully, then rebase the other by hand.** Both touch the same step array; a blind merge will corrupt JSON. |
| `gateway/src/services/deterministic-apply.ts` | Consumes `applyDeAiEdits`/`DeAiEdit` unchanged | Consumes `applyDeAiEdits` unchanged | No conflict — both read-only consumers. |
| `gateway/src/api/routes/projects.routes.ts` | Task 11 adds a `romance-deai-audit` interception branch (studio path ~611-647 + auto-execute path ~1097-1160) | Adds `*-canon-audit` handling in the same audit-step region | **Coordinate the two branches:** keep each an isolated `else if` on `skill`; do not share the dispatch scaffold until both land. |
| `gateway/src/services/projects.ts` (ProjectEngine) | No template edits required (JSON pipelines drive this) | Inserts Gate steps | Low overlap; watch `buildBookProductionContext` if either adds context blocks. |

**Recommendation:** implement Tasks 1–10 (all pure modules + skill/manifest edits — zero overlap) first and in either order relative to Canon Drift Gate. Serialize only Task 11 (routes + pipeline JSON) against Canon Drift Gate's wiring task.

---

## File Structure

- Create `gateway/src/services/deai/banned-terms.ts` — CSV load + global/overlay merge; `applyBannedTerms`; `forbiddenWordsInNarration`. Owns the banned-terms registry behavior.
- Create `gateway/src/services/deai/narration-spans.ts` — `protectedRanges(text)` / `isProtected()` shared dialogue+Markdown span mask, reused by banned-terms replace AND ban-only injection.
- Create `gateway/src/services/deai/chunk-chapter.ts` — `chunkChapter(text, targetWords)` → windows + seam context. Pure, no deps.
- Create `gateway/src/services/deai/merge-edits.ts` — `mergeWindowEdits(lists)` union + dedupe by `find`.
- Create `gateway/src/services/deai/sweep.ts` — `runChunkedDeAiSweep()` orchestrator (injected `audit`/`apply` callables), second-reader prompt framing, per-pass model resolution.
- Modify `skills/author/romance-deai-audit/SKILL.md` — add aphoristic-button + generalizing-second-person categories.
- Modify `gateway/src/services/book.ts` + `gateway/src/services/book-types.ts` — document the two new `stageModels` slots (open Record already accepts them; only comments + the routes regex need touching).
- Modify `gateway/src/api/routes/books.routes.ts:288` — relax the stage-key regex to admit digits.
- Modify `gateway/src/api/routes/projects.routes.ts` — Task 11 wiring.
- Modify `library/pipelines/romance-sweet-deterministic.json` + `romance-spicy-deterministic.json` — Task 11.
- Create `workspace/.config/banned-terms.csv` — seed global registry (gitignored; created at runtime/by owner — a starter is committed under `library/` per Task 1 note).
- Create tests: `tests/unit/deai-banned-terms.test.ts`, `deai-narration-spans.test.ts`, `deai-chunk-chapter.test.ts`, `deai-merge-edits.test.ts`, `deai-sweep.test.ts`, `deai-passmodels.test.ts`, `deai-ch1-fixture.test.ts`, plus a fixture `tests/unit/fixtures/deai-ch1.md`.

---

## Task 1: Narration span mask (dialogue + Markdown)

**Files:**
- Create: `gateway/src/services/deai/narration-spans.ts`
- Test: `tests/unit/deai-narration-spans.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `export function protectedRanges(text: string): Array<[number, number]>` — half-open `[start, end)` character ranges that are dialogue or Markdown and must be skipped. `export function isProtected(ranges: Array<[number,number]>, index: number): boolean`.

**Design notes:** Reuse the quote-character set from `gateway/src/services/dialogue-parser.ts` (`"` `“` `”`). That module detects dialogue at the *paragraph* level (`startsWithQuote`) — we need *inline* quote spans, so a new mask is warranted; it is the single source of "what counts as protected" for both the replace and the injection.

- [ ] **Step 1: Write the failing test**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { protectedRanges, isProtected } from '../../gateway/src/services/deai/narration-spans.js';

test('quoted dialogue spans are protected', () => {
  const t = 'She said "the phone buzzed loudly" and left.';
  const r = protectedRanges(t);
  const inside = t.indexOf('phone');
  assert.equal(isProtected(r, inside), true);
  const outside = t.indexOf('left');
  assert.equal(isProtected(r, outside), false);
});

test('markdown header, hrule, and italic markers are protected', () => {
  const t = '# Chapter One\n\n---\n\nShe was *very* tired.';
  const r = protectedRanges(t);
  assert.equal(isProtected(r, t.indexOf('Chapter')), true, 'header line');
  assert.equal(isProtected(r, t.indexOf('---')), true, 'hrule');
  assert.equal(isProtected(r, t.indexOf('very')), true, 'italic span');
  assert.equal(isProtected(r, t.indexOf('tired')), false, 'plain narration');
});

test('curly quotes are protected', () => {
  const t = 'He whispered “delve deeper” then paused.';
  assert.equal(isProtected(protectedRanges(t), t.indexOf('delve')), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test --experimental-test-isolation=none tests/unit/deai-narration-spans.test.ts`
Expected: FAIL — `Cannot find module '.../narration-spans.js'`.

- [ ] **Step 3: Write minimal implementation**

```ts
/**
 * Narration-only span mask shared by the banned-terms replace and the ban-only
 * forbidden-words injection. Marks dialogue (quoted spans) and Markdown
 * (headers, horizontal rules, *italic* markers) as PROTECTED so the author's
 * voice filters never touch character speech or structure. Mirrors the de-AI
 * audit skill's "never flag dialogue or Markdown" rule.
 */
const OPEN_QUOTES = '"“”';

/** Half-open [start,end) ranges to skip, in ascending order (may overlap). */
export function protectedRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];

  // 1) Dialogue: any run from an opening quote char to the next quote char.
  const quote = /["“”][^"“”]*["“”]/g;
  for (let m; (m = quote.exec(text)); ) ranges.push([m.index, m.index + m[0].length]);

  // 2) Markdown line-level: header lines (#, ##, ...) and horizontal rules (---).
  const lineRe = /^[ \t]*(#{1,6}\s.*|-{3,}\s*)$/gm;
  for (let m; (m = lineRe.exec(text)); ) ranges.push([m.index, m.index + m[0].length]);

  // 3) Markdown inline emphasis: *italic* / **bold** spans.
  const em = /\*{1,2}[^*\n]+\*{1,2}/g;
  for (let m; (m = em.exec(text)); ) ranges.push([m.index, m.index + m[0].length]);

  return ranges.sort((a, b) => a[0] - b[0]);
}

export function isProtected(ranges: Array<[number, number]>, index: number): boolean {
  for (const [s, e] of ranges) {
    if (index >= s && index < e) return true;
    if (s > index) break; // sorted — no later range can contain index
  }
  return false;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test --experimental-test-isolation=none tests/unit/deai-narration-spans.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add gateway/src/services/deai/narration-spans.ts tests/unit/deai-narration-spans.test.ts
git commit -m "feat(deai): narration-only span mask (dialogue + markdown)"
```

---

## Task 2: Banned-terms CSV loader + global/overlay merge

**Files:**
- Create: `gateway/src/services/deai/banned-terms.ts`
- Create (seed): `library/banned-terms.csv` (committed starter, copied to `workspace/.config/banned-terms.csv` on first boot — see note)
- Test: `tests/unit/deai-banned-terms.test.ts`

**Interfaces:**
- Consumes: nothing (pure string parsing).
- Produces:
  - `export interface BannedTerms { fixed: Array<{ find: string; replace: string }>; banOnly: string[]; }`
  - `export function parseBannedCsv(csv: string): BannedTerms` — one source.
  - `export function mergeBannedTerms(global: BannedTerms, overlay: BannedTerms): BannedTerms` — overlay overrides global **by `find`** (case-insensitive key), extending with new entries. A `find` present in overlay wins regardless of which bucket it lands in.

**Design notes:** Columns `find,replace,bucket?`. Blank `replace` → ban-only (goes to `banOnly`). `bucket` (`ai|personal`) is organizational — **ignored by code**. Parser must tolerate quoted fields containing commas and a header row (`find,replace,bucket`). No dependency — a small quote-aware line splitter suffices (literal phrases, three columns).

- [ ] **Step 1: Write the failing test**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBannedCsv, mergeBannedTerms } from '../../gateway/src/services/deai/banned-terms.js';

test('parseBannedCsv splits fixed vs ban-only; bucket ignored; header skipped', () => {
  const csv = [
    'find,replace,bucket',
    'phone buzzed,phone vibrated,personal',
    'delve,,ai',
    '"a tapestry of",,ai',
  ].join('\n');
  const b = parseBannedCsv(csv);
  assert.deepEqual(b.fixed, [{ find: 'phone buzzed', replace: 'phone vibrated' }]);
  assert.deepEqual(b.banOnly.sort(), ['a tapestry of', 'delve']);
});

test('parseBannedCsv tolerates quoted field with a comma', () => {
  const csv = 'find,replace\n"quick, clean, and precise","quick and precise"';
  const b = parseBannedCsv(csv);
  assert.deepEqual(b.fixed, [{ find: 'quick, clean, and precise', replace: 'quick and precise' }]);
});

test('mergeBannedTerms: overlay overrides global by find (case-insensitive)', () => {
  const global = parseBannedCsv('find,replace\nphone buzzed,phone vibrated\ndelve,');
  const overlay = parseBannedCsv('find,replace\nPhone Buzzed,phone rang\nsmirk,');
  const m = mergeBannedTerms(global, overlay);
  // overridden fixed entry uses overlay replacement, keeps ONE entry
  assert.deepEqual(m.fixed.filter(e => e.find.toLowerCase() === 'phone buzzed'),
    [{ find: 'Phone Buzzed', replace: 'phone rang' }]);
  // global ban-only survives, overlay ban-only added
  assert.deepEqual(m.banOnly.sort(), ['delve', 'smirk']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test --experimental-test-isolation=none tests/unit/deai-banned-terms.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation** (loader half only — `applyBannedTerms` + injection land in Tasks 3/4 in the same file)

```ts
import { protectedRanges, isProtected } from './narration-spans.js';

export interface BannedTerms {
  fixed: Array<{ find: string; replace: string }>;
  banOnly: string[];
}

/** Split one CSV line into fields, honoring double-quoted fields with commas. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map(s => s.trim());
}

export function parseBannedCsv(csv: string): BannedTerms {
  const fixed: BannedTerms['fixed'] = [];
  const banOnly: string[] = [];
  const lines = String(csv ?? '').split(/\r?\n/).filter(l => l.trim());
  for (const line of lines) {
    const [find = '', replace = ''] = splitCsvLine(line);
    if (!find) continue;
    if (find.toLowerCase() === 'find') continue; // header
    if (replace) fixed.push({ find, replace });
    else banOnly.push(find);
  }
  return { fixed, banOnly };
}

export function mergeBannedTerms(global: BannedTerms, overlay: BannedTerms): BannedTerms {
  const overlayKeys = new Set<string>([
    ...overlay.fixed.map(e => e.find.toLowerCase()),
    ...overlay.banOnly.map(f => f.toLowerCase()),
  ]);
  const fixed = [
    ...global.fixed.filter(e => !overlayKeys.has(e.find.toLowerCase())),
    ...overlay.fixed,
  ];
  const banOnly = [
    ...global.banOnly.filter(f => !overlayKeys.has(f.toLowerCase())),
    ...overlay.banOnly,
  ];
  return { fixed, banOnly };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test --experimental-test-isolation=none tests/unit/deai-banned-terms.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add gateway/src/services/deai/banned-terms.ts tests/unit/deai-banned-terms.test.ts
git commit -m "feat(deai): banned-terms CSV loader + global/overlay merge"
```

**Seed note (do in this task, no test):** create `library/banned-terms.csv` with a header and the spec's examples only:

```
find,replace,bucket
phone buzzed,phone vibrated,personal
delve,,ai
a tapestry of,,ai
```

The full curated import from the author's legacy list is an **owner task** (hand-edited CSV — "Out of scope" in the spec). Wire the first-boot copy of `library/banned-terms.csv` → `workspace/.config/banned-terms.csv` (create-if-absent, never overwrite) into `init/phase-05` alongside the existing skills-overlay migration, or lazily create-if-absent in the loader (Task 11). Do not overwrite an existing global file.

---

## Task 3: `applyBannedTerms` — case-preserving, word-boundary, narration-only, with per-term counts

**Files:**
- Modify: `gateway/src/services/deai/banned-terms.ts`
- Test: `tests/unit/deai-banned-terms.test.ts` (add to the existing file)

**Interfaces:**
- Consumes: `protectedRanges`/`isProtected` (Task 1); `BannedTerms.fixed`.
- Produces: `export interface BannedApplyResult { text: string; counts: Record<string, number>; total: number; }` and `export function applyBannedTerms(text: string, fixed: Array<{find:string;replace:string}>, opts?: { dryRun?: boolean }): BannedApplyResult`.

**Design notes:** case-insensitive match; case-preserving replace (ALL-CAPS match → upper replacement; leading-cap match → capitalized replacement; else replacement as-authored); word-boundary aware (a bare word may not hit inside another word — but multi-word phrases match as written). Skip any match whose start index `isProtected`. `dryRun:true` computes `counts` without mutating (`text` returned equals input). Per-term `counts` keyed by the entry's `find` (spec: prune dead entries).

- [ ] **Step 1: Write the failing test** (append)

```ts
import { applyBannedTerms } from '../../gateway/src/services/deai/banned-terms.js';

test('applyBannedTerms: case-preserving at sentence start', () => {
  const r = applyBannedTerms('Phone buzzed. The phone buzzed again.',
    [{ find: 'phone buzzed', replace: 'phone vibrated' }]);
  assert.equal(r.text, 'Phone vibrated. The phone vibrated again.');
  assert.equal(r.counts['phone buzzed'], 2);
});

test('applyBannedTerms: word-boundary — bare word does not hit inside another word', () => {
  const r = applyBannedTerms('He delved. She will delve.',
    [{ find: 'delve', replace: 'dig' }]);   // "delved" must NOT change
  assert.equal(r.text, 'He delved. She will dig.');
  assert.equal(r.counts['delve'], 1);
});

test('applyBannedTerms: dialogue untouched (banned term inside quotes survives)', () => {
  const r = applyBannedTerms('The phone buzzed. "The phone buzzed," she said.',
    [{ find: 'phone buzzed', replace: 'phone vibrated' }]);
  assert.equal(r.text, 'The phone vibrated. "The phone buzzed," she said.');
  assert.equal(r.counts['phone buzzed'], 1);
});

test('applyBannedTerms: dry-run reports counts without mutating', () => {
  const src = 'The phone buzzed.';
  const r = applyBannedTerms(src, [{ find: 'phone buzzed', replace: 'phone vibrated' }], { dryRun: true });
  assert.equal(r.text, src);
  assert.equal(r.counts['phone buzzed'], 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test --experimental-test-isolation=none tests/unit/deai-banned-terms.test.ts`
Expected: FAIL — `applyBannedTerms is not a function`.

- [ ] **Step 3: Write minimal implementation** (append to `banned-terms.ts`)

```ts
export interface BannedApplyResult { text: string; counts: Record<string, number>; total: number; }

/** Match the casing of `sample` onto `replacement` (all-caps / leading-cap / as-is). */
function preserveCase(sample: string, replacement: string): string {
  if (sample === sample.toUpperCase() && sample !== sample.toLowerCase()) return replacement.toUpperCase();
  if (sample[0] === sample[0]?.toUpperCase() && sample[0] !== sample[0]?.toLowerCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

function escapeRe(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/** Word-boundary literal matcher: \b only when the edge char is a word char. */
function termRegex(find: string): RegExp {
  const w = /\w/;
  const lead = w.test(find[0]) ? '\\b' : '';
  const tail = w.test(find[find.length - 1]) ? '\\b' : '';
  return new RegExp(`${lead}${escapeRe(find)}${tail}`, 'gi');
}

export function applyBannedTerms(
  text: string,
  fixed: Array<{ find: string; replace: string }>,
  opts?: { dryRun?: boolean },
): BannedApplyResult {
  let out = String(text ?? '');
  const counts: Record<string, number> = {};
  let total = 0;
  for (const { find, replace } of fixed) {
    if (!find) continue;
    const re = termRegex(find);
    // Recompute protected ranges each iteration — earlier replacements shift indices.
    const ranges = protectedRanges(out);
    let result = '', last = 0, n = 0;
    for (let m; (m = re.exec(out)); ) {
      if (isProtected(ranges, m.index)) continue;      // skip dialogue/markdown
      result += out.slice(last, m.index) + preserveCase(m[0], replace);
      last = m.index + m[0].length;
      n++;
    }
    result += out.slice(last);
    counts[find] = n; total += n;
    if (!opts?.dryRun && n > 0) out = result;
  }
  return { text: opts?.dryRun ? String(text ?? '') : out, counts, total };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test --experimental-test-isolation=none tests/unit/deai-banned-terms.test.ts`
Expected: PASS (all banned-terms tests).

- [ ] **Step 5: Commit**

```bash
git add gateway/src/services/deai/banned-terms.ts tests/unit/deai-banned-terms.test.ts
git commit -m "feat(deai): applyBannedTerms case-preserving narration-only replace + counts"
```

---

## Task 4: Ban-only forbidden-words injection (narration-scoped)

**Files:**
- Modify: `gateway/src/services/deai/banned-terms.ts`
- Test: `tests/unit/deai-banned-terms.test.ts` (append)

**Interfaces:**
- Consumes: `protectedRanges`/`isProtected` (Task 1), `BannedTerms.banOnly`.
- Produces: `export function forbiddenWordsInNarration(text: string, banOnly: string[]): string[]` (subset of `banOnly` that appears in narration, word-boundary aware) and `export function forbiddenWordsBlock(words: string[]): string` (the prompt block appended to the audit context — empty string when none).

**Design notes:** the audit SKILL already references "the forbidden-words list in your context"; this produces that list, filtered to terms actually present in the window's narration (keeps the LLM's attention tight). Ban-only terms are **never hard-replaced** — they surface only in this injected block.

- [ ] **Step 1: Write the failing test** (append)

```ts
import { forbiddenWordsInNarration, forbiddenWordsBlock } from '../../gateway/src/services/deai/banned-terms.js';

test('forbiddenWordsInNarration: only narration hits, dialogue-only term excluded', () => {
  const text = 'She would delve into it. "It is a tapestry of lies," he said.';
  const got = forbiddenWordsInNarration(text, ['delve', 'a tapestry of', 'smirk']);
  assert.deepEqual(got, ['delve']);   // "a tapestry of" only in dialogue; "smirk" absent
});

test('forbiddenWordsBlock: empty list → empty string', () => {
  assert.equal(forbiddenWordsBlock([]), '');
  assert.match(forbiddenWordsBlock(['delve']), /forbidden/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test --experimental-test-isolation=none tests/unit/deai-banned-terms.test.ts`
Expected: FAIL — not a function.

- [ ] **Step 3: Write minimal implementation** (append)

```ts
export function forbiddenWordsInNarration(text: string, banOnly: string[]): string[] {
  const src = String(text ?? '');
  const ranges = protectedRanges(src);
  const present: string[] = [];
  for (const term of banOnly) {
    if (!term) continue;
    const re = termRegex(term);
    let hit = false;
    for (let m; (m = re.exec(src)); ) { if (!isProtected(ranges, m.index)) { hit = true; break; } }
    if (hit) present.push(term);
  }
  return present;
}

export function forbiddenWordsBlock(words: string[]): string {
  if (!words.length) return '';
  return `\n\n## Forbidden words (remove or rewrite in context — do NOT flag them in dialogue)\n`
    + `These appear in the narration and must be removed or rephrased in place:\n`
    + words.map(w => `- ${w}`).join('\n') + '\n';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test --experimental-test-isolation=none tests/unit/deai-banned-terms.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/services/deai/banned-terms.ts tests/unit/deai-banned-terms.test.ts
git commit -m "feat(deai): ban-only forbidden-words injection (narration-scoped)"
```

---

## Task 5: `chunkChapter` — ~1,000-word windows + seam context

**Files:**
- Create: `gateway/src/services/deai/chunk-chapter.ts`
- Test: `tests/unit/deai-chunk-chapter.test.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces:
  - `export interface DeAiWindow { text: string; seam: string; }` (`seam` = previous window's last paragraph, read-only context; `''` for the first window).
  - `export function chunkChapter(text: string, targetWords?: number): DeAiWindow[]` (default `targetWords = 1000`).

**Design notes:** split into paragraphs on blank lines (reuse the `/\n\s*\n+/` convention from `dialogue-parser.splitParagraphs`, but keep this module dependency-free — copy the one-liner). Also break windows at scene-break lines (`---`). Accumulate paragraphs until the running word count reaches `targetWords`, then close the window at that paragraph boundary (a window MAY run over to avoid splitting a paragraph → never mid-sentence). A chapter < `targetWords` → exactly one window (no behavior change). `seam` of window *i* = last paragraph of window *i-1*.

- [ ] **Step 1: Write the failing test**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunkChapter } from '../../gateway/src/services/deai/chunk-chapter.js';

const para = (n: number, w = 100) => `P${n} ` + Array.from({ length: w }, (_, i) => `w${i}`).join(' ');

test('short chapter (<1000 words) → single window, no seam', () => {
  const text = [para(1, 50), para(2, 50)].join('\n\n');
  const win = chunkChapter(text, 1000);
  assert.equal(win.length, 1);
  assert.equal(win[0].seam, '');
  assert.equal(win[0].text, text);
});

test('splits at paragraph boundaries around the target; never mid-paragraph', () => {
  const paras = Array.from({ length: 12 }, (_, i) => para(i + 1, 100)); // ~1200 words total
  const text = paras.join('\n\n');
  const win = chunkChapter(text, 500);
  assert.ok(win.length >= 2, 'multiple windows');
  // every window is a run of whole paragraphs (each starts with "P")
  for (const w of win) assert.match(w.text.trimStart(), /^P\d+/);
});

test('seam of window N is the last paragraph of window N-1', () => {
  const paras = Array.from({ length: 12 }, (_, i) => para(i + 1, 100));
  const win = chunkChapter(paras.join('\n\n'), 500);
  const prevLastPara = win[0].text.split(/\n\s*\n+/).filter(Boolean).pop();
  assert.equal(win[1].seam, prevLastPara);
});

test('scene break (---) forces a window boundary', () => {
  const text = [para(1, 100), '---', para(2, 100)].join('\n\n');
  const win = chunkChapter(text, 10000); // huge target: only the --- can split it
  assert.equal(win.length, 2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test --experimental-test-isolation=none tests/unit/deai-chunk-chapter.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
export interface DeAiWindow { text: string; seam: string; }

const wc = (s: string) => (s.trim().match(/\S+/g) || []).length;
const isSceneBreak = (p: string) => /^-{3,}$/.test(p.trim());

export function chunkChapter(text: string, targetWords = 1000): DeAiWindow[] {
  const paras = String(text ?? '').split(/\n\s*\n+/).filter(p => p.trim());
  if (paras.length === 0) return [{ text: String(text ?? ''), seam: '' }];

  const groups: string[][] = [];
  let cur: string[] = [];
  let words = 0;
  for (const p of paras) {
    if (isSceneBreak(p)) {                 // scene break closes the current window
      if (cur.length) { groups.push(cur); cur = []; words = 0; }
      cur.push(p);                         // keep the marker with the next window
      continue;
    }
    cur.push(p);
    words += wc(p);
    if (words >= targetWords) { groups.push(cur); cur = []; words = 0; }
  }
  if (cur.length) groups.push(cur);

  const windows: DeAiWindow[] = [];
  let prevLast = '';
  for (const g of groups) {
    windows.push({ text: g.join('\n\n'), seam: prevLast });
    prevLast = g[g.length - 1];
  }
  return windows;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test --experimental-test-isolation=none tests/unit/deai-chunk-chapter.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add gateway/src/services/deai/chunk-chapter.ts tests/unit/deai-chunk-chapter.test.ts
git commit -m "feat(deai): chunkChapter ~1000-word windows + seam context"
```

---

## Task 6: `mergeWindowEdits` — union + dedupe by `find`

**Files:**
- Create: `gateway/src/services/deai/merge-edits.ts`
- Test: `tests/unit/deai-merge-edits.test.ts`

**Interfaces:**
- Consumes: `DeAiEdit` from `../deterministic-apply.js` (type only).
- Produces: `export function mergeWindowEdits(lists: DeAiEdit[][]): DeAiEdit[]` — flatten all windows, keep FIRST occurrence per exact `find` (drops duplicates a seam surfaced twice).

- [ ] **Step 1: Write the failing test**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeWindowEdits } from '../../gateway/src/services/deai/merge-edits.js';
import type { DeAiEdit } from '../../gateway/src/services/deterministic-apply.js';

test('unions windows and drops duplicate finds', () => {
  const a: DeAiEdit[] = [{ op: 'swap', find: 'utilized', replace: 'used' }];
  const b: DeAiEdit[] = [
    { op: 'swap', find: 'utilized', replace: 'used' },        // dup of a[0]
    { op: 'swap', find: 'myriad', replace: 'many' },
  ];
  const merged = mergeWindowEdits([a, b]);
  assert.equal(merged.length, 2);
  assert.deepEqual(merged.map(e => e.find), ['utilized', 'myriad']);
});

test('empty windows → empty list', () => {
  assert.deepEqual(mergeWindowEdits([[], []]), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test --experimental-test-isolation=none tests/unit/deai-merge-edits.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
import type { DeAiEdit } from '../deterministic-apply.js';

export function mergeWindowEdits(lists: DeAiEdit[][]): DeAiEdit[] {
  const seen = new Set<string>();
  const out: DeAiEdit[] = [];
  for (const list of lists) {
    for (const e of list) {
      if (!e?.find || seen.has(e.find)) continue;
      seen.add(e.find);
      out.push(e);
    }
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test --experimental-test-isolation=none tests/unit/deai-merge-edits.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add gateway/src/services/deai/merge-edits.ts tests/unit/deai-merge-edits.test.ts
git commit -m "feat(deai): mergeWindowEdits union + dedupe by find"
```

---

## Task 7: Per-pass model resolution (`deai_pass1` / `deai_pass2`)

**Files:**
- Create: (fold into) `gateway/src/services/deai/sweep.ts` — export `resolveDeaiPassModel`.
- Test: `tests/unit/deai-passmodels.test.ts`

**Interfaces:**
- Consumes: `stageModels` map (`Record<string,{provider?;model?}>`) from the book manifest / live project.
- Produces: `export interface PassModel { provider: string; model: string; } export function resolveDeaiPassModel(stageModels: Record<string, {provider?:string;model?:string}> | undefined, pass: 1 | 2): PassModel`.

**Design notes:** defaults — pass 1 → `{ provider: 'gemini', model: 'auto:newest-gemini' }`, pass 2 → `{ provider: 'openrouter', model: 'auto:newest-haiku' }` (matches the model-id sentinels already used elsewhere; `makeScopedRewriteFn` uses `openrouter`/`auto:newest-haiku`). A set `stageModels.deai_pass1`/`deai_pass2` with a truthy `provider` overrides. **Do NOT read this via `stepRouting`'s `stageModels[step.taskType]` path** — the de-AI audit step's `taskType` is `revision`, which collides with the consistency audit; per-pass models must be resolved by these explicit keys.

- [ ] **Step 1: Write the failing test**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveDeaiPassModel } from '../../gateway/src/services/deai/sweep.js';

test('defaults: pass1 Gemini, pass2 Haiku', () => {
  assert.deepEqual(resolveDeaiPassModel(undefined, 1), { provider: 'gemini', model: 'auto:newest-gemini' });
  assert.deepEqual(resolveDeaiPassModel({}, 2), { provider: 'openrouter', model: 'auto:newest-haiku' });
});

test('stageModels slot overrides the default', () => {
  const sm = { deai_pass1: { provider: 'openrouter', model: 'x/y' } };
  assert.deepEqual(resolveDeaiPassModel(sm, 1), { provider: 'openrouter', model: 'x/y' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test --experimental-test-isolation=none tests/unit/deai-passmodels.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation** (start `sweep.ts` with this export)

```ts
export interface PassModel { provider: string; model: string; }

const DEFAULT_PASS: Record<1 | 2, PassModel> = {
  1: { provider: 'gemini', model: 'auto:newest-gemini' },
  2: { provider: 'openrouter', model: 'auto:newest-haiku' },
};

export function resolveDeaiPassModel(
  stageModels: Record<string, { provider?: string; model?: string }> | undefined,
  pass: 1 | 2,
): PassModel {
  const pin = stageModels?.[`deai_pass${pass}`];
  const def = DEFAULT_PASS[pass];
  if (pin?.provider) return { provider: pin.provider, model: pin.model || def.model };
  return def;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test --experimental-test-isolation=none tests/unit/deai-passmodels.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add gateway/src/services/deai/sweep.ts tests/unit/deai-passmodels.test.ts
git commit -m "feat(deai): per-pass model resolution (deai_pass1/deai_pass2 defaults + override)"
```

---

## Task 8: Second-reader pass-2 prompt framing + `runChunkedDeAiSweep` orchestrator

**Files:**
- Modify: `gateway/src/services/deai/sweep.ts`
- Test: `tests/unit/deai-sweep.test.ts`

**Interfaces:**
- Consumes: `chunkChapter` (Task 5), `mergeWindowEdits` (Task 6), `applyBannedTerms`/`forbiddenWordsInNarration`/`forbiddenWordsBlock` (Tasks 3/4), `DeAiEdit`/`ApplyResult` (deterministic-apply, unchanged).
- Produces:
  - `export function secondReaderFraming(): string` — the pass-2 attention-redirect preamble.
  - `export interface SweepDeps { auditWindow: (args: { windowText: string; seam: string; pass: 1|2; forbiddenBlock: string }) => Promise<DeAiEdit[]>; applyEdits: (base: string, edits: DeAiEdit[]) => Promise<ApplyResult>; }`
  - `export interface SweepResult { text: string; passes: number; bannedCounts: Record<string, number>; passStats: ApplyResult[]; }`
  - `export async function runChunkedDeAiSweep(args: { draft: string; banned: BannedTerms; stageModels?: ...; deps: SweepDeps; targetWords?: number }): Promise<SweepResult>`

**Design notes (the whole feature composed):**
1. Apply banned-terms fixed subs to the draft (`applyBannedTerms`) → `working`; record `bannedCounts`.
2. Compute `forbiddenBlock` once from `working` (ban-only terms present in narration).
3. **Pass 1:** `chunkChapter(working)`; for each window call `deps.auditWindow({windowText, seam, pass:1, forbiddenBlock})`; a thrown window is caught → `[]` + `⚠` log (fail-soft). Merge; if empty → **short-circuit** (skip apply, skip pass 2, `passes:1`). Else `deps.applyEdits(working, merged)` → `working`.
4. **Pass 2** (only if pass 1 applied ≥1 edit): re-chunk the applied `working`; `auditWindow({..., pass:2, forbiddenBlock})` (deps prepend `secondReaderFraming()` for pass 2 — the framing text is passed via `pass` so the caller/deps decide). Merge; empty → short-circuit (`passes:2` but no apply). Else apply once.
5. Cap at 2 passes always. Return final `working`, `passes`, `bannedCounts`, per-pass `ApplyResult[]`.

`auditWindow` and `applyEdits` are injected so this is fully unit-testable with fakes and NO model/router import. In production (Task 11) `applyEdits` = `applyDeAiEdits(base, edits, makeScopedRewriteFn(...))` and `auditWindow` calls the router with the window text + seam + skill + forbidden block + (pass 2) `secondReaderFraming()`.

- [ ] **Step 1: Write the failing test**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runChunkedDeAiSweep, secondReaderFraming } from '../../gateway/src/services/deai/sweep.js';
import { parseBannedCsv } from '../../gateway/src/services/deai/banned-terms.js';
import { applyDeAiEdits } from '../../gateway/src/services/deterministic-apply.js';
import type { DeAiEdit } from '../../gateway/src/services/deterministic-apply.js';

const applyEdits = (base: string, edits: DeAiEdit[]) => applyDeAiEdits(base, edits); // real applier, no rewriteFn

test('banned-terms run first; dialogue preserved end-to-end; empty audits short-circuit', async () => {
  const banned = parseBannedCsv('find,replace\nphone buzzed,phone vibrated');
  const draft = 'The phone buzzed. "The phone buzzed," she said.';
  const res = await runChunkedDeAiSweep({
    draft, banned,
    deps: { auditWindow: async () => [], applyEdits },
  });
  assert.equal(res.text, 'The phone vibrated. "The phone buzzed," she said.');
  assert.equal(res.passes, 1);                 // empty pass-1 merge → short-circuit
  assert.equal(res.bannedCounts['phone buzzed'], 1);
});

test('two passes run when pass 1 yields edits; capped at 2', async () => {
  const banned = parseBannedCsv('find,replace');
  const draft = 'She utilized it. Then she leveraged it.';
  let calls = 0;
  const auditWindow = async ({ pass }: { pass: 1 | 2 }): Promise<DeAiEdit[]> => {
    calls++;
    if (pass === 1) return [{ op: 'swap', find: 'utilized', replace: 'used' }];
    return [{ op: 'swap', find: 'leveraged', replace: 'used' }];
  };
  const res = await runChunkedDeAiSweep({ draft, banned, deps: { auditWindow, applyEdits } });
  assert.equal(res.text, 'She used it. Then she used it.');
  assert.equal(res.passes, 2);
  assert.ok(calls >= 2 && calls <= 4, 'no third pass');
});

test('a thrown window audit is fail-soft (skipped, not fatal)', async () => {
  const banned = parseBannedCsv('find,replace');
  const res = await runChunkedDeAiSweep({
    draft: 'She utilized it.', banned,
    deps: { auditWindow: async () => { throw new Error('boom'); }, applyEdits },
  });
  assert.equal(res.text, 'She utilized it.'); // no crash, no edits
  assert.equal(res.passes, 1);
});

test('secondReaderFraming redirects to subtle residue', () => {
  assert.match(secondReaderFraming(), /residue|subtler|button|already/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test --experimental-test-isolation=none tests/unit/deai-sweep.test.ts`
Expected: FAIL — `runChunkedDeAiSweep`/`secondReaderFraming` not exported.

- [ ] **Step 3: Write minimal implementation** (append to `sweep.ts`)

```ts
import { chunkChapter } from './chunk-chapter.js';
import { mergeWindowEdits } from './merge-edits.js';
import { applyBannedTerms, forbiddenWordsInNarration, forbiddenWordsBlock, type BannedTerms } from './banned-terms.js';
import type { DeAiEdit, ApplyResult } from '../deterministic-apply.js';

export function secondReaderFraming(): string {
  return 'SECOND-READER PASS: the obvious AI tells are already gone. Hunt only the '
    + 'subtler residue that survives a first edit — sententious "button" one-liners, '
    + 'echo rhythms between adjacent sentences, generalizing second-person asides, and '
    + 'quiet rule-of-three balance. Emit an edit ONLY for genuine residue; if the '
    + 'window is clean, return [].';
}

export interface SweepDeps {
  auditWindow: (args: { windowText: string; seam: string; pass: 1 | 2; forbiddenBlock: string }) => Promise<DeAiEdit[]>;
  applyEdits: (base: string, edits: DeAiEdit[]) => Promise<ApplyResult>;
}
export interface SweepResult { text: string; passes: number; bannedCounts: Record<string, number>; passStats: ApplyResult[]; }

async function auditAllWindows(working: string, pass: 1 | 2, forbiddenBlock: string, deps: SweepDeps, targetWords: number): Promise<DeAiEdit[]> {
  const windows = chunkChapter(working, targetWords);
  const lists: DeAiEdit[][] = [];
  for (const w of windows) {
    try { lists.push(await deps.auditWindow({ windowText: w.text, seam: w.seam, pass, forbiddenBlock })); }
    catch (e) { console.log(`  ⚠ deai pass ${pass} window audit failed — skipped: ${(e as Error).message}`); lists.push([]); }
  }
  return mergeWindowEdits(lists);
}

export async function runChunkedDeAiSweep(args: {
  draft: string; banned: BannedTerms;
  stageModels?: Record<string, { provider?: string; model?: string }>;
  deps: SweepDeps; targetWords?: number;
}): Promise<SweepResult> {
  const targetWords = args.targetWords ?? 1000;
  const passStats: ApplyResult[] = [];

  // Stage 0: deterministic banned-terms replace (narration only).
  const banned = applyBannedTerms(args.draft, args.banned.fixed);
  let working = banned.text;
  const forbiddenBlock = forbiddenWordsBlock(forbiddenWordsInNarration(working, args.banned.banOnly));

  // Pass 1.
  const merged1 = await auditAllWindows(working, 1, forbiddenBlock, args.deps, targetWords);
  if (merged1.length === 0) return { text: working, passes: 1, bannedCounts: banned.counts, passStats };
  const r1 = await args.deps.applyEdits(working, merged1);
  passStats.push(r1); working = r1.text;

  // Pass 2 (second reader) — re-window the applied text.
  const merged2 = await auditAllWindows(working, 2, forbiddenBlock, args.deps, targetWords);
  if (merged2.length === 0) return { text: working, passes: 2, bannedCounts: banned.counts, passStats };
  const r2 = await args.deps.applyEdits(working, merged2);
  passStats.push(r2); working = r2.text;

  return { text: working, passes: 2, bannedCounts: banned.counts, passStats };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test --experimental-test-isolation=none tests/unit/deai-sweep.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add gateway/src/services/deai/sweep.ts tests/unit/deai-sweep.test.ts
git commit -m "feat(deai): runChunkedDeAiSweep orchestrator + second-reader framing (cap 2, short-circuit, fail-soft)"
```

---

## Task 9: Broaden the de-AI audit taxonomy

**Files:**
- Modify: `skills/author/romance-deai-audit/SKILL.md`
- Test: `tests/unit/deai-ch1-fixture.test.ts` (assertion on skill content — created here, extended in Task 10)

**Interfaces:**
- Consumes: nothing.
- Produces: two new named categories in the skill's "What to flag" section.

**Design notes:** the skill is prompt-injected text; the "test" for a prompt is a presence assertion (the model can't be unit-tested, but a missing category is a regression we CAN catch). Add both categories from spec §1. Also check the **spicy twin** — grep confirmed only `romance-deai-audit` references the de-AI audit; there is no separate spicy de-AI skill, so only this file changes.

- [ ] **Step 1: Write the failing test**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const skill = readFileSync(fileURLToPath(new URL(
  '../../skills/author/romance-deai-audit/SKILL.md', import.meta.url)), 'utf8');

test('taxonomy names aphoristic-button and generalizing-second-person', () => {
  assert.match(skill, /aphoristic-button|sententious/i);
  assert.match(skill, /generalizing-second-person/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test --experimental-test-isolation=none tests/unit/deai-ch1-fixture.test.ts`
Expected: FAIL — patterns not present.

- [ ] **Step 3: Edit the skill** — add under "Use a `rewrite` ONLY when there is no clean literal replacement:" (after the `echo-line` bullet, before `## Rules`):

```markdown
- **aphoristic-button / sententious one-liner** — a short declarative that buttons
  a paragraph or scene with a "profound" generalization ("That's the thing about
  Fran." / "That's as close to praying as I get.") → instruction: ground it in the
  concrete beat, similar length, or cut.
- **generalizing-second-person** — a "you"-addressed general truth used as interior
  narration ("You don't stand around listening to bad news. You pull dough.") →
  instruction: return to the narrator's specific first person, similar length.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test --experimental-test-isolation=none tests/unit/deai-ch1-fixture.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add skills/author/romance-deai-audit/SKILL.md tests/unit/deai-ch1-fixture.test.ts
git commit -m "feat(deai): broaden taxonomy — aphoristic-button + generalizing-second-person"
```

---

## Task 10: ch1 fixture regression (mechanics: leak #2 categories + rule-of-three → 0 after 2 passes)

**Files:**
- Create: `tests/unit/fixtures/deai-ch1.md`
- Modify: `tests/unit/deai-ch1-fixture.test.ts`

**Interfaces:**
- Consumes: `runChunkedDeAiSweep` (Task 8), `parseBannedCsv` (Task 2), real `applyDeAiEdits`.
- Produces: a regression proving the SWEEP MECHANICS drive residual tells to 0 across two passes given canned per-category audits.

**Design notes / honest limitation:** unit tests cannot invoke a real LLM, so this test does NOT prove Gemini/Haiku *judgment*. It proves the **mechanics**: with a canned `auditWindow` that emits the new-taxonomy categories in pass 1 and a residual rule-of-three in pass 2, the two-pass sweep removes ALL of them from the fixture. The fixture embeds the exact offending lines from spec §Problem (aphoristic buttons, generalizing second-person, and 7 rule-of-three instances where pass 1 catches 3 and pass 2 catches the rest — the leak-#1 scenario).

- [ ] **Step 1: Write the fixture** `tests/unit/fixtures/deai-ch1.md` (narration with the spec's tells; keep it short but include ≥4 rule-of-three lists, both aphoristic buttons, and one generalizing-second-person pair, plus one line inside quotes that must survive). Example skeleton (fill to ~1,200 words so it chunks into ≥2 windows):

```markdown
She moved through the kitchen, quick, clean, and precise. The dough was warm, soft, and alive.
That's the thing about Fran.

You don't stand around listening to bad news. You pull dough.

"That's as close to praying as I get," she said, not meaning it as narration.

The oven ticked, hummed, and settled. Flour, sugar, and salt waited on the counter.
```

- [ ] **Step 2: Write the failing test** (append to `deai-ch1-fixture.test.ts`)

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runChunkedDeAiSweep } from '../../gateway/src/services/deai/sweep.js';
import { parseBannedCsv } from '../../gateway/src/services/deai/banned-terms.js';
import { applyDeAiEdits, type DeAiEdit } from '../../gateway/src/services/deterministic-apply.js';

const ch1 = readFileSync(fileURLToPath(new URL('./fixtures/deai-ch1.md', import.meta.url)), 'utf8');
const RULE_OF_THREE = /\b\w+, \w+, and \w+\b/g;

test('two passes drive rule-of-three lists and leak-#2 buttons to 0 in the fixture', async () => {
  const before = (ch1.match(RULE_OF_THREE) || []).length;
  assert.ok(before >= 3, 'fixture seeds several rule-of-three lists');

  // Canned auditor: pass 1 flags HALF the rule-of-three + both buttons + the
  // second-person pair (top-N leak); pass 2 (second reader) flags the residue.
  const flagThree = (text: string, take: number): DeAiEdit[] =>
    Array.from(text.matchAll(RULE_OF_THREE)).slice(0, take).map(m => ({
      op: 'swap' as const, find: m[0], replace: m[0].replace(/, and /, ' and ').replace(/, \w+ and/, ' and'),
    }));
  const auditWindow = async ({ windowText, pass }: { windowText: string; pass: 1 | 2 }): Promise<DeAiEdit[]> => {
    const all = Array.from(windowText.matchAll(RULE_OF_THREE)).map(m => m[0]);
    const half = Math.ceil(all.length / 2);
    const edits = pass === 1 ? flagThree(windowText, half) : flagThree(windowText, all.length);
    if (pass === 1) {
      if (windowText.includes("That's the thing about Fran."))
        edits.push({ op: 'rewrite', find: "That's the thing about Fran.", instruction: 'ground in the beat' });
      if (windowText.includes('You pull dough.'))
        edits.push({ op: 'rewrite', find: 'You pull dough.', instruction: 'return to first person' });
    }
    return edits;
  };
  const rewriteFn = async (span: string) => span.replace(/^That's.*/, 'She wiped her hands.').replace(/^You pull dough\.$/, 'I pull dough.');
  const applyEdits = (base: string, edits: DeAiEdit[]) => applyDeAiEdits(base, edits, rewriteFn);

  const res = await runChunkedDeAiSweep({ draft: ch1, banned: parseBannedCsv('find,replace'), deps: { auditWindow, applyEdits } });
  assert.equal((res.text.match(RULE_OF_THREE) || []).length, 0, 'no rule-of-three survives 2 passes');
  assert.ok(!res.text.includes("That's the thing about Fran."), 'aphoristic button removed');
  assert.equal(res.passes, 2);
  // dialogue line preserved
  assert.ok(res.text.includes('"That's as close to praying as I get,"'), 'dialogue untouched');
});
```

- [ ] **Step 3: Run test to verify it fails, then passes**

Run: `node --import tsx --test --experimental-test-isolation=none tests/unit/deai-ch1-fixture.test.ts`
Expected: FAILS first if the fixture/mechanics are wrong; adjust the fixture until PASS. (No product code changes — this test validates Tasks 5/6/8 against a realistic chapter.)

- [ ] **Step 4: Commit**

```bash
git add tests/unit/fixtures/deai-ch1.md tests/unit/deai-ch1-fixture.test.ts
git commit -m "test(deai): ch1 fixture regression — 2-pass sweep clears leak #1 + #2 mechanics"
```

---

## Task 11: Wiring — book manifest slots, routes interception, pipeline JSON

**Files:**
- Modify: `gateway/src/api/routes/books.routes.ts:288` (stage-key regex)
- Modify: `gateway/src/services/book.ts:50`, `gateway/src/services/book-types.ts:66` (doc-comment the two new slots — no type change; `Record<string,...>` already admits them)
- Modify: `gateway/src/api/routes/projects.routes.ts` (two audit-step paths)
- Modify: `library/pipelines/romance-sweet-deterministic.json` + `romance-spicy-deterministic.json`
- Modify: `gateway/src/services/deai/banned-terms.ts` (add a filesystem loader `loadBannedTermsForBook(workspaceDir, slug)` that reads global + overlay CSVs, create-if-absent for the global from `library/banned-terms.csv`)
- Test: `tests/smoke-test.sh` unaffected; add a targeted assertion via the existing `tests/unit/book-budget-wiring.test.ts` pattern if a manifest round-trip test is cheap. Manual verify on Mercury.

**⚠ Pipeline-shape decision (RESOLVE BEFORE CODING — see Risks §R1).** The spec is internally inconsistent (§3 "→ apply → … → apply" = two applies; the components table says "one apply per chapter"). **Recommended resolution:** collapse the current `romance-deai-audit` + `deterministic-apply` chapter steps into ONE self-contained step whose executor calls `runChunkedDeAiSweep` and returns the final humanized chapter text. This keeps the seam changes inside a single `else if (skill === 'romance-deai-audit')` branch, avoids two half-integrated apply steps, and does NOT disturb the separate `consistency-audit → apply` pair (which the Canon Drift Gate also relies on). The `deterministic-apply` step that follows the de-AI audit today becomes the **consistency-only** apply (its `runDeterministicApply` still gathers the consistency audit); the de-AI branch does its own banned-terms + two-pass + apply internally. Confirm this ordering with the owner if it conflicts with the Canon Drift Gate reorder.

- [ ] **Step 1: Relax the stage-key regex** — `books.routes.ts:288`:

```ts
if (!/^[a-z0-9_]{1,40}$/.test(k)) return res.status(400).json({ error: `invalid stage key: ${k}` });
```
(`deai_pass1`/`deai_pass2` contain digits; the current `[a-z_]` rejects them.) Add a one-line unit assertion in an existing routes-medium test if trivial; otherwise verify via curl in Step 5.

- [ ] **Step 2: Add the filesystem loader** to `banned-terms.ts`:

```ts
import { readFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';

/** Load global (create-if-absent from the committed seed) + per-book overlay. */
export function loadBannedTermsForBook(workspaceDir: string, slug: string, seedCsvPath: string): BannedTerms {
  const globalPath = join(workspaceDir, '.config', 'banned-terms.csv');
  if (!existsSync(globalPath) && existsSync(seedCsvPath)) {
    try { mkdirSync(join(workspaceDir, '.config'), { recursive: true }); copyFileSync(seedCsvPath, globalPath); } catch { /* fail-soft */ }
  }
  const readCsv = (p: string): BannedTerms => existsSync(p) ? parseBannedCsv(readFileSync(p, 'utf8')) : { fixed: [], banOnly: [] };
  const global = readCsv(globalPath);
  const overlay = readCsv(join(workspaceDir, 'books', slug, 'banned-terms.csv'));
  return mergeBannedTerms(global, overlay);
}
```

- [ ] **Step 3: Intercept the de-AI audit step** in `projects.routes.ts` (both the studio path ~626 and the auto-execute path ~1114, mirroring the existing `deterministic-apply` branch). In the de-AI audit branch:
  - find the chapter draft the same way `runDeterministicApply` does (`role === 'draft'`, `chapterNumber === N`, completed);
  - `const banned = loadBannedTermsForBook(services.config.workspaceDir, project.bookSlug, <seed path>)`;
  - build `deps.auditWindow` = a router call using `resolveDeaiPassModel(project.stageModels, pass)`, the `romance-deai-audit` skill content, the window text + seam-as-read-only-context + `forbiddenBlock`, and (pass 2) prepend `secondReaderFraming()`;
  - `deps.applyEdits = (base, edits) => applyDeAiEdits(base, edits, makeScopedRewriteFn((r) => services.aiRouter.complete(r)))`;
  - `const { text, passes, bannedCounts, passStats } = await runChunkedDeAiSweep({ draft, banned, stageModels: project.stageModels, deps })`;
  - set the step `response = text`; `console.log` the pass count + banned per-term counts + apply stats (mirrors the existing `  ✓ deterministic-apply …` log line).
  - Guard: the step's `taskType` stays `revision`; `isAuditStep` remains true so the short-response retry is skipped (the sweep may legitimately return a near-identical chapter).

- [ ] **Step 4: Update the two pipeline JSONs** per the R1 resolution: the `romance-deai-audit` step now carries the final humanized chapter (its executor is the sweep); drop or repurpose the trailing `deterministic-apply` step to consistency-only. Keep `modelOverride` OFF the de-AI step (per-pass models come from `stageModels`/defaults, not the step). **Coordinate this JSON edit with the Canon Drift Gate's reorder — land one, rebase the other.**

- [ ] **Step 5: Verify (manual, scripted where possible)**
  - Type-check: `npx tsc --noEmit` → no errors.
  - Full unit suite: `node --import tsx --test --experimental-test-isolation=none tests/unit/*.test.ts` → all pass.
  - Stage-key round-trip: `POST /api/books/:slug/model-config` with `{"stageModels":{"deai_pass1":{"provider":"gemini"}}}` → `200` and echoed back in `GET`.
  - Deploy to Mercury (`touch build_now`) and run one real chapter through a `romance-*-deterministic` pipeline; confirm the log shows `passes=2` (or a short-circuit), banned per-term counts, and the chapter length is within a few % of the draft.

- [ ] **Step 6: Commit**

```bash
git add gateway/src/api/routes/books.routes.ts gateway/src/services/book.ts gateway/src/services/book-types.ts \
        gateway/src/api/routes/projects.routes.ts gateway/src/services/deai/banned-terms.ts \
        library/pipelines/romance-sweet-deterministic.json library/pipelines/romance-spicy-deterministic.json \
        library/banned-terms.csv
git commit -m "feat(deai): wire chunked two-pass sweep + banned-terms into the de-AI audit step; deai_pass1/2 stage slots"
```

---

## Task 12: Docs — TODO/COMPLETED + SECURITY posture note

**Files:**
- Modify: `docs/TODO.md` → move this feature to `docs/COMPLETED.md` with the `2026-07-14` date (per CLAUDE.md feature-tracking rule).
- Modify: `docs/COMPLETED.md`.

- [ ] **Step 1:** Add the feature bullet to `docs/TODO.md` first if it isn't already tracked (CLAUDE.md requires it be tracked before work).
- [ ] **Step 2:** On completion move it to `docs/COMPLETED.md` with `2026-07-14`, preserving the bullet text.
- [ ] **Step 3: Commit**

```bash
git add docs/TODO.md docs/COMPLETED.md
git commit -m "docs(deai): move chunked two-pass de-AI + banned-terms to COMPLETED"
```

---

## Self-Review

**Spec coverage:**
- §0 banned-terms deterministic pass → Tasks 1–4 (span mask, CSV loader+overlay, applyBannedTerms case/boundary/dialogue, dry-run+counts) + Task 11 (fs loader + wiring). ✓
- §0 ban-only forbidden-words injection, narration-only → Task 4 + orchestrator Task 8. ✓
- §1 taxonomy broadening → Task 9. ✓
- §2 chunkChapter + seam → Task 5. ✓
- §2 merge + apply-once-per-pass → Task 6 + Task 8. ✓
- §3 two-pass, second-reader, cap 2, short-circuit, fail-soft → Task 8. ✓
- §4 per-pass model config `deai_pass1/2` defaults + override → Task 7 + Task 11 (regex + slots). ✓
- Testing (all bullets) → Tasks 1–8 unit tests + Task 10 fixture regression. ✓

**Placeholder scan:** every code step has concrete code; the one deliberately deferred item (the full curated word list import) is flagged as an owner task per the spec's own "Out of scope". No "TBD"/"add error handling"/"similar to Task N".

**Type consistency:** `DeAiEdit`/`ApplyResult` imported unchanged from `deterministic-apply.js`; `BannedTerms`/`BannedApplyResult`/`DeAiWindow`/`PassModel`/`SweepDeps`/`SweepResult` names used consistently across Tasks 2–8 and 11. `applyBannedTerms`, `chunkChapter`, `mergeWindowEdits`, `resolveDeaiPassModel`, `runChunkedDeAiSweep`, `secondReaderFraming`, `forbiddenWordsInNarration`, `forbiddenWordsBlock`, `loadBannedTermsForBook` — each defined once, consumed by name.

---

## Risks / under-specified points (with recommended resolutions)

- **R1 — Pipeline shape: one apply or two? (BLOCKING for Task 11).** Spec §3 says two applies; the components table says one. **Resolution:** encapsulate banned-terms + both passes + their applies inside the single `romance-deai-audit` step executor via `runChunkedDeAiSweep` (returns final text), leaving the existing `deterministic-apply` step as consistency-only. This isolates the change, honors "audit→apply contract unchanged" (the module is untouched; we just call it twice internally), and minimizes overlap with Canon Drift Gate. Confirm with owner.
- **R2 — Existing dialogue/markdown span helper?** A shared **paragraph-level** dialogue detector exists (`gateway/src/services/dialogue-parser.ts`: `splitParagraphs`, `startsWithQuote`, `extractSpokenText`, quote set `" “ ”`). It is NOT an inline character-range mask, so Task 1 builds `narration-spans.ts` (reusing the same quote set + the `extractSpokenText` regex idea). **Do not** reuse `startsWithQuote` for banned-terms — it would skip whole dialogue paragraphs but miss inline mid-paragraph quotes, and wouldn't cover Markdown. New shared helper is the right call; both the replace and the ban-only injection consume it (one source of "protected").
- **R3 — stageModels taskType collision.** de-AI audit and consistency audit are BOTH `taskType: revision`, so `stepRouting`'s `stageModels[taskType]` cannot distinguish passes. **Resolution (Task 7/11):** resolve `deai_pass1/2` by explicit key inside the sweep wiring, NOT via `stepRouting`. Also note `stepRouting` would otherwise apply a `revision` pin to the de-AI step — the interception branch bypasses `stepRouting` for model choice entirely.
- **R4 — Stage-key regex rejects digits.** `books.routes.ts:288` `/^[a-z_]{1,40}$/` would 400 on `deai_pass1`. **Resolution:** relax to `/^[a-z0-9_]{1,40}$/` (Task 11 Step 1). Verified against the live code.
- **R5 — Spec says de-AI routes to "Gemini-Pro"; the pipeline JSON actually pins `auto:newest-sonnet`.** The design's §4 note ("de-AI→Gemini-Pro") does not match `romance-sweet-deterministic.json:96` (`auto:newest-sonnet`). **Resolution:** the new per-pass defaults (Gemini pass 1 / Haiku pass 2) supersede the JSON `modelOverride`; drop `modelOverride` from the de-AI step (Task 11 Step 4) so `resolveDeaiPassModel` governs. Flag the discrepancy to the owner in case Sonnet was a deliberate recent change.
- **R6 — Case-preserving multi-word phrases.** `preserveCase` keys off the matched substring's first char / all-caps. For a phrase like "Phone Buzzed" mid-sentence the leading-cap branch capitalizes only the replacement's first word — acceptable for the spec's example ("Phone vibrated"). Title-case phrase matches are rare; note as a known limitation, not a defect.
- **R7 — Word-count vs token windows.** Chunking targets ~1,000 *words* at paragraph boundaries (spec §2), not tokens. A pathological single 3,000-word paragraph yields one over-size window — acceptable (never split mid-paragraph is the harder constraint) and matches the author's manual method. No mitigation needed for v1.
- **R8 — Fixture regression proves mechanics, not model judgment.** Unit tests can't call Gemini/Haiku. Task 10 uses a canned auditor to prove the two-pass sweep removes all seeded tells and preserves dialogue. Real detection recall is verified manually on Mercury (Task 11 Step 5). This is the correct boundary for a no-LLM-in-CI suite.
- **R9 — Canon Drift Gate JSON overlap.** Both features edit the two `romance-*-deterministic.json` step arrays. **Resolution:** serialize the pipeline-JSON edits (land one feature fully, rebase the other by hand); Tasks 1–10 here have zero overlap and can proceed in parallel.
