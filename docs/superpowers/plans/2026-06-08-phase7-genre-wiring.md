# Phase 7 — Genre Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Inject the active book's genre guide (tropes / themes / beats+obligatory-scenes / reader-expectations / must-haves / genre-killers / comps) into generation prompts alongside Author and Voice, so a book genuinely writes in its own genre.

**Architecture:** Genre is already snapshotted into `workspace/books/<slug>/templates/genre/*.md` but unread. Add a sync `BookService.getActiveGenreGuide()` that concatenates the active book's genre `.md` files in a fixed canonical order with section headers, and thread it through the single system-prompt chokepoint `BookClawGateway.buildSystemPrompt(...)` (where Author/Voice already enter via `getFullContext()`). Decision (owner-confirmed): inject the **whole guide everywhere**, composition lives in **BookService**, and the guide is **multiple files** (keep 4 existing, add 3). Spec: [docs/superpowers/specs/2026-06-08-phase7-genre-wiring-design.md](../specs/2026-06-08-phase7-genre-wiring-design.md).

**Tech Stack:** Node 22 + TypeScript (run via `tsx`, `.js` import extensions, `NodeNext`). Tests: `node --test` via `tsx` over `tests/unit/*.test.ts`; bash `tests/feature-smoke.sh` against the live container.

> **Repo workflow — do NOT `git commit`/`git push`.** Per `CLAUDE.md`, the implementer writes a `commit_message` file at the repo root; the maintainer runs `./push.sh`. Work happens directly on `main`. "Commit" is therefore replaced throughout by a **verification gate** (run the listed command, confirm the expected output) plus a single `commit_message` write in the final task. Deploy = `touch build_now` (Mercury's timer builds the working tree).

> **Canonical constants used across tasks (must match exactly):**
> - File order: `reader-expectations`, `tropes`, `themes`, `beats`, `must-haves`, `genre-killers`, `comps`.
> - Section titles: `reader-expectations`→`Reader Expectations`, `tropes`→`Tropes`, `themes`→`Themes`, `beats`→`Beats & Obligatory Scenes`, `must-haves`→`Must-Haves`, `genre-killers`→`Genre Killers`, `comps`→`Comparable Titles`.
> - Per-section header in the composed string: `## Genre Guide — <Title>`.
> - System-prompt block header (added by `buildSystemPrompt`): `# Active Book — Genre Guide`.

---

## File Structure

- **Create** `docs/GENRE-GUIDE-TEMPLATE.md` — the authoring reference for the 7-file genre guide (what each file is for). Documentation only; not a selectable genre.
- **Create** `library/genres/romantasy/themes.md`, `library/genres/romantasy/must-haves.md`, `library/genres/romantasy/genre-killers.md` — the new guide files for the worked example.
- **Modify** `library/genres/romantasy/reader-expectations.md`, `library/genres/romantasy/beats.md` — append the research-backed sections (tone/pacing/setting/archetypes/length; named obligatory scenes).
- **Create** `tests/unit/genre-guide.test.ts` — unit tests for `BookService.getActiveGenreGuide()`.
- **Modify** `gateway/src/services/book.ts` — add `getActiveGenreGuide()`.
- **Modify** `gateway/src/index.ts` — add `genreGuide` to `buildSystemPrompt`'s context type + render the block; pass `this.books?.getActiveGenreGuide()` at the call site.
- **Modify** `tests/feature-smoke.sh` — add a deterministic genre-injection (sentinel-echo) assertion.
- **Modify** `CLAUDE.md`, `docs/TODO.md`, `docs/COMPLETED.md`; write `commit_message`.

---

## Task 1: Genre guide content schema + romantasy worked example

No code changes — content only. The genre kind reads any `.md` in the dir (`LibraryService.loadKind`, `gateway/src/services/library.ts:240`), so new files need no library/snapshot/re-pull changes.

**Files:**
- Create: `docs/GENRE-GUIDE-TEMPLATE.md`
- Create: `library/genres/romantasy/themes.md`
- Create: `library/genres/romantasy/must-haves.md`
- Create: `library/genres/romantasy/genre-killers.md`
- Modify: `library/genres/romantasy/reader-expectations.md` (append)
- Modify: `library/genres/romantasy/beats.md` (append)

- [ ] **Step 1: Write the genre-guide authoring reference**

Create `docs/GENRE-GUIDE-TEMPLATE.md`:

```markdown
# Genre Guide Template

A genre in BookClaw is a directory of markdown files under `library/genres/<name>/`
(built-in) or `workspace/library/genres/<name>/` (user overlay). Every `.md` file in
the directory is snapshotted into a book at create time and injected into generation
prompts (Phase 7). Use these seven canonical files; each opens with a one-line summary
so it reads well when concatenated into a prompt.

| File | Role — what it answers |
|------|------------------------|
| `reader-expectations.md` | Genre expectations + reader promise: tone & mood, pacing, setting conventions, character archetypes/roles, and length/format norms (POV, word-count band, heat/age category). Descriptive — what the genre *feels like*. |
| `tropes.md` | Common tropes (recurring devices/situations readers love) and how to keep them fresh. Optional flavor — pick a few. |
| `themes.md` | The ideas/values the genre explores (e.g. found family, redemption, power & corruption). |
| `beats.md` | Structural beats and **obligatory scenes**: the plot set-pieces, in rough order, readers would feel cheated without. |
| `must-haves.md` | A tight, action-oriented checklist of non-negotiables — "skip these and it isn't really this genre." |
| `genre-killers.md` | The anti-checklist — what makes genre readers DNF or one-star a book. |
| `comps.md` | Comparable titles and *why* they work; a source for deriving obligatory scenes. |

Files are injected in this order: reader-expectations, tropes, themes, beats,
must-haves, genre-killers, comps. A genre may omit files; missing ones are skipped.
The per-genre `meta.json` `description` (Phase 6e) is separate and describes the genre
as a whole.
```

- [ ] **Step 2: Create `themes.md` for romantasy**

Create `library/genres/romantasy/themes.md`:

```markdown
# Romantasy — Themes

Recurring ideas and values a romantasy explores. Choose two or three to anchor the book.

- **Love as power** — the central relationship reshapes magic, politics, or fate; intimacy and agency are intertwined.
- **Found family** — a ragtag court, crew, or coven becomes the protagonist's true belonging.
- **Self-sovereignty** — a heroine claims her own power, throne, or magic against those who would use her.
- **Fate vs. choice** — bonds, prophecies, or mate-marks pull against the characters' freedom to choose each other.
- **Sacrifice and worthiness** — love is proven through cost; the grand gesture is earned, not given.
- **Belonging across difference** — mortal/fae, rival courts, enemy kingdoms: love bridges a divide the world says is impossible.
```

- [ ] **Step 3: Create `must-haves.md` for romantasy**

Create `library/genres/romantasy/must-haves.md`:

```markdown
# Romantasy — Must-Haves (non-negotiable checklist)

Every romantasy MUST deliver all of these. Treat as a revision checklist.

- [ ] A central romance that is the spine of the book, not a subplot.
- [ ] An emotionally satisfying romantic resolution — HEA (happily ever after) or HFN (happy for now). The couple ends together and hopeful.
- [ ] Both leads on the page together often, with rising attraction and real obstacles between them.
- [ ] A magic system or fantastical world that materially affects the relationship (not just set dressing).
- [ ] Genuine relationship stakes: what each character risks by loving the other.
- [ ] A midpoint shift in intimacy or trust, and a dark moment (~75%) that forces the couple apart.
- [ ] A grand gesture / reunion that earns the ending through sacrifice or change.
- [ ] Consistent heat level matching the book's promise (sweet → explicit), set early and sustained.
```

- [ ] **Step 4: Create `genre-killers.md` for romantasy**

Create `library/genres/romantasy/genre-killers.md`:

```markdown
# Romantasy — Genre Killers (avoid; these make readers DNF or one-star)

- **No HEA/HFN.** A tragic or ambiguous romantic ending breaks the core promise.
- **Killing a love interest** (without a genre-sanctioned return) — a betrayal of trust.
- **Cheating** by a lead without a fully earned redemption — most readers will not forgive it.
- **The romance as an afterthought** — leads kept apart for most of the book, or chemistry that never lands.
- **Bait-and-switch heat** — promising spice and delivering none, or vice versa.
- **The world ignores the romance** — magic/politics that never intersect with the relationship.
- **Insta-love with no earned development**, or a love triangle resolved by killing/ignoring one corner.
- **A passive heroine** with no agency over her own arc, power, or choice of partner.
```

- [ ] **Step 5: Append research sections to `reader-expectations.md`**

Read `library/genres/romantasy/reader-expectations.md`. If it does not already contain a `## Tone & Mood` / `## Pacing` / `## Setting` / `## Character Archetypes` / `## Length & Format` section, append the following:

```markdown

## Tone & Mood
Heightened and immersive: yearning, wonder, and danger. Banter and warmth balance high-stakes peril. Sensual tension builds steadily; the world feels lush and a little dangerous.

## Pacing
Alternating romance and plot beats — a relationship escalation rarely goes more than a chapter or two without a world/stakes beat (and vice versa). Slow-burn tension is fine; dead air between the leads is not.

## Setting Conventions
A secondary or portal fantasy world (courts, academies, fae realms, rival kingdoms) where the magic system has rules that constrain or empower the romance. Place is sensory and specific.

## Character Archetypes
A capable heroine claiming her power; a powerful, guarded love interest (fae lord, rival prince, dangerous mentor); a found-family ensemble; an antagonist whose goals threaten both the world and the bond.

## Length & Format
Typically 90k–130k words, third-person (often dual POV) past tense, adult or upper-YA. Establish the heat level early and hold it. Frequently book one of a series — close the romantic arc while leaving series threads open.
```

- [ ] **Step 6: Append obligatory scenes to `beats.md`**

Read `library/genres/romantasy/beats.md`. If it does not already contain an `## Obligatory Scenes` section, append:

```markdown

## Obligatory Scenes (readers would feel cheated without these)
- **The meeting** — the leads collide; friction or fascination is established.
- **Forced proximity / first alliance** — circumstances bind them together.
- **The first turn** — a kiss, confession, or act of trust that changes the relationship.
- **Midpoint deepening** — intimacy or shared danger raises the stakes of losing each other.
- **The dark moment (~75%)** — a betrayal, secret, or impossible choice forces them apart.
- **The grand gesture** — a sacrifice or change that earns reunion.
- **The earned ending** — HEA/HFN, with the world/magic thread resolved or set up for the series.
```

- [ ] **Step 7: Verify the library parses all seven files**

Run: `npx tsc --noEmit`
Expected: exits 0 (no code changed; confirms nothing broke).

Run: `ls -1 library/genres/romantasy/*.md`
Expected: lists `beats.md`, `comps.md`, `genre-killers.md`, `must-haves.md`, `reader-expectations.md`, `themes.md`, `tropes.md` (7 files).

---

## Task 2: `BookService.getActiveGenreGuide()` (read path, TDD)

**Files:**
- Test: `tests/unit/genre-guide.test.ts` (create)
- Modify: `gateway/src/services/book.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/genre-guide.test.ts`:

```typescript
/**
 * Unit tests for BookService.getActiveGenreGuide() (Phase 7 genre wiring):
 * composes the active book's templates/genre/*.md into a single, ordered,
 * header-delimited string injected into generation prompts.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LibraryService } from '../../gateway/src/services/library.js';
import { BookService } from '../../gateway/src/services/book.js';

function write(base: string, rel: string, body: string): void {
  const p = join(base, rel);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, body, 'utf-8');
}

const fakeSkills = { getSkillCatalog: () => [], getSkillByName: () => undefined } as never;

function seedLibrary(root: string, withGenre = true): LibraryService {
  const builtin = join(root, 'library');
  write(builtin, 'authors/default/SOUL.md', 'default soul');
  write(builtin, 'authors/default/STYLE-GUIDE.md', 'default style');
  write(builtin, 'voices/default/STYLE-GUIDE.md', 'default voice style');
  write(builtin, 'pipelines/novel-pipeline.json', JSON.stringify({ schemaVersion: 1, name: 'novel-pipeline', label: 'Novel', description: 'd', dynamic: true, steps: [] }));
  if (withGenre) {
    write(builtin, 'genres/romantasy/reader-expectations.md', 'EXPECT-BODY');
    write(builtin, 'genres/romantasy/tropes.md', 'TROPES-BODY');
    write(builtin, 'genres/romantasy/themes.md', 'THEMES-BODY');
    write(builtin, 'genres/romantasy/must-haves.md', 'MUSTHAVE-BODY');
  }
  return new LibraryService(builtin, join(root, 'workspace', 'library'), fakeSkills);
}

test('getActiveGenreGuide composes present sections in canonical order with headers', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-genre-'));
  try {
    const lib = seedLibrary(root); await lib.loadAll();
    const svc = new BookService(join(root, 'workspace', 'books'), lib, '9.9.9');
    await svc.create({ title: 'B', author: 'default', voice: 'default', genre: 'romantasy', pipeline: 'novel-pipeline', sections: [] });
    await svc.setActiveBook('b');

    const guide = svc.getActiveGenreGuide();
    assert.ok(guide, 'guide is not null');
    // Headers present
    assert.ok(guide!.includes('## Genre Guide — Reader Expectations'));
    assert.ok(guide!.includes('## Genre Guide — Tropes'));
    assert.ok(guide!.includes('## Genre Guide — Themes'));
    assert.ok(guide!.includes('## Genre Guide — Must-Haves'));
    // Bodies present
    assert.ok(guide!.includes('EXPECT-BODY') && guide!.includes('TROPES-BODY'));
    // Canonical order: reader-expectations before tropes before themes before must-haves
    const iExp = guide!.indexOf('Reader Expectations');
    const iTrope = guide!.indexOf('Tropes');
    const iTheme = guide!.indexOf('Themes');
    const iMust = guide!.indexOf('Must-Haves');
    assert.ok(iExp < iTrope && iTrope < iTheme && iTheme < iMust, 'sections in canonical order');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('getActiveGenreGuide returns null when there is no active book and when the book is genre-less', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-genre-'));
  try {
    const lib = seedLibrary(root); await lib.loadAll();
    const svc = new BookService(join(root, 'workspace', 'books'), lib, '9.9.9');
    assert.equal(svc.getActiveGenreGuide(), null, 'no active book → null');
    await svc.create({ title: 'NoGenre', author: 'default', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
    await svc.setActiveBook('nogenre');
    assert.equal(svc.getActiveGenreGuide(), null, 'genre-less active book → null');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('getActiveGenreGuide reads fresh (a genre-file edit is reflected, no stale cache)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-genre-'));
  try {
    const lib = seedLibrary(root); await lib.loadAll();
    const svc = new BookService(join(root, 'workspace', 'books'), lib, '9.9.9');
    await svc.create({ title: 'B', author: 'default', voice: 'default', genre: 'romantasy', pipeline: 'novel-pipeline', sections: [] });
    await svc.setActiveBook('b');
    assert.ok(svc.getActiveGenreGuide()!.includes('TROPES-BODY'));
    // Edit the book's snapshot directly, then re-read.
    writeFileSync(join(root, 'workspace', 'books', 'b', 'templates', 'genre', 'tropes.md'), 'TROPES-EDITED', 'utf-8');
    assert.ok(svc.getActiveGenreGuide()!.includes('TROPES-EDITED'), 'edit reflected on next read');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --test tests/unit/genre-guide.test.ts`
Expected: FAIL with `svc.getActiveGenreGuide is not a function`.

- [ ] **Step 3: Implement `getActiveGenreGuide()`**

In `gateway/src/services/book.ts`, add this method immediately after the existing `listFiles(...)` method (it reuses the already-imported `existsSync`, `readdirSync`, `readFileSync`, `join`):

```typescript
  /**
   * Composes the active book's genre guide (templates/genre/*.md) into a single
   * string for prompt injection (Phase 7). Files are ordered canonically
   * (reader-expectations → tropes → themes → beats → must-haves → genre-killers →
   * comps), each under a "## Genre Guide — <Title>" header; any extra .md files
   * follow in alphabetical order. Reads fresh on each call (cheap; always reflects
   * the latest snapshot after a re-pull or active-book change). Returns null when
   * there is no active book, no genre snapshot, or no non-empty genre files.
   * NOTE: reads the single global active book — keep callers behind this accessor
   * so Phase 8 can swap it to per-context without touching prompt assembly.
   */
  getActiveGenreGuide(): string | null {
    const dir = this.activeBookDir();
    if (!dir) return null;
    const genreDir = join(dir, 'templates', 'genre');
    if (!existsSync(genreDir)) return null;

    const ORDER = ['reader-expectations', 'tropes', 'themes', 'beats', 'must-haves', 'genre-killers', 'comps'];
    const TITLES: Record<string, string> = {
      'reader-expectations': 'Reader Expectations',
      'tropes': 'Tropes',
      'themes': 'Themes',
      'beats': 'Beats & Obligatory Scenes',
      'must-haves': 'Must-Haves',
      'genre-killers': 'Genre Killers',
      'comps': 'Comparable Titles',
    };

    let names: string[];
    try {
      names = readdirSync(genreDir, { withFileTypes: true })
        .filter((e) => e.isFile() && e.name.endsWith('.md'))
        .map((e) => e.name);
    } catch {
      return null;
    }
    if (names.length === 0) return null;

    const ordered = [
      ...ORDER.filter((n) => names.includes(`${n}.md`)).map((n) => `${n}.md`),
      ...names.filter((f) => !ORDER.includes(f.replace(/\.md$/, ''))).sort(),
    ];

    const parts: string[] = [];
    for (const file of ordered) {
      let body: string;
      try {
        body = readFileSync(join(genreDir, file), 'utf-8').trim();
      } catch {
        continue;
      }
      if (!body) continue;
      const key = file.replace(/\.md$/, '');
      parts.push(`## Genre Guide — ${TITLES[key] ?? key}\n\n${body}`);
    }
    return parts.length ? parts.join('\n\n') : null;
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --import tsx --test tests/unit/genre-guide.test.ts`
Expected: PASS (3 tests pass, 0 fail).

- [ ] **Step 5: Verify the whole unit suite still passes**

Run: `node --import tsx --test tests/unit/*.test.ts`
Expected: all tests pass, 0 fail (previously 124; now 127 with the 3 new tests). `npx tsc --noEmit` exits 0.

---

## Task 3: Thread the genre guide into `buildSystemPrompt`

**Files:**
- Modify: `gateway/src/index.ts` (the `buildSystemPrompt` context type ~line 811-818; the render block after the soul block ~line 822; the call site ~line 565-572)

- [ ] **Step 1: Add `genreGuide` to the context type**

In `gateway/src/index.ts`, change the `buildSystemPrompt` parameter type (currently):

```typescript
  public buildSystemPrompt(context: {
    soul: string;
    memories: string;
    activeProject: string | null;
    skills: string[];
    heartbeatContext: string;
    channel?: string;
  }): string {
```

to add one field:

```typescript
  public buildSystemPrompt(context: {
    soul: string;
    genreGuide?: string | null;
    memories: string;
    activeProject: string | null;
    skills: string[];
    heartbeatContext: string;
    channel?: string;
  }): string {
```

- [ ] **Step 2: Render the genre-guide block right after the identity block**

Immediately after these two existing lines:

```typescript
    prompt += '# Your Identity\n\n';
    prompt += context.soul + '\n\n';
```

insert:

```typescript
    if (context.genreGuide) {
      prompt += '# Active Book — Genre Guide\n\n';
      prompt += 'Write to this genre. Honor its conventions and reader promise, hit its obligatory scenes and must-haves, and avoid its genre-killers:\n\n';
      prompt += context.genreGuide + '\n\n';
    }
```

- [ ] **Step 3: Pass the genre guide at the call site**

In the `buildSystemPrompt({...})` call (the block starting `let systemPrompt = this.buildSystemPrompt({`), add the `genreGuide` field so it reads:

```typescript
    let systemPrompt = this.buildSystemPrompt({
      soul,
      genreGuide: this.books?.getActiveGenreGuide() ?? undefined,
      memories,
      activeProject,
      skills,
      heartbeatContext,
      channel,
    });
```

- [ ] **Step 4: Verify it type-checks and the suite is green**

Run: `npx tsc --noEmit`
Expected: exits 0.

Run: `node --import tsx --test tests/unit/*.test.ts`
Expected: all pass, 0 fail.

---

## Task 4: Deterministic end-to-end genre-injection smoke check

The composed system prompt cannot be read directly on a remote container, so prove injection by putting a unique sentinel in a temp genre's `must-haves.md`, activating a book that uses it, and asking the agent (in chat) to repeat the genre must-haves — the sentinel can only appear if the guide reached the system prompt.

**Files:**
- Modify: `tests/feature-smoke.sh` (add a block in Tier B/C, after the existing chat check; reuse the `req`, `pass`, `fail`, `skip`, `has_endpoint`, `jget`, and `CREATED_BOOKS` helpers/arrays already defined in the script)

- [ ] **Step 1: Add the genre-injection assertion**

In `tests/feature-smoke.sh`, after the existing `chat ::` assertion in Tier B, insert this block (it self-skips on older builds that lack the library-genre write route):

```bash
# ── Phase 7 — genre guide reaches the system prompt (sentinel echo) ──
GENRE_WRITE_PRESENT=$(has_endpoint POST /api/library/genre)
if [ "$GENRE_WRITE_PRESENT" = "no" ]; then
  skip "genre wiring: guide injected into prompt" "(library genre write route absent)"
else
  G7_RAND=$RANDOM
  G7_GENRE="smoke-genre-p7-$G7_RAND"
  G7_SENTINEL="ZZQX-GENRE-SENTINEL-$G7_RAND"
  # Create a temp genre whose must-haves.md carries a unique sentinel line.
  G7_CREATE=$(req POST /api/library/genre \
    "{\"name\":\"$G7_GENRE\",\"files\":{\"must-haves.md\":\"# Must-Haves\\n\\n- $G7_SENTINEL: every book must feature a singing kettle.\"}}")
  if [ "$(printf '%s' "$G7_CREATE" | jget success)" != "true" ]; then
    skip "genre wiring: guide injected into prompt" "(temp genre create failed)"
  else
    CREATED_GENRES+=("$G7_GENRE")
    # Create a book using that genre and activate it.
    G7_BODY=$(printf '{"title":"Smoke P7 %s","author":"%s","voice":"%s","genre":"%s","pipeline":"%s","sections":[]}' \
      "$G7_RAND" "$AUTHOR_NAME" "${VOICE_NAME:-default}" "$G7_GENRE" "$PIPE_NAME")
    G7_BOOK=$(req POST /api/books "$G7_BODY")
    G7_SLUG=$(printf '%s' "$G7_BOOK" | jget book.slug)
    if [ -z "$G7_SLUG" ]; then
      skip "genre wiring: guide injected into prompt" "(book create failed)"
    else
      CREATED_BOOKS+=("$G7_SLUG")
      req POST /api/books/active "{\"slug\":\"$G7_SLUG\"}" >/dev/null
      # Ask the agent to repeat its genre must-haves verbatim. The sentinel can
      # only appear if the genre guide was injected into the system prompt.
      G7_RESP=$(req POST /api/chat "{\"message\":\"Repeat this book's genre must-haves exactly as written, verbatim. Output only the list.\"}")
      if printf '%s' "$G7_RESP" | grep -q "$G7_SENTINEL"; then
        pass "genre wiring: guide injected into prompt" "sentinel echoed"
      else
        fail "genre wiring: guide injected into prompt" "sentinel '$G7_SENTINEL' absent from reply"
      fi
    fi
  fi
fi
```

- [ ] **Step 2: Ensure temp genres are cleaned up**

In `tests/feature-smoke.sh`, confirm a `CREATED_GENRES` array exists and is torn down in the EXIT trap. If the script already deletes a `library/genre` in teardown (it creates `smoke-genre-*` in Tier A), reuse that array name instead of `CREATED_GENRES`. If no genre-cleanup array exists, add near the other `CREATED_*` declarations:

```bash
CREATED_GENRES=()
```

and in the EXIT-trap teardown, alongside the existing book/persona cleanup, add:

```bash
for g in "${CREATED_GENRES[@]:-}"; do
  req DELETE "/api/library/genre/$g" >/dev/null 2>&1 && echo "  [cleanup] deleted library/genre $g"
done
```

> Verify the exact DELETE route and the Tier-A genre-cleanup array name by reading the existing genre create/cleanup lines in `tests/feature-smoke.sh` (search `library/genre`) and matching them — do not introduce a second cleanup mechanism.

- [ ] **Step 3: Confirm the script still parses**

Run: `bash -n tests/feature-smoke.sh`
Expected: exits 0 (no syntax errors).

---

## Task 5: Docs, tracker, and commit message

**Files:**
- Modify: `CLAUDE.md`, `docs/TODO.md`, `docs/COMPLETED.md`
- Create: `commit_message`

- [ ] **Step 1: Note in CLAUDE.md that genre is now wired**

In `CLAUDE.md`, find the stateful-directories bullet describing `workspace/books/<slug>/` (it currently says the book container is "Not yet driving generation (Phase 3 wires `SoulService`/`ProjectEngine`…)"). Append one sentence:

```
Genre is now injected into generation prompts via `BookService.getActiveGenreGuide()` → `buildSystemPrompt` (book-container Phase 7).
```

- [ ] **Step 2: Move the Phase 7 item TODO → COMPLETED**

In `docs/TODO.md`, find the North-Star/roadmap reference to "Phase 7 genre wiring" (the genre-wiring line in the multi-book umbrella item). In `docs/COMPLETED.md`, under the current dated section, add:

```markdown
- **Book-container Phase 7 — genre wiring.** The active book's genre guide is now injected into generation prompts alongside Author + Voice. New `BookService.getActiveGenreGuide()` composes `templates/genre/*.md` in canonical order (reader-expectations → tropes → themes → beats → must-haves → genre-killers → comps) under `## Genre Guide — <Title>` headers, threaded through the single `buildSystemPrompt` chokepoint (`gateway/src/index.ts`). Genre-guide content schema expanded (research-backed): added `themes.md`, `must-haves.md`, `genre-killers.md`; expanded `reader-expectations.md` (tone/pacing/setting/archetypes/length) and `beats.md` (named obligatory scenes); `romantasy` fleshed out as the worked example; `docs/GENRE-GUIDE-TEMPLATE.md` documents the 7-file schema. Verified: `tests/unit/genre-guide.test.ts` (compose order / genre-less→null / fresh-read) + a deterministic sentinel-echo assertion in `tests/feature-smoke.sh`. Spec: `docs/superpowers/specs/2026-06-08-phase7-genre-wiring-design.md`; plan: `docs/superpowers/plans/2026-06-08-phase7-genre-wiring.md`. Broad genre-library content remains out of scope.
```

- [ ] **Step 3: Write the commit message**

Create `commit_message` at the repo root:

```
feat(phase7): wire the active book's genre guide into generation prompts

Genre was snapshot-but-unwired; now injected alongside Author + Voice.

- BookService.getActiveGenreGuide(): composes the active book's
  templates/genre/*.md in canonical order (reader-expectations → tropes →
  themes → beats → must-haves → genre-killers → comps) under
  "## Genre Guide — <Title>" headers; null when genre-less; reads fresh.
- buildSystemPrompt threads a genreGuide block ("# Active Book — Genre
  Guide") after the identity block; handleMessage passes
  this.books.getActiveGenreGuide(). Single chokepoint → reaches chat + every
  pipeline step (whole guide everywhere, owner-confirmed).
- Genre guide schema expanded (research-backed): add themes.md, must-haves.md,
  genre-killers.md; expand reader-expectations.md (tone/pacing/setting/
  archetypes/length) + beats.md (obligatory scenes). romantasy fleshed out;
  docs/GENRE-GUIDE-TEMPLATE.md documents the 7-file schema.
- Tests: tests/unit/genre-guide.test.ts (order / genre-less→null / fresh-read);
  deterministic sentinel-echo assertion in tests/feature-smoke.sh.

Spec: docs/superpowers/specs/2026-06-08-phase7-genre-wiring-design.md
Plan: docs/superpowers/plans/2026-06-08-phase7-genre-wiring.md
```

- [ ] **Step 4: Final local verification gate**

Run: `npx tsc --noEmit && node --import tsx --test tests/unit/*.test.ts && bash -n tests/feature-smoke.sh`
Expected: tsc exits 0; all unit tests pass (0 fail); the smoke script parses cleanly.

- [ ] **Step 5: Deploy + live smoke (after the maintainer pushes, or to verify the working tree)**

Run: `touch build_now`
Then poll `.build-logs/last-build.status` for a fresh timestamp with `result=PASS`.
Then run the live feature-smoke (no concurrent UI interaction):

```bash
TOKEN=$(grep '^BOOKCLAW_AUTH_TOKEN=' .env | head -1 | cut -d= -f2- | tr -d '"')
BASE_URL=http://192.168.1.32:3847 BOOKCLAW_AUTH_TOKEN="$TOKEN" bash tests/feature-smoke.sh
```

Expected: `SUMMARY: N passed, 0 failed` including `[PASS] genre wiring: guide injected into prompt :: sentinel echoed`.

---

## Self-Review

**Spec coverage:**
- Content model (§3 of spec, 7 files) → Task 1.
- `BookService.getActiveGenreGuide()` (§4.1, decision 5.2) → Task 2.
- Inject into `buildSystemPrompt`, whole-guide-everywhere (§4.2, decision 5.1) → Task 3.
- Multiple-file schema, no renames (decision 5.3) → Task 1 (additive only).
- Success criterion 1 (genre reaches prompts) → Task 4 sentinel echo.
- Success criterion 2 (changing genre changes output) → Task 4 (sentinel present only when that genre is active) + Task 2 (genre-less → null).
- Success criterion 3 (re-pull works) → Task 2 fresh-read test (re-pull rewrites the snapshot files `getActiveGenreGuide` reads) + the existing re-pull smoke assertions.
- Out-of-scope (broad genre content; task-targeting) → not implemented; noted in Task 5 COMPLETED entry.

**Placeholder scan:** none — every code/content step has full content; commands have expected output. The two "verify the existing route/array name" notes in Task 4 are deliberate guards against duplicating an existing teardown mechanism, not deferrals.

**Type consistency:** `getActiveGenreGuide(): string | null` defined in Task 2 and consumed in Task 3 as `genreGuide?: string | null` with `?? undefined`. The canonical ORDER/TITLES/header constants match between the Task 2 implementation, the Task 2 test assertions, and the Task 1 content filenames. The section-title `Beats & Obligatory Scenes` and `Must-Haves` strings match the test's substring checks (`Tropes`, `Themes`, `Must-Haves`, `Reader Expectations`).
