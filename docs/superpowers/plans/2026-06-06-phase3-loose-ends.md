# Phase 3 Loose Ends Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Repo convention (overrides the generic "Commit" step):** This repo does NOT use per-task `git commit`. The maintainer runs `./push.sh`. Each task's final step is **"Verify: `npx tsc --noEmit` clean + `npm run test:unit` green; leave changes in the working tree (do NOT git commit)."** The controller writes one final `commit_message` at the end (Task 7).

**Goal:** Make Voice a first-class library asset selectable independently of Author (mix-and-match), snapshot a book's pipeline-referenced skills as a frozen record, and add a book DELETE endpoint.

**Architecture:** Extend the existing library/book/soul mechanisms. `voice` becomes a fifth file-backed library kind; `BookService.create()` snapshots author + voice + referenced skills into the book's `templates/`; `SoulService` composes identity from the author dir and style from a new voice dir; `DELETE /api/books/:slug` removes a book and re-resolves the active pointer.

**Tech Stack:** Node 22 + TypeScript (NodeNext, `.js` import extensions), Express, `node --test` via tsx (`npm run test:unit`), esbuild dashboard (`npm run build:dashboard`).

**Spec:** `docs/superpowers/specs/2026-06-06-phase3-loose-ends-design.md`

---

### Task 1: Library — add the `voice` kind + re-seed content

**Files:**
- Modify: `gateway/src/services/library-types.ts` (add `'voice'` to `LIBRARY_KINDS`)
- Modify: `gateway/src/services/library.ts` (add `'voice'` to `FILE_KINDS` + `DIR_LAYOUT`)
- Create: `library/voices/default/STYLE-GUIDE.md`, `library/voices/default/VOICE-PROFILE.md`
- Modify (content move): delete `STYLE-GUIDE.md` + `VOICE-PROFILE.md` from `library/authors/default/`
- Test: `tests/unit/library-voice.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/library-voice.test.ts
/** Unit tests for the first-class `voice` library kind (Phase 3 loose ends). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LibraryService } from '../../gateway/src/services/library.js';

const fakeSkills = { getSkillCatalog: () => [], getSkillByName: () => undefined } as never;

function write(base: string, rel: string, body: string): void {
  const p = join(base, rel);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, body, 'utf-8');
}

test('voice is a first-class library kind: list + get', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-voice-'));
  try {
    const builtin = join(root, 'library');
    write(builtin, 'authors/default/SOUL.md', '# Default Author\n\nidentity');
    write(builtin, 'voices/default/STYLE-GUIDE.md', 'style rules');
    write(builtin, 'voices/default/VOICE-PROFILE.md', 'voice profile');
    const lib = new LibraryService(builtin, join(root, 'workspace', 'library'), fakeSkills);
    await lib.loadAll();

    const voices = lib.list('voice').map((v) => v.name);
    assert.deepEqual(voices, ['default']);

    const full = lib.get('voice', 'default');
    assert.ok(full?.files, 'voice get() returns a files bundle');
    assert.deepEqual(Object.keys(full!.files!).sort(), ['STYLE-GUIDE.md', 'VOICE-PROFILE.md']);
    assert.equal(full!.files!['STYLE-GUIDE.md'], 'style rules');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run the test — verify it fails**

Run: `npm run test:unit 2>&1 | grep -A3 'voice is a first-class'`
Expected: FAIL — `list('voice')` returns `[]` (voice not in `FILE_KINDS`).

- [ ] **Step 3: Add `voice` to the kinds list**

In `gateway/src/services/library-types.ts`, find:

```ts
export const LIBRARY_KINDS = ['author', 'genre', 'pipeline', 'section', 'skill'] as const;
```

Replace with (voice added after author):

```ts
export const LIBRARY_KINDS = ['author', 'voice', 'genre', 'pipeline', 'section', 'skill'] as const;
```

- [ ] **Step 4: Add `voice` to the file-backed kinds + dir layout**

In `gateway/src/services/library.ts`, find:

```ts
const FILE_KINDS = ['author', 'genre', 'pipeline', 'section'] as const;
type FileKind = (typeof FILE_KINDS)[number];

