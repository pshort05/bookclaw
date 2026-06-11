# Book-Container Architecture

**Status:** Phases 0–7 implemented and deployed (as of 2026-06-09). Phases 8–12 remain. This doc is the roadmap source-of-truth; per-phase completion detail is in docs/COMPLETED.md and docs/TODO.md. This is the concrete
data-model design for the [North Star](TODO.md#north-star--the-ultimate-goal-use-this-to-weigh-every-other-decision)
multi-author / multi-book platform, and it subsumes the in-dashboard
prompt/skill editor (the "[In-dashboard editor for prompts + skills]" TODO item,
"#1") — that editor becomes the editing surface for this model rather than a
standalone global editor.

## Purpose

Today BookClaw assumes a single author identity (`workspace/soul/*.md`), treats
genre as a named genre profile (a library kind), snapshotted per book and injected into generation, hardcodes the production pipeline in
`services/projects.ts`, and stores per-project outputs in a flat
`workspace/projects/<slug>/`. There is no first-class "book" that owns state
across phases.

This design introduces the **book as a self-contained, portable container** that
owns both its inputs (author / genre / pipeline / skills — *templates*) and its
outputs (chapters, manuscript, exports — *data*). Books are created by **pulling
a snapshot** of templates from a shared **library**; once pulled, a book's
templates are editable and frozen to that book. A book is a plain directory of
markdown + JSON, so it can be backed up, shared, and version-controlled outside
the container.

## Decisions captured (2026-06-04)

1. **Sequencing** — finish and close the global editor (#1) first, then build
   this model and re-point the editor at it. (#1 is already deployed to Mercury
   in commit `2260fbe`; it awaits only a human click-through to close.)
2. **Snapshot semantics** — **copy-on-create, no auto-propagation.** Each book
   gets its own editable copy of the templates at creation. Library improvements
   do **not** flow into existing books automatically; an explicit, per-book
   **"re-pull from library"** action lets the author pull them in deliberately.
   This maximizes isolation and portability and pins a book's pipeline version
   so editing a library pipeline never corrupts a book mid-production.
3. **Storage** — **bind-mount the entire `workspace/`** to a host directory (one
   simple tree to back up). Note (verified 2026-06-05 against the running
   container): the encrypted vault is a **separate** Docker volume mounted at
   `/app/config/.vault`, *outside* `workspace/`, so it stays out of the
   bind-mounted tree automatically — secrets are not exposed by this decision.
   What lives in the bind-mounted tree is the writing data plus runtime state —
   audit logs (`.audit/`) and the SQLite memory index (`memory/`) — so "share a
   book" still means being selective at the subdirectory level (share
   `workspace/books/<book>/`, not `.audit`/`memory`).
4. **Versioning (data protection)** — every stored artifact that can change
   shape carries a `schemaVersion`. The app gates on it and **refuses
   (read-only / quarantine) rather than silently coercing** an incompatible
   book, so a version mismatch can never corrupt a book *even if the upgrade
   scripts fail or are never run*. See
   [Versioning and compatibility](#versioning-and-compatibility-data-protection).
5. **Backup & recovery** — point-in-time snapshots, **default ON** (disabling
   logs a loud startup warning). Local snapshots are uncompressed `{datetime}/`
   mirrors, **keep the last N (default 10)**, oldest pruned automatically. Cloud
   copies are **single zips** pushed via a layered mechanism (synced-folder
   directory-drop → optional rclone → optional post-backup hook); **BookClaw
   never deletes cloud backups** — the user prunes those. Default content is
   **books + library + config** (vault / audit / index excluded; full-workspace
   opt-in). See [Backup and recovery](#backup-and-recovery).

## Two intuitions this formalizes

- **templates vs data.** A book separates editable *inputs* (`templates/`) from
  generated *outputs* (`data/`). This matches a split already latent in the
  codebase (config files vs `workspace/projects/<slug>/` outputs) — it just
  re-homes both under the book.
- **library vs book snapshot.** Templates come from a central library you pull
  from; a book holds a *copy* you edit per book. This mirrors the built-in vs
  workspace-overlay pattern that already exists for skills (`SkillLoader`).

## Target data model

```
workspace/                       ← host bind-mount (entire tree; decision 3)
  library/                       ← USER library: editable source templates (overlay)
    authors/<name>/{SOUL,STYLE-GUIDE,VOICE-PROFILE,PERSONALITY}.md
    genres/<name>/{reader-expectations,tropes,themes,beats,must-haves,genre-killers,comps}.md
    pipelines/<name>.json        ← pipeline-as-data (steps, prompts, taskType, wordCountTarget, skill refs)
    sections/<name>.md           ← reusable book-section templates (front/back matter, etc.)
    skills/<category>/<name>/SKILL.md
  books/                         ← per-book containers (eventually replaces flat projects/)
    <book-slug>/
      book.json                  ← manifest (see below)
      templates/                 ← SNAPSHOT, copied from the resolved library at create; editable, frozen to this book
        author/{SOUL,STYLE-GUIDE,VOICE-PROFILE,PERSONALITY}.md
        genre/{reader-expectations,tropes,themes,beats,must-haves,genre-killers,comps}.md
        pipeline.json
        skills/<category>/<name>/SKILL.md
      data/                      ← generated outputs (today's workspace/projects/<slug>/ contents)
        premise.md  bible.md  outline.md
        chapters/chapter-NN.md
        manuscript.md  compiled.docx  compiled.epub
  .vault/  .audit/  .config/  memory/  audio/  images/   ← runtime/internal state (stays put; not part of a shared book)
```

### Three resolution layers (mirrors the skills overlay)

1. **Built-in library** — shipped in the image, read-only (e.g. `/app/library`,
   baked from a repo `library/` dir, alongside the existing built-in `skills/`).
   The current six `PROJECT_TEMPLATES` + `novel-pipeline` become the built-in
   pipelines; `workspace/soul/` becomes the seed for a built-in/default author.
2. **User library** — `workspace/library/`, editable, **overrides built-ins by
   name** (exactly how `workspace/skills/` overrides built-in skills today).
3. **Book snapshot** — `workspace/books/<slug>/templates/`, the per-book copy.
   This is what the running pipeline and `SoulService` actually read for that
   book.

"Pull a template into a book" = resolve the effective template (user library
entry if present, else built-in) and **copy** it into the book's `templates/`.

### `book.json` manifest (shape sketch)

```jsonc
{
  "id": "the-dragons-heir",
  "title": "The Dragon's Heir",
  "schemaVersion": 3,                    // THE compatibility gate (bumped only on breaking layout changes)
  "createdByApp": "10.2.0",              // provenance/diagnostics only — never gates behavior
  "lastWrittenByApp": "10.4.1",          // provenance/diagnostics only
  "phase": "production",                 // planning | bible | production | revision | format | launch
  "createdAt": "2026-06-04T...",
  "pulledFrom": {                        // provenance: which library entries + versions were snapshotted
    "author": { "name": "paul", "source": "user", "version": 3 },
    "genre":  { "name": "romantasy", "source": "builtin", "version": 1 },
    "pipeline": { "name": "novel-pipeline", "source": "builtin", "version": 1 }
  },
  "pipelineVersionPinned": true,         // editing the library pipeline never mutates this book
  "history": [ /* phase transitions, run records */ ]
}
```

`pulledFrom` records provenance so the "re-pull from library" action can show
the author a diff ("library author 'paul' is now v5; this book pinned v3") and
let them opt in.

## What this collides with (the real work)

1. **`SoulService` is a hardcoded singleton.** `gateway/src/services/soul.ts`
   loads one fixed `workspace/soul/` and exposes a single `getFullContext()`.
   Per-book authors require it to load *the active book's* `templates/author/`.
   This is the largest behavioral change. (`reload()` already exists from #1.)
2. **Pipelines are code, not data.** The 6 templates + `novel-pipeline` are TS
   constants in `services/projects.ts`. You cannot snapshot a hardcoded
   constant, so this model *requires* lifting pipelines to JSON. Keep the
   current definitions as the **built-in library seeds**; the engine reads the
   book's `templates/pipeline.json` at run time.
3. **The skills overlay landed as global.** #1 built `workspace/skills/`
   overriding built-ins globally. Books want a per-book skills snapshot — same
   override mechanism, narrower (per-book) scope. **Decided in Phase 1
   (2026-06-06): folded into the library.** The user overlay moved
   `workspace/skills/` → `workspace/library/skills/` (one-time fail-soft boot
   migration in `init/phase-05`); built-in skills stay baked at repo `skills/`
   (moving the tree would churn premium gitignore / Dockerfile / SKILLS.txt for
   no gain). Per-book scoping comes when book snapshots land (Phase 2).
4. **Two edit scopes, not one.** Editing a *library* template affects future
   books; editing a *book's copy* affects only that book. The #1 editor must
   surface both (and the re-pull action). This is the built-in/overlay pattern
   applied to the editor UI.
5. **`SandboxGuard` is `workspace/`-only.** It already covers the new roots
   since they live under `workspace/`, but the path whitelist in
   `authoring.routes.ts` (currently `soul/*.md` + `workspace/skills/`) must be
   extended to library and per-book template paths via `safePath`.
6. **Path resolution.** `ROOT_DIR` (`gateway/src/paths.ts`) is derived from the
   script location and resolves to `/app` in production regardless of the volume
   type, so switching the workspace from a named volume to a host bind-mount
   needs **no code change** — only a `docker/docker-compose.yml` change.

## Docker / storage change

Current `docker/docker-compose.yml` uses a named volume:

```yaml
volumes:
  - bookclaw-workspace:/app/workspace
```

Change to a host bind-mount (precedent already exists for `AUTHOR_OS_PATH`):

```yaml
volumes:
  - ${BOOKCLAW_WORKSPACE_PATH:-~/bookclaw-workspace}:/app/workspace
```

In general, migrating existing named-volume data would be a one-time copy from
the `bookclaw-workspace` volume into the chosen host directory before the switch.
**For this install the existing workspace was disposable (owner decision
2026-06-05), so no copy was performed — the cutover used a fresh host dir.** The
`bookclaw-vault` volume **stays a named volume** (it is already separate at
`/app/config/.vault`, outside the workspace tree, so it is unaffected by the
bind-mount and keeps secrets out of the shared host directory).

**Bind-mount ownership gotcha (learned during the cutover):** the image runs as a
baked non-root user (`bookclaw`, uid 999). Docker auto-owns a *named volume* to
match the image's mountpoint user, but it does **not** chown a *host bind-mount* —
it keeps the host's ownership. A freshly created host workspace dir is therefore
owned by the deploying user (uid 1000), and the app (uid 999) crashes on its
first `mkdir` under `/app/workspace`. The container must keep running as
`bookclaw` (uid 999) because the existing vault volume is owned by 999, so the
fix is to chown the host dir **to the app user**, not to change the run-user.
`deploy.sh` does this idempotently after the build via a one-off root container
(`docker compose run --rm --user 0 --entrypoint chown bookclaw -R bookclaw:bookclaw /app/workspace`).
Consequence for backup/sharing: the host workspace is owned by uid 999, so the
deploying user reads it as "other" (dir mode 775) — fine for copy/backup, but
writes/deletes from the host need `sudo` or a root container.

## Versioning and compatibility (data protection)

A newer (or older) BookClaw must never silently corrupt a book written by a
different version. Upgrade scripts are the happy path; the **version gate is the
guardrail that holds even when those scripts fail or are skipped.**

### Two versions, distinct roles

- **`schemaVersion`** (integer, per artifact) — the *only* compatibility signal.
  Bumped solely when an artifact's layout/format changes in a breaking way, not
  on every release. Gating on the app's marketing version (v10 vs v15) would
  false-alarm constantly because most releases don't touch storage.
- **`createdByApp` / `lastWrittenByApp`** (app version strings) — provenance and
  diagnostics only. Recorded, never used to gate behavior.

### Versioned artifacts (keep the set small)

- `book.json` → `schemaVersion` for the container/manifest layout.
- `templates/pipeline.json` → its own `schemaVersion` (most structured, most
  likely to evolve).
- `workspace/.bookclaw/workspace.json` → `schemaVersion` for the overall
  workspace layout (drives whole-workspace migrations, e.g. the Phase 0 relayout).
- Author/genre files are freeform prose — no format gate; their directory layout
  is covered by the book schema. `SKILL.md` frontmatter already has a shape;
  version it later only if it gains breaking fields.

### The gate (on open)

The app declares, per artifact type, a supported range `[MIN_SUPPORTED, CURRENT]`.
`BookService.open()` (and the library / workspace loaders) check the artifact's
`schemaVersion` against it:

| Condition | Meaning | Action |
|---|---|---|
| `MIN_SUPPORTED <= v <= CURRENT` | compatible | open normally; if `v < CURRENT`, may offer (or, opt-in, auto-run) a safe forward migration |
| `v < MIN_SUPPORTED` | too old for this app | **refuse to open** — quarantine read-only, surface an "upgrade this book" action |
| `v > CURRENT` | written by a newer app (you downgraded) | **refuse to write** — open read-only, tell the user to run the newer app |

**Principle: fail-closed per book, fail-soft per app.** An incompatible book
degrades only itself (read-only / quarantine, shown with a status badge in the
dashboard book list); the gateway still boots and compatible books open — the
same fail-soft philosophy as the existing init sequence, scoped to one book.

The too-new (downgrade) row is the most dangerous direction and the one a naive
design misses: old code does not know the newer fields and would **drop them on
the next write**. The version gate is what makes that read-only instead.

### Migrations

- Ordered, idempotent steps `vN -> vN+1` per artifact type, chained.
- Run **explicitly** — a `scripts/` upgrade command plus a dashboard "upgrade
  book" action — never silently on a too-old book unless the user opts into
  auto-migrate.
- **Back up first.** Because a book is a self-contained directory, the migrator
  copies `books/<slug>/` -> `books/<slug>.bak-v<from>` before mutating. Cheap
  insurance, independent of the user's own backups.

### Worked example (the v10 -> v15 case)

A book written by v10 carries `schemaVersion: 3`. v15 supports `[4, 6]`. On open,
`3 < 4` -> quarantine + "upgrade" offer; the migrator backs up to
`books/<slug>.bak-v3`, then runs `3 -> 4 -> 5 -> 6`. If the user never upgrades,
the book stays safely read-only and is never silently rewritten. The reverse
(running v10 against a book v15 wrote, `6 > 3`) hits the too-new row and is also
forced read-only.

## Backup and recovery

Two goals, per the requirement: (1) **revert** to a last-saved version, and (2)
get data **offsite** (Dropbox / Google Drive / OneDrive / Box). This is
point-in-time recovery — distinct from the `schemaVersion` gate and the
always-on pre-migration backup above. Restoring an old backup still passes
through the version gate, so recovery and compatibility reinforce each other (a
years-old restored book is quarantined for upgrade, never silently corrupted).

### Defaults and the off-warning

`backup.enabled` defaults **true**; disabling it logs a loud startup `⚠` (the
same posture-logging pattern as `BOOKCLAW_AUTH_DISABLED` / the security
perimeter). Default-ON covers **local** snapshots — the data-loss floor. Cloud
destinations are always opt-in (they need configuration).

### What gets backed up

- **Default content: `books/` + `library/` + `config/`.** Excluded by default:
  `.vault` (secrets), `.audit`, the SQLite memory index, and regenerable caches
  (`audio/`, `images/`). Full-workspace is opt-in (`backup.scope: "full"`).
- **Secrets rule (enforced):** a backup must never carry the vault key
  (`BOOKCLAW_VAULT_KEY`, in `.env` *outside* `workspace/`) together with
  `vault.enc`. Even under `scope: "full"` the key stays out of the archive —
  co-locating them would defeat the encryption.

### Where backups live

Outside the bind-mounted workspace (so backups aren't themselves backed up): a
configurable host dir, default `~/bookclaw-backups/` (sibling of the workspace
bind-mount).

### Local snapshots (the "revert" path)

- Format: **uncompressed mirror**, `~/bookclaw-backups/{datetime}/…` —
  browseable, dedup-friendly, supports **per-book restore**.
- Retention: **keep the last N (default 10)**; oldest beyond N pruned
  automatically (`backup.local.keep`).
- Restore: list snapshots → restore the whole workspace or a single book from a
  chosen `{datetime}`. Restore overwrites, so it **snapshots current state
  first**. "Revert this book to the last saved version" is the common per-book
  case.

### Cloud copies (the "offsite" path)

- Format: **single zip** per snapshot (one file is easiest to upload).
- **Retention: none — BookClaw never deletes remote data.** Cloud copies
  accumulate; the user prunes old ones. (Deleting from someone's cloud is
  exactly the kind of irreversible outbound action we will not automate.)
- Layered mechanism (fail-soft; each layer optional, absence logged `⚠`):
  1. **Directory-drop** — copy the zip into any destination directory, e.g. a
     host folder already synced to Dropbox/GDrive (this infra already runs
     Dropbox). Zero credentials in BookClaw.
  2. **rclone** — `rclone copy <zip> <remote>:` to a user-configured remote
     (Dropbox/GDrive/OneDrive/Box/…). Skipped with a notice if `rclone` absent.
  3. **Post-backup hook** — a user script run after each backup, receiving the
     snapshot/zip path, for any other "move my data" process.
- **Confirmation gate:** enabling a cloud destination is an external side effect
  ("upload" is a gated action), so it passes through `ConfirmationGateService`
  once at setup; scheduled syncs then run under that approval. Local backups are
  internal and not gated.

### Triggers

Scheduled (in-process interval — container-portable, no host systemd needed;
`backup.intervalHours`), on project/phase completion (reuse `onProjectCompleted`),
before destructive ops (restore, schema migration), and manual (API / dashboard
"Back up now").

### Config sketch (`config/default.json`)

```jsonc
"backup": {
  "enabled": true,                  // default ON; false logs a loud startup warning
  "localPath": "~/bookclaw-backups",
  "scope": "standard",              // standard = books+library+config | full = whole workspace (vault key still excluded)
  "local": { "format": "mirror", "keep": 10 },
  "cloud": {
    "enabled": false,               // opt-in; enabling a destination is confirmation-gated
    "format": "zip",
    "destinations": [],             // directory paths and/or rclone remotes; BookClaw never prunes these
    "hook": null                    // optional post-backup script path
  },
  "intervalHours": 24,
  "onCompletion": true
}
```

### API (API-first)

`GET /api/backups` (list snapshots + last-run/status), `POST /api/backups` (back
up now), `POST /api/backups/:id/restore` (optional `{ book }` for per-book
revert), `GET`/`PUT /api/backups/config`. Dashboard surfaces last-backup time, a
"Back up now" button, a restore picker, and a **warning banner when backups are
disabled**.

## Security considerations

- **Shared/imported books are untrusted input.** A book's `templates/` contains
  `SKILL.md` and `pipeline.json` prompt text that feeds straight into the model.
  Importing a book is therefore equivalent to accepting inbound user content and
  must run through the existing `InjectionDetector` and be gated by
  `ConfirmationGateService` (import is a side-effecting, externally-sourced
  action). Validate skill frontmatter and pipeline JSON on import.
- **Never expose `.vault` in a shared book.** Sharing operates on
  `workspace/books/<slug>/` only. The export/share action must refuse to include
  anything outside a single book directory.
- **`safePath` everywhere.** All read/write of library and book template files
  goes through `safePath` against the correct base, as the authoring routes
  already do.
- **Backups can exfiltrate everything.** Cloud backup is an outbound side
  effect: enabling a destination is confirmation-gated, default content excludes
  the vault and runtime state, and the vault key is never archived alongside
  `vault.enc`. See [Backup and recovery](#backup-and-recovery).

## Migration path (no breakage on upgrade)

1. `workspace/soul/` → a default author in the library
   (`library/authors/default/` or a built-in default).
2. Existing `workspace/projects/<slug>/` → default books under
   `workspace/books/<slug>/` with a generated `book.json` and a `templates/`
   snapshot taken from the current global soul + the matching built-in pipeline.
3. Current hardcoded `PROJECT_TEMPLATES` + `novel-pipeline` → built-in library
   pipelines.

Provide the migration as an idempotent script so a running install upgrades in
place; old project paths remain readable until migrated.

## Phased implementation plan

Each phase is independently shippable and verifiable.

- **Phase 0 — Storage/Docker.** *(Implemented + deployed to Mercury 2026-06-05.)*
  Switch compose to a host bind-mounted workspace
  (`${BOOKCLAW_WORKSPACE_PATH:-/home/paul/bookclaw-workspace}`); `deploy.sh`
  ensures the host dir exists, records the path in `docker/.env`, and **aligns
  ownership to the container's app user** (see the Docker note below); stamp a
  `workspace/.bookclaw/workspace.json` schema marker on boot
  (`WORKSPACE_SCHEMA_VERSION`, no gate yet). **No data migration** — the existing
  workspace was disposable (owner decision 2026-06-05), so the cutover started on
  a fresh dir. *Verified on Mercury:* container `Up (healthy)`, `healthz=200`,
  `/api/status` `401` (auth enforced, vault decrypted = keys preserved), marker
  present on the host bind-mount, `docker inspect` shows the bind. (Local smoke +
  API tests still need a free `:3847`; unit 34/34 + marker stamp/idempotency were
  verified locally.)
- **Phase 1 — Library (read side).** *(Implemented 2026-06-06 on branch
  `feat/book-container-phase-1-library`; pending Mercury deploy + acceptance.)*
  Built-in `library/` dir (authors/genres/pipelines/sections, baked at
  `/app/library`) + `LibraryService` with built-in + `workspace/library/` user
  overlay and `reload()` (clones the `SkillLoader` pattern); five template kinds
  (author, genre, pipeline, section, skill — skills delegated to `SkillLoader`).
  Read API `GET /api/library[/:kind[/:name]]`. The 6 static project templates
  were lifted to data via `exportBuiltinPipelines()` (committed
  `library/pipelines/*.json`, drift-guarded by a unit test) so they are
  selectable; `novel-pipeline` ships as a `dynamic:true` descriptor (full
  data-expansion deferred to Phase 3). The skills overlay was folded in (see
  "collides with" #3). Plan:
  `docs/superpowers/plans/2026-06-06-book-container-phase-1-library.md`
  (completion recorded in `docs/COMPLETED.md`). *Verified:* unit tests
  override-by-name + reload + pipeline drift guard + migration; API lists
  templates; `tsc` clean. *Deferred to Phase 3:* the engine still reads the
  hardcoded `PROJECT_TEMPLATES` (the JSON is a parallel copy kept in sync by the
  drift guard until Phase 3 deletes the constants), and `novel-pipeline.json` is
  a placeholder unguarded by the drift test.
- **Phase 2 — Book entity + snapshot-on-create + version gate.** *(Implemented
  **lean** 2026-06-06; pending Mercury deploy + click-through acceptance.)*
  `book-types.ts` (`BOOK_SCHEMA_VERSION=1`, `slugify`, `classifyVersion`);
  `BookService.create()` snapshots resolved library templates into
  `workspace/books/<slug>/templates/` (author/genre/pipeline/sections) + a
  `book.json` manifest; `list()`/`open()` apply the compatibility gate (in-range
  → ok, too-old → quarantine, too-new → read-only). API `GET /api/books`,
  `GET /api/books/:slug`, `POST /api/books`. **New Book page** (dashboard "Books"
  panel) lists books with gate-status badges and creates one by selecting library
  components. Plan:
  `docs/superpowers/plans/2026-06-06-book-container-phase-2-book-entity.md`
  (completion recorded in `docs/COMPLETED.md`). *Verified:* unit tests for slug, the
  gate (too-old/too-new/in-range via `classifyVersion`, `list`, `open`), and
  create→snapshot+manifest (incl. genre-less path + dedup); API contract tests.
  **Deferred (lean):** the migration *runners* (ordered `vN→vN+1` chains +
  pre-migration backup + "upgrade book" command/UI) and existing-soul/project
  migration — no v2 schema exists and the workspace is fresh (nothing to
  migrate); the version *gate* still ships. **Also deferred:** snapshotting
  **skills** into the book (skills only matter once injected into a book's
  pipeline — Phase 3/4). Books are stored but do **not** drive generation yet
  (Phase 3).
- **Phase 3 — Per-book wiring.** *(Implemented 2026-06-06; pending push + Mercury
  deploy + safety-net validation. Spec/plan under `docs/superpowers/`.)* A global
  active-book pointer (`workspace/.config/active-book.json`) + Default Book
  auto-seed; `SoulService.useBook()` loads the active book's `templates/author/`;
  `ProjectEngine.createProjectFromPipeline()` reads the book's
  `templates/pipeline.json` (the 6-phase macro chain resolves each static phase
  from the library; dynamic `novel-pipeline`/`book-production` stay
  code-generated); all outputs → `workspace/books/<slug>/data/` (readers
  re-pointed too); `GET`/`POST /api/books/active` + dashboard selector; deleted
  `PROJECT_TEMPLATES`/exporter/gen-script/drift-guard (library JSON is canonical).
  Per **decision 6** (data expendable until v6) there is **no version-gate
  enforcement** — status is informational only. **Deferred:** per-book skills
  snapshot, the Author/Voice asset split, concurrency. *Verify (post-deploy):*
  `tests/openrouter-pipeline.sh` + `tests/feature-smoke.sh` are the end-to-end
  safety net for the rewired engine.
- **Phase 4 — Re-point the editor (#1) + re-pull.** *(Implemented 2026-06-07;
  pending Mercury deploy + safety-net validation. Spec/plan under
  `docs/superpowers/`.)* The editor edits either a shared **library** template
  (workspace-overlay CRUD; built-ins read-only) or the **active book's
  snapshot**, across author/voice/genre/sections/skills/pipeline. Per-book
  **re-pull from library** does a true 3-way merge against a pristine
  `.baseline/` captured at create time (`gateway/src/services/merge.ts` via
  `node-diff3`; `BookService.repullStatus()`/`repull()`): non-conflicting changes
  auto-merge, collisions get git-style markers; pipeline JSON is whole-asset
  take/keep; baseline-less (pre-Phase-4) books fall back to keep-mine/take-library.
  *Verify (post-deploy):* `tests/feature-smoke.sh` (library-write + book-snapshot
  + re-pull assertions) + `tests/openrouter-pipeline.sh`.
- **Phase 5 — Share/import security.** *(Implemented 2026-06-07; pending Mercury
  deploy + safety-net validation.)* Export a book as a single portable `.zip`
  (whitelist: `book.json` + `templates/` + `data/`; never `.baseline/` or the
  vault) and import one back via `BookTransferService` (`gateway/src/services/
  book-transfer.ts`): extract to an isolated `workspace/.import-staging/`, with
  per-entry zip-slip / absolute-path / symlink / off-whitelist rejection;
  `classifyVersion`; `InjectionDetector` scan of every prompt-bearing file
  (author/voice/genre/sections `.md`, pipeline step prompts, `SKILL.md`) + `data/`
  text. **Structural violations hard-reject (400); a clean+compatible book lands
  directly; injection findings OR an incompatible version route through the
  `ConfirmationGate`** (24h, no auto-approve) — `POST /api/books/import/finalize`
  consumes only an *approved* `book-transfer` confirmation. Imported books get a
  fresh slug + re-seeded `.baseline/`; orphan staging dirs are swept on boot.
  Routes `GET /api/books/:slug/export`, `POST /api/books/import`,
  `POST /api/books/import/finalize`; dashboard Export/Import in the books panel.
  *Verify (post-deploy):* `tests/feature-smoke.sh` export→import round-trip +
  gated malicious-skill import. Spec/plan under `docs/superpowers/`.
- **Phase 6 — Front-end / UI rewrite.** **(Implemented 2026-06-08.)** Replaced the single self-contained
  vanilla-JS dashboard bundle with a component-based front-end (framework + a
  state layer that does **not** assume a single global active book). Migrated the
  existing surfaces (chat, projects, books, the two-scope library editor,
  re-pull, settings, HQ/insights) onto reusable components and established the
  multi-book-capable state model that the concurrency + book-board phases (8, 9)
  build on. The v6 React + Vite studio became the only UI at port 3847; a standalone Chat app launched on a 2nd port (3848); the legacy vanilla-JS dashboard was retired. *Verify:* feature parity with the current dashboard; the smoke +
  feature tests pass unchanged against the same API; the security perimeter
  (token injection, same-origin CSP) is preserved.
- **Phase 7 — Genre wiring.** **(Implemented 2026-06-09.)** Injected the active book's genre snapshot
  (tropes / beats / reader-expectations / comps) into generation prompts
  alongside the Author identity and Voice style, so a book genuinely "writes in
  its own genre" end-to-end. Genre was snapshot-but-unwired until here.
  *Verify:* genre content reaches the relevant pipeline steps; changing a book's
  genre changes output; genre re-pull works. BookService.getActiveGenreGuide() composes the active book's templates/genre/*.md (7-file schema) and buildSystemPrompt injects a '# Active Book — Genre Guide' block reaching chat and every pipeline step; see docs/GENRE-GUIDE-TEMPLATE.md.
- **Phase 8 — Multi-book concurrency.** **(Implemented 2026-06-10.)** Replaced the
  single global active-book pointer *as the generation driver* with an immutable
  per-project book binding (`Project.bookSlug`, captured at creation). `BookService`
  gained stateless `…Of(slug)` accessors (the `active…()` methods are now wrappers);
  `SoulService.composeForBook()` composes a book's Author/Voice without mutating the
  singleton; `handleMessage(…, bookSlug?)` composes soul+genre for the bound book;
  project output routes via `dataDirOf(project.bookSlug) ?? activeDataDir() ?? legacy`.
  Chat still follows the global pointer (per-channel selection is Phase 10). *Verified:*
  148 unit tests + live feature-smoke 68/0/0 incl. the Tier-D proof (bind to A, flip
  active→B, A still receives the output — binding beats the global pointer); a
  post-implementation high-effort `/code-review` caught and fixed two prompt-composition
  leaks (the execute/auto-execute routes and the dynamic-pipeline creation branch).
  Spec/plan: `docs/superpowers/{specs,plans}/2026-06-10-phase8-multi-book-concurrency*`.
- **Phase 9 — Book-board UI.** **(Implemented 2026-06-11.)** The studio's face: the
  Book Board now shows, per book, the phase, status, suggested **next action**, a
  **6-segment phase progress bar**, and a **live "writing · <step>" strip** when a
  bound project is running (the rail's Generating/Idle counts went live too). Sourced
  by enriching `GET /api/books` with `next` + `live` (one call) via a pure,
  unit-tested `buildBookCards()` — `live` derives from active projects bound by the
  Phase-8 `bookSlug`. Drill-in drawer (assets / phase timeline / set-active /
  open-in-Write) unchanged. Shipped alongside three studio polish items: activity
  timestamps `HH:MM:SS`, single-spaced activity rows, and 4-decimal cost precision
  (`$0.0001`) on spend (studio + chat). *Verified:* 156 unit tests + live
  feature-smoke 69/0/0 incl. the enriched-`/api/books` assertion; mockup
  `dashboard/concept/phase9-book-board.html`. Spec/plan:
  `docs/superpowers/{specs,plans}/2026-06-11-phase9-book-board-ui*`.
- **Phase 10 — Per-channel active book.** Telegram / web / API callers each
  select their own active book independently (extends the
  conversation-history-by-channel isolation). *Verify:* a Telegram command and a
  web session target different books concurrently with no cross-contamination.
- **Phase 11 — Backup & recovery.** *(Was Phase 6 in the original plan; moved to
  the very end — a temporary host-level workaround covers backups in the interim,
  and the official release is gated on this final step.)* Local mirror snapshots
  (keep-N, default 10) + restore (whole-workspace and per-book); default-ON with
  the off-warning; cloud zip push via directory-drop → optional rclone → optional
  hook, gated at destination setup; triggers (scheduled + on-completion +
  manual). *Verify:* a snapshot appears under the backup dir; the 11th prunes the
  oldest; a per-book restore round-trips a modified book; disabling logs the
  warning; a too-old restored book hits the version gate (read-only). **This is
  the release gate.**
- **Phase 12 — Library element share/import.** *(Post-release enhancement —
  lands after the Phase 11 release gate.)* Export an individual **library entry**
  (author / voice / genre / pipeline / section / skill) as a portable file, and
  import one into the workspace **library overlay** — the library-level analog of
  Phase 5's whole-book share/import. Reuses Phase 5's security pipeline
  (extract-to-staging → structural validation → `InjectionDetector` scan of the
  entry's prompt-bearing content → ConfirmationGate on detection) and Phase 4's
  library write path (`LibraryService.writeEntry`/`createEntry`; overlay shadows
  a built-in by name). *Verify:* export an author/genre/pipeline and re-import it
  into the library (create-or-override by name, respecting the overlay-shadows
  semantics); a malicious imported element is gated; traversal/zip-slip blocked;
  importing a skill lands it via the SkillLoader overlay path.

## Out of scope (for this design)

- Broad genre library content (ship a small seed set; expansion is content work).
  *(Genre **wiring** into generation is now Phase 7; this is the content/breadth, which stays out of scope.)*
- The dashboard "book board" UI and per-channel active-book selection were
  out-of-scope for the original data-model design; they are now scheduled as
  **Phase 9** and **Phase 10** respectively (the front-end rewrite, Phase 6, is
  their prerequisite).
- Discord bridge parity (stub, per existing project posture).
- Incremental / deduplicated backups (rsync-delta, hardlink trees). Start with
  full mirror + keep-N; optimize only if snapshot size becomes a problem.
- Automatic cloud retention/pruning — by decision, BookClaw never deletes remote
  data; the user manages cloud cleanup.