/** Subdirectory under the library root for each file-backed kind. */
const DIR_LAYOUT: Record<FileKind, string> = {
  author: 'authors',
  genre: 'genres',
  pipeline: 'pipelines',
  section: 'sections',
};
```

Replace with:

```ts
const FILE_KINDS = ['author', 'voice', 'genre', 'pipeline', 'section'] as const;
type FileKind = (typeof FILE_KINDS)[number];

/** Subdirectory under the library root for each file-backed kind. */
const DIR_LAYOUT: Record<FileKind, string> = {
  author: 'authors',
  voice: 'voices',
  genre: 'genres',
  pipeline: 'pipelines',
  section: 'sections',
};
```

Voice is a multi-file kind, so it falls into the existing `else` branch in `loadKind()` (directory of `.md` files) — no other code change needed.

- [ ] **Step 5: Re-seed built-in content (split author → author + voice)**

Per decision 6 this is content restructuring, not migration. For the one built-in author (`default`):

```bash
cd /home/paul/data/dev/bookclaw
mkdir -p library/voices/default
git mv library/authors/default/STYLE-GUIDE.md library/voices/default/STYLE-GUIDE.md
git mv library/authors/default/VOICE-PROFILE.md library/voices/default/VOICE-PROFILE.md
```

(If `git mv` fails because a file is untracked, use plain `mv`.) Afterward `library/authors/default/` holds only `SOUL.md` + `PERSONALITY.md`; `library/voices/default/` holds `STYLE-GUIDE.md` + `VOICE-PROFILE.md`. There is only one built-in author dir (`default`); if more exist, repeat for each.

- [ ] **Step 6: Run the test — verify it passes**

Run: `npm run test:unit 2>&1 | grep -A3 'voice is a first-class'`
Expected: PASS.

- [ ] **Step 7: Verify (no commit)**

Run: `npx tsc --noEmit && npm run test:unit`
Expected: tsc clean; suite green. Leave changes in the working tree.

---

### Task 2: Book — reference + snapshot a Voice, snapshot referenced skills

**Files:**
- Modify: `gateway/src/services/book-types.ts` (`pulledFrom.voice` + `skills?`)
- Modify: `gateway/src/services/book.ts` (`BookSelection.voice`, `DEFAULT_BOOK_SELECTION.voice`, snapshot voice + skills, `activeVoiceDir()`)
- Modify: `gateway/src/api/routes/books.routes.ts` (`POST /api/books` parses `voice`)
- Modify (compile-fix): `tests/unit/active-book.test.ts`, `tests/unit/book.test.ts` (add `voice: 'default'` to `create()` calls)
- Test: `tests/unit/book.test.ts` (extend)

- [ ] **Step 1: Write the failing test (extend book.test.ts)**

Add to `tests/unit/book.test.ts` (mirror its existing temp-library fixture; ensure the fixture seeds `voices/default/STYLE-GUIDE.md` + a pipeline whose steps reference a skill, and a `fakeSkills` whose `getSkillByName` returns content for that skill). If the file's fixture helper doesn't already seed voices/skills, extend it. Test body:

```ts
test('create() snapshots voice + pipeline-referenced skills into templates/', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-booksnap-'));
  try {
    // fixture: a library with author/default (SOUL), voices/default (STYLE-GUIDE),
    // and a static pipeline 'mini' whose first step references skill 'outline-helper';
    // fakeSkills.getSkillByName('outline-helper') -> { content: 'SKILL BODY', ... }
    const builtin = join(root, 'library');
    write(builtin, 'authors/default/SOUL.md', '# A\nidentity');
    write(builtin, 'voices/default/STYLE-GUIDE.md', 'style');
    write(builtin, 'pipelines/mini.json', JSON.stringify({
      schemaVersion: 1, name: 'mini', label: 'Mini', description: 'd',
      steps: [{ id: 's1', label: 'Outline', taskType: 'outline', skill: 'outline-helper', promptTemplate: 'Write {{title}}' }],
    }));
    const skills = {
      getSkillCatalog: () => [{ name: 'outline-helper', description: 'd', source: 'builtin' as const }],
      getSkillByName: (n: string) => n === 'outline-helper' ? { content: 'SKILL BODY', description: 'd', source: 'builtin' as const } : undefined,
    } as never;
    const lib = new LibraryService(builtin, join(root, 'workspace', 'library'), skills);
    await lib.loadAll();
    const svc = new BookService(join(root, 'workspace', 'books'), lib, '9.9.9');
    await svc.initialize();

    const m = await svc.create({ title: 'T', author: 'default', voice: 'default', genre: null, pipeline: 'mini', sections: [] });
    const dir = join(root, 'workspace', 'books', m.slug);
    assert.ok(existsSync(join(dir, 'templates', 'voice', 'STYLE-GUIDE.md')), 'voice snapshot');
    assert.equal(readFileSync(join(dir, 'templates', 'skills', 'outline-helper', 'SKILL.md'), 'utf-8'), 'SKILL BODY');
    assert.equal(m.pulledFrom.voice.name, 'default');
    assert.deepEqual(m.pulledFrom.skills, ['outline-helper']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('create() rejects an unknown voice', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-booksnap2-'));
  try {
    const builtin = join(root, 'library');
    write(builtin, 'authors/default/SOUL.md', '# A\nx');
    write(builtin, 'voices/default/STYLE-GUIDE.md', 'style');
    write(builtin, 'pipelines/mini.json', JSON.stringify({ schemaVersion: 1, name: 'mini', label: 'M', description: 'd', dynamic: true, steps: [] }));
    const lib = new LibraryService(builtin, join(root, 'workspace', 'library'), { getSkillCatalog: () => [], getSkillByName: () => undefined } as never);
    await lib.loadAll();
    const svc = new BookService(join(root, 'workspace', 'books'), lib, '9.9.9');
    await svc.initialize();
    await assert.rejects(() => svc.create({ title: 'T', author: 'default', voice: 'nope', genre: null, pipeline: 'mini', sections: [] }), /voice/i);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
```

Ensure the test file imports `readFileSync` and `existsSync` from `node:fs`.

- [ ] **Step 2: Run — verify it fails**

Run: `npm run test:unit 2>&1 | grep -A3 'snapshots voice'`
Expected: FAIL (and tsc would error on `voice:` not existing in `BookSelection` — that's fixed in Step 3).

- [ ] **Step 3: Add `voice` + `skills` to the manifest type**

In `gateway/src/services/book-types.ts`, find the `pulledFrom` block:

```ts
  pulledFrom: {
    author: PulledRef;
    genre?: PulledRef | null;
    pipeline: PulledRef;
    sections: string[];       // section names snapshotted
  };
```

Replace with:

```ts
  pulledFrom: {
    author: PulledRef;
    voice: PulledRef;
    genre?: PulledRef | null;
    pipeline: PulledRef;
    sections: string[];       // section names snapshotted
    skills?: string[];        // pipeline-referenced skill names snapshotted (frozen record)
  };
```

- [ ] **Step 4: Snapshot voice + skills in `BookService.create()`**

In `gateway/src/services/book.ts`:

(a) Extend the `BookSelection` interface — add `voice`:

```ts
export interface BookSelection {
  title: string;
  author: string;
  voice: string;
  genre: string | null;
  pipeline: string;
  sections: string[];
}
```

(b) Extend `DEFAULT_BOOK_SELECTION`:

```ts
const DEFAULT_BOOK_SELECTION: BookSelection = {
  title: 'Default Book',
  author: 'default',
  voice: 'default',
  genre: null,
  pipeline: 'novel-pipeline',
  sections: [],
};
```

(c) In `create()`, after the `author` resolution and before writing the snapshot, resolve the voice (mirror the author check):

```ts
    const voice = this.library.get('voice', sel.voice);
    if (!voice || !voice.files) throw new Error(`Unknown voice template: ${sel.voice}`);
```

(d) After the `templates/author/` write loop, add the voice snapshot:

```ts
    await mkdir(join(dir, 'templates', 'voice'), { recursive: true });
    for (const [file, content] of Object.entries(voice.files)) {
      await writeFile(join(dir, 'templates', 'voice', file), content, 'utf-8');
    }
```

(e) After the `templates/pipeline.json` write, snapshot the pipeline-referenced skills (frozen record):

```ts
    // Frozen skills record: snapshot the SKILL.md of each skill the chosen
    // pipeline's steps reference. SkillLoader matching stays global (not driven
    // by this snapshot); a missing skill is skipped fail-soft.
    const skillNames = Array.from(new Set(
      (pipeline.pipeline.steps || [])
        .map((s) => s.skill)
        .filter((n): n is string => typeof n === 'string' && n.length > 0),
    ));
    const snappedSkills: string[] = [];
    for (const name of skillNames) {
      const sk = this.library.get('skill', name);
      if (!sk || typeof sk.content !== 'string') {
        console.warn(`  ⚠ Books: skill "${name}" referenced by pipeline not found — skipping snapshot`);
        continue;
      }
      await mkdir(join(dir, 'templates', 'skills', name), { recursive: true });
      await writeFile(join(dir, 'templates', 'skills', name, 'SKILL.md'), sk.content, 'utf-8');
      snappedSkills.push(name);
    }
```

(f) In the `manifest` object literal, add `voice` to `pulledFrom` (after `author`) and `skills` (after `sections`):

```ts
        author: ref(sel.author, author.source),
        voice: ref(sel.voice, voice.source),
```

```ts
        sections: sectionEntries.map((s) => s.name),
        skills: snappedSkills,
```

(g) Add the `activeVoiceDir()` accessor next to `activeAuthorDir()`:

```ts
  /** Absolute templates/voice/ dir of the active book, or null. */
  activeVoiceDir(): string | null {
    const d = this.activeBookDir();
    return d ? join(d, 'templates', 'voice') : null;
  }
```

- [ ] **Step 5: Parse `voice` in the create route**

In `gateway/src/api/routes/books.routes.ts` `POST /api/books`, after the `author` validation add a `voice` validation, and pass it to `create()`:

```ts
    if (typeof body.voice !== 'string' || !body.voice) return res.status(400).json({ error: 'voice (string) is required' });
```

```ts
      const manifest = await services.books.create({ title, author: body.author, voice: body.voice, genre, pipeline: body.pipeline, sections });
```

- [ ] **Step 6: Fix existing `create()` callers (tsc breakage)**

Adding required `voice` breaks existing calls. Run `npx tsc --noEmit` and add `voice: 'default'` to every `create({ ... })` call it flags — at minimum in `tests/unit/active-book.test.ts` (4 calls) and `tests/unit/book.test.ts`. Also ensure those test fixtures seed `voices/default/STYLE-GUIDE.md` (add a `write(builtin, 'voices/default/STYLE-GUIDE.md', '...')` line to each `seedLibrary`-style helper) so `create()` can resolve the voice.

- [ ] **Step 7: Run the tests — verify they pass**

Run: `npm run test:unit 2>&1 | grep -A2 'snapshots voice\|rejects an unknown voice'`
Expected: PASS.

- [ ] **Step 8: Verify (no commit)**

Run: `npx tsc --noEmit && npm run test:unit`
Expected: tsc clean; suite green.

---

### Task 3: SoulService — compose Author + Voice from two dirs

**Files:**
- Modify: `gateway/src/services/soul.ts` (`voiceDir` field, `useBook(authorDir, voiceDir)`, `load()` reads style from `voiceDir`)
- Modify: `gateway/src/init/phase-05-research-skills.ts` (pass `activeVoiceDir()`)
- Modify: `gateway/src/api/routes/books.routes.ts` (`POST /api/books/active` passes `activeVoiceDir()`)
- Test: `tests/unit/soul-usebook.test.ts` (extend)

- [ ] **Step 1: Write the failing test (extend soul-usebook.test.ts)**

Add (using the file's existing temp-dir helpers; create separate author + voice dirs):

```ts
test('useBook composes identity from authorDir and style from voiceDir', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-soul2-'));
  try {
    const authorDir = join(root, 'a'); const voiceDir = join(root, 'v');
    mkdirSync(authorDir, { recursive: true }); mkdirSync(voiceDir, { recursive: true });
    writeFileSync(join(authorDir, 'SOUL.md'), '# Author A\nidentity A', 'utf-8');
    writeFileSync(join(voiceDir, 'STYLE-GUIDE.md'), 'Style of V', 'utf-8');
    writeFileSync(join(voiceDir, 'VOICE-PROFILE.md'), 'Voice of V', 'utf-8');
    const soul = new SoulService(join(root, 'unused'));
    await soul.useBook(authorDir, voiceDir);
    const ctx = soul.getFullContext();
    assert.match(ctx, /identity A/);
    assert.match(ctx, /Style of V/);
    assert.match(ctx, /Voice of V/);
    assert.equal(soul.getName(), 'Author A');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('useBook with no separate voiceDir falls back to reading style from the author dir', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-soul3-'));
  try {
    const authorDir = join(root, 'a');
    mkdirSync(authorDir, { recursive: true });
    writeFileSync(join(authorDir, 'SOUL.md'), '# Legacy\nx', 'utf-8');
    writeFileSync(join(authorDir, 'STYLE-GUIDE.md'), 'Legacy style', 'utf-8');
    const soul = new SoulService(join(root, 'unused'));
    await soul.useBook(authorDir, null);
    assert.match(soul.getFullContext(), /Legacy style/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
```

Ensure `mkdirSync`/`writeFileSync` are imported in the test file.

- [ ] **Step 2: Run — verify it fails**

Run: `npm run test:unit 2>&1 | grep -A3 'composes identity'`
Expected: FAIL (and tsc: `useBook` takes 1 arg). The signature change is Step 3.

- [ ] **Step 3: Add `voiceDir` + two-dir loading to SoulService**

In `gateway/src/services/soul.ts`:

(a) Add the field after `private soulDir: string;`:

```ts
  private voiceDir: string | null = null;
```

(b) In `load()`, change the style + voice reads to use `voiceDir` (falling back to `soulDir` when `voiceDir` is null). Replace the `stylePath`/`voicePath` blocks:

```ts
    // Style + voice come from the Voice snapshot (templates/voice/); fall back to
    // the author dir when no separate voice dir is set (legacy/old-shape books).
    const styleBase = this.voiceDir ?? this.soulDir;
    const stylePath = join(styleBase, 'STYLE-GUIDE.md');
    if (existsSync(stylePath)) {
      this.styleGuide = await readFile(stylePath, 'utf-8');
    }

    const voicePath = join(styleBase, 'VOICE-PROFILE.md');
    if (existsSync(voicePath)) {
      this.voiceProfile = await readFile(voicePath, 'utf-8');
    }
```

(c) Change `useBook` to accept the voice dir and re-point both, restoring both on error:

```ts
  async useBook(authorDir: string, voiceDir: string | null): Promise<void> {
    if (!authorDir || !existsSync(authorDir)) {
      console.warn(`  ⚠ Soul: author snapshot not found at "${authorDir}" — keeping current Author`);
      return;
    }
    const prevSoul = this.soulDir;
    const prevVoice = this.voiceDir;
    this.soulDir = authorDir;
    this.voiceDir = voiceDir && existsSync(voiceDir) ? voiceDir : null;
    try {
      await this.load();
    } catch (err) {
      this.soulDir = prevSoul;
      this.voiceDir = prevVoice;
      console.warn(`  ⚠ Soul: failed to load author snapshot at "${authorDir}" — keeping current Author: ${(err as Error)?.message || err}`);
    }
  }
```

- [ ] **Step 4: Update the two `useBook` callers**

In `gateway/src/init/phase-05-research-skills.ts`, find the `useBook` call (currently `await gw.soul.useBook(activeAuthorDir)`) and change it to pass the voice dir:

```ts
      const activeAuthorDir = gw.books.activeAuthorDir();
      if (activeAuthorDir) {
        await gw.soul.useBook(activeAuthorDir, gw.books.activeVoiceDir());
        console.log('  ✓ Soul: using active book\'s Author + Voice');
      }
```

(Match the surrounding code — keep whatever log line / guard already exists, just add the second argument.)

In `gateway/src/api/routes/books.routes.ts` `POST /api/books/active`, replace:

```ts
      const authorDir = services.books.activeAuthorDir();
      if (authorDir && gateway.soul) await gateway.soul.useBook(authorDir);
```

with:

```ts
      const authorDir = services.books.activeAuthorDir();
      if (authorDir && gateway.soul) await gateway.soul.useBook(authorDir, services.books.activeVoiceDir());
```

- [ ] **Step 5: Run the tests — verify they pass**

Run: `npm run test:unit 2>&1 | grep -A2 'composes identity\|falls back to reading'`
Expected: PASS. The existing no-leak test in this file must still pass.

- [ ] **Step 6: Verify (no commit)**

Run: `npx tsc --noEmit && npm run test:unit`
Expected: tsc clean; suite green.

---

### Task 4: Book DELETE

**Files:**
- Modify: `gateway/src/services/book.ts` (`delete()`)
- Modify: `gateway/src/api/routes/books.routes.ts` (`DELETE /api/books/:slug`)
- Test: `tests/unit/active-book.test.ts` (extend)

- [ ] **Step 1: Write the failing test (extend active-book.test.ts)**

```ts
test('delete() of the active book re-activates the newest remaining', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-del-'));
  try {
    const svc = await makeSvc(root);
    const older = await svc.create({ title: 'Older', author: 'default', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
    const active = await svc.create({ title: 'Active', author: 'default', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
    await svc.setActiveBook(active.slug);
    const { active: nowActive } = await svc.delete(active.slug);
    assert.equal(nowActive, older.slug, 're-activated the remaining book');
    assert.equal(svc.getActiveBook(), older.slug);
    assert.equal(svc.list().length, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('delete() of the last book re-seeds a Default Book', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-del2-'));
  try {
    const svc = await makeSvc(root);
    const only = await svc.create({ title: 'Only', author: 'default', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
    await svc.setActiveBook(only.slug);
    const { active } = await svc.delete(only.slug);
    assert.ok(active && active !== only.slug, 'a fresh Default Book was seeded + activated');
    assert.equal(svc.list().length, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('delete() of a non-active book leaves active untouched', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-del3-'));
  try {
    const svc = await makeSvc(root);
    const keep = await svc.create({ title: 'Keep', author: 'default', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
    const drop = await svc.create({ title: 'Drop', author: 'default', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
    await svc.setActiveBook(keep.slug);
    const { active } = await svc.delete(drop.slug);
    assert.equal(active, keep.slug);
    assert.equal(svc.list().length, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
```

Note: the `makeSvc`/`seedLibrary` helper must seed `voices/default/STYLE-GUIDE.md` (added in Task 2 Step 6) so `create()` resolves the voice.

- [ ] **Step 2: Run — verify it fails**

Run: `npm run test:unit 2>&1 | grep -A2 're-activates the newest'`
Expected: FAIL (`svc.delete` is not a function).

- [ ] **Step 3: Implement `BookService.delete()`**

In `gateway/src/services/book.ts`, add the `rm` import at the top (`import { readFile, writeFile, mkdir, rm } from 'fs/promises';`) and add the method (after `seedDefaultBook`):

```ts
  /**
   * Delete a book directory. If it was the active book, clear the pointer and
   * re-resolve via seedDefaultBook() (activate newest, or seed a fresh Default
   * Book if none remain). Returns the resulting active slug. The caller
   * (route) is responsible for confirming the book exists first.
   */
  async delete(slug: string): Promise<{ active: string | null }> {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new Error(`Invalid slug: ${slug}`);
    await rm(join(this.booksDir, slug), { recursive: true, force: true });
    if (this.activeBookSlug === slug) {
      this.activeBookSlug = null;
      await this.seedDefaultBook(); // activates newest remaining, or seeds a new Default Book
    }
    return { active: this.activeBookSlug };
  }
```

- [ ] **Step 4: Run the tests — verify they pass**

Run: `npm run test:unit 2>&1 | grep -A2 're-activates the newest\|re-seeds a Default\|leaves active untouched'`
Expected: PASS.

- [ ] **Step 5: Add the DELETE route**

In `gateway/src/api/routes/books.routes.ts`, add after the `POST /api/books/active` handler (and before `GET /api/books/:slug`):

```ts
  app.delete('/api/books/:slug', async (req: Request, res: Response) => {
    const slug = String(req.params.slug);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) return res.status(400).json({ error: 'invalid slug' });
    const existing = await services.books.open(slug);
    if (!existing) return res.status(404).json({ error: 'Book not found' });
    try {
      const { active } = await services.books.delete(slug);
      // If deleting the active book re-pointed us at a different one, re-point the soul.
      if (active && gateway.soul) {
        await gateway.soul.useBook(services.books.activeAuthorDir(), services.books.activeVoiceDir());
      }
      res.json({ deleted: slug, active });
    } catch (err) {
      res.status(500).json({ error: (err as Error)?.message || String(err) });
    }
  });
```

- [ ] **Step 6: Verify (no commit)**

Run: `npx tsc --noEmit && npm run test:unit`
Expected: tsc clean; suite green.

---

### Task 5: Dashboard — Delete button + Voice in create

**Files:**
- Modify: `dashboard/src/panels/books.js` (Delete button per row; if a New Book form exists, add a Voice selector)
- Test: build + grep dist (no unit harness for the dashboard)

- [ ] **Step 1: Add the Delete control to the books list**

In `dashboard/src/panels/books.js`, in the per-row render (the same place the "Set active" button is wired), add a Delete button and handler. Match the file's existing idiom (`api()` from `../lib/api.js`, `esc()`, `showToast()`, and `refreshActiveBook` already imported from `../main.js`):

```js
// in the row markup (alongside the Set active / active badge cell):
`<button class="bkDelete" data-slug="${esc(b.slug)}">Delete</button>`
```

```js
// after el.innerHTML, wire the buttons:
el.querySelectorAll('.bkDelete').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const slug = btn.getAttribute('data-slug');
    if (!confirm(`Delete book "${slug}"? This permanently removes its data and cannot be undone.`)) return;
    try {
      const r = await api('DELETE', `/api/books/${encodeURIComponent(slug)}`);
      showToast(`Deleted ${slug}` + (r.active ? ` — active is now ${r.active}` : ''));
      await renderList();
      await refreshActiveBook();
    } catch (e) {
      showToast('Delete failed: ' + (e?.message || e));
    }
  });
});
```

If the panel has a New Book creation form with author/pipeline selectors, add a **Voice** `<select>` populated from `GET /api/library?kind=voice` (or the existing library-list call the form uses) and include `voice` in the `POST /api/books` body. If the panel has no create form yet, skip this — book creation is exercised via the API/tests and `POST /api/books` now requires `voice`.

- [ ] **Step 2: Rebuild the dashboard**

Run: `npm run build:dashboard`
Expected: `✓ dashboard built → dist/index.html`.

- [ ] **Step 3: Verify build artifacts**

Run: `grep -c 'bkDelete' dashboard/dist/index.html && grep -c '__BOOKCLAW_AUTH_TOKEN__' dashboard/dist/index.html`
Expected: `bkDelete` ≥ 1; token placeholder = 1.

- [ ] **Step 4: Verify (no commit)**

Run: `npx tsc --noEmit && npm run test:unit`
Expected: tsc clean; suite green (dashboard JS isn't typechecked, but confirm nothing else broke).

---

### Task 6: feature-smoke — Voice assertion + real DELETE cleanup

**Files:**
- Modify: `tests/feature-smoke.sh`

- [ ] **Step 1: Assert the voice kind + create with a voice (Tier A)**

In `tests/feature-smoke.sh` Tier A, add a check that `GET /api/library?kind=voice` (or whatever the library-list endpoint is — match the existing `library list` check) includes a voice, and change the `books create` call to send `"voice":"default"` in the JSON body alongside `author`/`pipeline`. Use the existing `reqc`/`has_endpoint` helpers and `PASS`/`FAIL` reporting idiom already in the script.

```bash
# Tier A — alongside the existing "library list" check:
reqc GET "/api/library?kind=voice"
echo "$BODY" | grep -q '"default"' && pass "library voice kind :: default present" || fail "library voice kind"

# books create — add voice to the body:
reqc POST "/api/books" '{"title":"Smoke Book","author":"default","voice":"default","pipeline":"novel-pipeline"}'
```

- [ ] **Step 2: Replace the manual book-cleanup note with a real DELETE in teardown**

Find the teardown block that prints the `NOTE: book '...' has no DELETE endpoint yet (Phase 4)` line. Replace it with an actual delete of the created book slug (capture the slug from the create response earlier into a variable, e.g. `SMOKE_BOOK_SLUG`):

```bash
# teardown:
if [ -n "${SMOKE_BOOK_SLUG:-}" ]; then
  reqc DELETE "/api/books/${SMOKE_BOOK_SLUG}"
  echo "  [cleanup] deleted book ${SMOKE_BOOK_SLUG} (code ${CODE})"
fi
```

(Wire `SMOKE_BOOK_SLUG` from the `books create` response — the create returns `{ book: { slug } }`; extract it the same way other ids are extracted in the script.)

- [ ] **Step 3: Verify the script parses**

Run: `bash -n tests/feature-smoke.sh`
Expected: no syntax errors. (The full run happens post-deploy against Mercury, not in this task.)

- [ ] **Step 4: Verify (no commit)**

Run: `npx tsc --noEmit && npm run test:unit`
Expected: tsc clean; suite green.

---

### Task 7: Reseed stale data + final sweep + commit_message

**Files:**
- Modify: `docs/TODO.md` → `docs/COMPLETED.md` (move the three loose-end items)
- Create: `commit_message`

- [ ] **Step 1: Remove the stale local default-book (data expendable, decision 6)**

The on-disk `default-book` (if any) predates the new snapshot shape (no `templates/voice/`, author bundle still has 4 files). It will be reseeded fresh on next boot. Remove it locally so a dev boot reseeds:

```bash
rm -rf workspace/books/default-book workspace/.config/active-book.json 2>/dev/null || true
```

(On Mercury the same happens after deploy: the old `default-book` can be removed via `ssh mercury 'docker exec -u 0 bookclaw rm -rf /app/workspace/books/default-book /app/workspace/.config/active-book.json'` so boot reseeds with the new shape — note this in the handoff, do not run it here.)

- [ ] **Step 2: Final full sweep**

Run: `npx tsc --noEmit && npm run test:unit && npm run build:dashboard`
Expected: tsc clean; all unit tests pass; dashboard builds.

- [ ] **Step 3: Move TODO items to COMPLETED**

In `docs/TODO.md`, remove the Author/Voice split, per-book skills snapshot, and book DELETE entries (wherever they're tracked); add them to `docs/COMPLETED.md` under a `2026-06-06` heading with one line each.

- [ ] **Step 4: Write `commit_message`**

Create `commit_message` (repo root) summarizing the change: one-line summary, blank line, dash bullets covering the voice library kind, book voice+skills snapshot, SoulService two-dir composition, book DELETE, dashboard delete button, feature-smoke updates, and "no migration — default-book reseeded (decision 6)".

- [ ] **Step 5: Verify the working tree is push-ready**

Run: `git add -n . | grep -v commit_message`
Expected: lists the changed source/test/docs/library files (no stray runtime/workspace files; `commit_message` is gitignored). Leave everything uncommitted for the maintainer's `./push.sh`.

---

## Notes for the executor
- **No `git commit`** at any task — the maintainer runs `./push.sh`. The final `commit_message` (Task 7) is the handoff.
- After all tasks: deploy is `touch build_now` (maintainer), then run `tests/feature-smoke.sh` against Mercury (it now self-cleans via DELETE), and remove the old Mercury `default-book` so it reseeds with the new shape.
