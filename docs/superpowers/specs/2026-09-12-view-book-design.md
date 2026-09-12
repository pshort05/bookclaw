# View Book — Design

**Owner ask:** 2026-09-12
**Status:** design approved in conversation, open decisions resolved 2026-09-12 (see "Resolved decisions"); not yet implemented
**Mockup:** [`dashboard/concept/view-book.html`](../../../dashboard/concept/view-book.html)
**TODO:** "View Book — a reading/editing surface over a book's latest files", `docs/internal/TODO.md` → Larger items

## Problem

A finished book is a pile of step files. The deterministic romance pipelines write **seven files per chapter** — scene brief, first draft, improvement plan, rewrite, consistency audit, consistency apply, de-AI sweep — into `workspace/books/<slug>/data/`, named `project-<id>-step-<n>-<role>-chapter-<k>.md`. Three consequences:

1. **Finding the current text is archaeology.** Nothing in the Files UI says which of chapter 19's seven files is the chapter. The answer is "the highest-numbered prose step", which the author has to work out by reading file names.
2. **There is no reading surface.** The author reads the book in a file list or in Write, neither of which is laid out for prose. Defects survive that a reader would catch in a paragraph — the shipped chapter 19 of *Three Months of Summer* is in third person while chapters 1 and 24 are first-person Gia, carries a leaked model preamble (`Here's the revised Chapter 19, formatted in Markdown:`) and two literal `[blank line]` placeholders.
3. **Gates are approved without reading.** The Confirmations queue presents a chapter as a payload to approve or reject. Approving there means approving prose you have not comfortably read. *Three Months of Summer* stalled for three weeks because its chapter-8 gate expired unanswered, and the run was abandoned with 16 chapters unwritten.

The same book also has front matter, back matter, reference documents and launch assets that either exist as unrelated files or do not exist at all, with nothing showing which is which.

## Goals

- One surface where a book is **read in order**, from cover through launch copy.
- The **latest** version of anything is one click away, and **every earlier version is reachable and read-only**.
- The latest version of anything is **editable in place**, saved back to its own file.
- A paused run is legible: what is written, what is not, and — on the gated chapter, under its findings — the decision.
- **Mountable**: the same component serves a route, an overlay pulled up over another screen, and a "read before you approve" mount on a gate.

### Non-goals

Flexibility here means *reuse of this interface in other contexts*, not *growth of its feature set* (owner, 2026-09-12). No widget registry, no configurable layouts, no plugin content types. The item model stays exactly as general as the five groups that exist.

## Design

### 1. Mount contract

```tsx
<BookView
  slug={string}            // always explicit; never "the active book"
  initialItem?={ItemId}    // open on a chapter / document
  panes?={{ contents?: boolean; raw?: boolean }}
  onClose?={() => void}    // presence renders the close affordance
/>
```

Two rules make every other mount point free, and both cost nothing if taken up front:

- **`BookView` reads nothing from the URL and nothing from global state.** No `useParams`, no active-book pointer. A component that reaches for either can only ever be a route.
- **Layout sizes to its container, not the viewport.** The three-pane grid, the ~1,200px minimum-width guard and the pane toggles all key off the container, so an overlay at 1,400px behaves like a page at 1,400px.

Mount points on day one:

| Mount | Shell | Notes |
|---|---|---|
| Route | `routes/BookViewRoute.tsx` → `/book/:slug/view` | Thin wrapper: reads the param, renders `BookView`. |
| Book Drawer | third button beside "Open in Write" (`components/BookDrawer.tsx:192`) | Navigates to the route. |
| Overlay | `BookViewOverlay` over Board or Write | Escape to close; `panes={{raw:false}}` when narrow. |
| Gate | from a Confirmations `human-review` item | `initialItem` = the gated chapter, so the author reads before deciding. |

### 2. The item model

One shape for everything in the contents list:

```ts
type ItemKind = 'prose' | 'document' | 'cover';

interface BookItem {
  id: string;              // 'chapter:19' | 'front:title' | 'ref:continuity-review' | 'launch:amazon-description'
  group: GroupId;          // 'front' | 'manuscript' | 'back' | 'reference' | 'launch'
  title: string;
  kind: ItemKind;
  ready: boolean;          // false ⇒ ghost row
  derived?: boolean;       // assembled from other items ⇒ readable, never editable
  words?: number;
  flags?: Flag[];          // consistency / beat / style chips
  producedBy?: { skill: string; pipeline: string };  // ghost rows only
  versions: Version[];     // newest last; [] when !ready
}

interface Version { id: string; label: string; step?: string; createdAt: string; latest: boolean }
```

The panes branch on `kind`, never on "is this a chapter". A chapter is `kind: 'prose'` with seven versions; a copyright page is `kind: 'prose'` with one; a continuity review is `kind: 'document'` (same column, structural headings rather than a prose measure); the cover is `kind: 'cover'`, an artboard. `id` is **stable and content-addressed, never step-addressed** — see §3.

Version ids come from wherever the content does: the step id for anything a project produced, and the `writeWithVersion` file version for documents written outside a run. Either way the trail is ordered and only the last entry is `latest`.

Groups are data, resolved per book from the manifest and `library/sections/{front,back}-matter.md`, with one table mapping an unready item to the skill and pipeline that produce it:

| Group | Items | Skill | Pipeline |
|---|---|---|---|
| front | Cover | `cover-designer` | `book-launch` |
| front | Title page · Copyright · Dedication · Also-by | `format` | `format-export` |
| back | Acknowledgements · About the author · Also-by | `format` | `format-export` |
| back | Newsletter CTA | `blurb-writer` | `format-export` |
| launch | Back cover blurb · Amazon description · Social posts | `blurb-writer` | `book-launch` |
| launch | Categories & keywords | `research` | `book-launch` |
| launch | Ad copy | `ad-copy` | `book-launch` |
| launch | Launch checklist | `format` | `book-launch` |
| launch | Cover concepts | `cover-designer` | `book-launch` |

Dedication and Also-by are optional: they render as ghost rows chipped `optional` and are never counted as missing.

### 3. API — item-addressed, not step-addressed

The single hard-to-reverse decision. If the client fetches `project-84-step-178-humanize-de-ai-sweep-chapter-24.md`, every future content type has to impersonate a pipeline step, and the UI carries pipeline internals forever. Instead:

```
GET  /api/books/:slug/contents                      → { groups[], run }
GET  /api/books/:slug/items/:itemId[?version=<id>]  → { item, version, body, editable, file }
PUT  /api/books/:slug/items/:itemId                 → { body, versionId } → see §5
POST /api/books/:slug/compile                       → { file, words, chapters }
```

Gate decisions and resuming reuse what exists — `POST /api/projects/:id/review/action` and `POST /api/projects/:id/auto-execute`. This view opens no second path to a gate.

`run` is derived from the project bound to the book (`Project.bookSlug`):

```ts
interface RunState {
  projectId?: string;
  status: 'none' | 'writing' | 'paused' | 'gated' | 'complete';
  frontier: number;                 // highest chapter with completed prose
  total: number;                    // manifest format.chapterCount
  gate?: { confirmationId: string; stepId: string; itemId: string; findings: unknown; expiresAt: string };
}
```

Caching: the contents tree is fetched **once per slug** and shared across mounts, so pulling the board up repeatedly is cheap; only the open item's body is fetched on demand.

### 4. Version resolution — one shared helper, and an existing bug it fixes

Two places already answer "which file is chapter N", and **both are wrong for the `romance-*-deterministic` pipelines** (already logged in `docs/internal/TODO.md`):

- `gateway/src/services/manuscript-assembly.ts:17` — `CHAPTER_RE = /(write|polish)-chapter-(\d+)…/` matches neither `first-draft-chapter-N` nor `humanize-de-ai-sweep-chapter-N`, so the full-manuscript download returns **0 chapters** for this book. Compile cannot ship until this is fixed.
- `gateway/src/api/routes/_shared.ts:667` — `gatherChapters` selects on `label.includes('chapter')`, so it collects scene briefs and JSON audits alongside **two** full-prose steps per chapter, handing analysis features a duplicated manuscript.

View Book would be a third copy. Instead, add one helper and route all three through it:

```ts
// gateway/src/services/pipeline/chapter-files.ts
export function chapterVersions(steps, chapterNumber): Version[];   // ordered, prose + non-prose tagged
export function latestProseStep(steps, chapterNumber): Step | null; // the chapter
```

Classification is by role/label, not by file name: **prose** = first draft · rewrite · consistency apply · humanize/de-AI sweep; **non-prose** = scene brief · improvement plan · consistency audit (JSON). Non-prose versions stay in the trail — the author asked for all seven — but never satisfy `latestProseStep`, so assembly and analysis get one prose file per chapter.

### 5. Save routing — the risky part

`project.review` is **not persisted** and the state file stores only a ~567-character stub of each step result; full text rehydrates from the `.md` on restart, and `persistState` is debounced ~1s. A naive file write therefore loses edits in two different ways. One pure function owns the decision, so it can be unit-tested without HTTP:

```ts
type SaveMode =
  | { mode: 'file' }        // write the .md AND update the step result
  | { mode: 'gate-edit' }   // POST /review/action { action:'edit', editedText }
  | { mode: 'refuse'; reason: string };

export function decideSave(ctx: {
  versionIsLatest: boolean;
  itemReady: boolean;
  itemIsDerived: boolean;   // compiled output — assembled, never authored
  gateStepId?: string;      // run.gate?.stepId
  itemLatestStepId?: string;
  projectIsDriving: boolean;
}): SaveMode;
```

Rules, in order:

1. `!versionIsLatest` → **refuse**, "earlier versions are read-only".
2. `!itemReady` → **refuse**, "nothing to edit — run the `<skill>` skill first".
3. `itemIsDerived` → **refuse**, "compiled output is assembled from the chapters — edit a chapter and compile again". Editing it would be lost on the next compile and would silently diverge from its sources.
4. `gateStepId === itemLatestStepId` → **gate-edit**. The edit *is* the gate decision: it resolves the gate, writes the text as the chapter, and resumes. A plain file write here is overwritten when the pipeline resumes with `review.pendingResult`.
5. `projectIsDriving` → **refuse**, "the pipeline is writing this chapter right now".
6. otherwise → **file**: write the `.md` **and** update the step's stored result through the engine (not by patching `projects-state.json`), because a restart rehydrates from the file and a live run reads from the step.

### 6. The gate, read where it is read

Placement follows from the failure it exists to prevent: a control that clears a gate from a toolbar is a control that gets clicked without reading.

- **Header** — run state only: `Paused · gate at chapter 19`, `Writing chapter 12 of 24`, `Complete · 24 of 24`, with a link that scrolls to the chapter. No decision buttons.
- **Contents** — chapters past `frontier` render as ghost rows marked *not written*; the gated chapter carries a `gate` chip beside its consistency chips.
- **Reading pane, on the gated chapter, above the prose** — the gate panel: which step it paused after, time until the 24h expiry, the findings payload, then **Approve & continue · Regenerate chapter · Stop here**. The raw pane's save button becomes **Approve with my edits**, wired to §5 rule 4.

Opening a chapter past the frontier explains why it is empty and links back to the blocking gate.

### 7. Compile

`POST /api/books/:slug/compile` assembles front matter → chapters → back matter into one markdown file in the book's `data/` dir, via the §4 helper. Items that do not exist are skipped, not stubbed — a book with no front matter compiles to its chapters alone, and the response reports what went in. The header control is labelled **Compile** (not "Generate" — that word belongs to writing the book) and reads **Compile anyway** with `partial book · N of 24 chapters` whenever `frontier < total`. Compiling an unfinished book stays allowed and says so.

**The compiled file is readable in the view and never editable** (owner, 2026-09-12). It appears as the first row of **Reference**, `id: 'ref:compiled'`, `kind: 'document'`, `derived: true`, chipped `derived` and carrying the compile timestamp and word count. The raw pane shows it with the §5 rule-3 lock — "compiled output is assembled from the chapters" — so the only way to change it is to edit a chapter and compile again, which is the only way that can't silently diverge from its sources. Each compile writes through `writeWithVersion`, so earlier compiles stay in its version trail like any other item's history.

### 8. Layout and theme

The studio's tokens are the design system; this view introduces no palette. `Fraunces` for the book's own voice — title, chapter headings and the reading column at 17.5px/1.78 on a ~66-character measure — `Hanken Grotesk` for chrome, `IBM Plex Mono` for labels, line numbers and raw markdown. Semantic colour is separate from the ember accent: `--gold` for gates and read-only, `--alert` for defects, `--ok` for complete.

Below ~1,200px of **container** width the panes are replaced by an explicit "needs a wider window" state. This view is wide by nature and does not pretend otherwise (owner, 2026-09-12); it is exempt from the studio's responsive work, and the drawer button should say so rather than open something broken on a phone.

### 9. Pulling it up — the keyboard shortcut

The point of a mountable board is reaching it without navigating, so it gets an accelerator (owner, 2026-09-12). **This is the studio's first one**: today the only global key handlers are Escape-to-close (`App.tsx:13`, `BookDrawer.tsx:42`, the modals), and there is no shortcut registry to register with.

- **`b`** opens the View Book overlay; **Escape** closes it — matching the Escape convention already in the shell.
- **Bare key, guarded.** No modifier: `Cmd/Ctrl+B` is the bookmarks sidebar in Firefox and `Cmd/Ctrl+K` is the search bar, so a modifier combination costs a browser behaviour on someone's machine. The guard is the part that must not be improvised — ignore the key when `e.metaKey || e.ctrlKey || e.altKey`, when `e.isComposing`, or when the focused element is an `input`, `textarea` or `[contenteditable]`. Typing "b" in the raw editor or a chat box must never open a board.
- **Which book:** the one in context — the book route or Write session the author is already in, else the Board's open drawer, else the global active-book pointer. With no context at all it navigates to the Board rather than guessing a book.
- Implementation is a local `useBookViewShortcut()` in `book-view/`, not a shared abstraction. It moves to `frontend/shared` when a second accelerator exists; one caller does not justify a registry.

## Components / boundaries

| Unit | Responsibility | Depends on |
|---|---|---|
| `book-view/BookView.tsx` | Mountable shell: owns selection, version choice, pane visibility | the three panes, contents API |
| `book-view/BookContents.tsx` | Groups, rows, chips, filters (All / Written / Flagged) | `BookItem[]` |
| `book-view/ReadingPane.tsx` | Typeset body by `kind`; hosts `GatePanel` | `body`, `RunState` |
| `book-view/RawPane.tsx` | Line-numbered editor, dirty state, save/revert, read-only lock | `body`, `SaveMode` |
| `book-view/VersionTrail.tsx` | Ordered versions, latest marked, read-only history | `Version[]` |
| `book-view/GatePanel.tsx` | Findings + the four gate actions | `run.gate`, review API |
| `api/routes/books.routes.ts` | The four endpoints; no pipeline knowledge beyond the helper | `BookService`, contents builder |
| `services/book-contents.ts` | Builds the item tree from manifest + project steps + section templates | `chapter-files.ts`, `LibraryService` |
| `services/pipeline/chapter-files.ts` | Version + latest-prose resolution (shared with assembly, `gatherChapters`) | project steps |
| `services/book-save-routing.ts` | `decideSave` — pure, no I/O, no Express | — |
| `book-view/useBookViewShortcut.ts` | The `b` accelerator and its focus guard | — |

**No MCP tools** (owner, 2026-09-12): this is purely a human optimisation, so the new endpoints get no `mcp/` surface. The repo's lockstep rule binds a gateway route to the MCP tool that *wraps* it — here nothing wraps them, deliberately, and every tool not added is surface area not defended. An agent that genuinely needs this data already has `bookclaw_request`.

## Error handling / fail-soft

Follows the house pattern — degraded, never dead:

- No project bound to the book → `run.status: 'none'`; contents still lists whatever files exist. A book can be read without a run.
- A chapter file missing while its step exists (or vice-versa) → the row renders with a `missing file` chip and an empty body rather than a 500.
- `POST /compile` with `frontier < total` → succeeds, and the response reports `chapters` so the UI can state what it compiled.
- A gate that has expired (`ConfirmationGateService` 24h) → the panel says so and offers **Re-open the gate**, which is `/auto-execute` re-running the active step, the recovery path proven on this book (see the `expired-gate-recovery` note).
- `PUT` losing a race with the drive loop → `409` with the reason from `decideSave`, never a silent overwrite.

## Testing

`npm run test:unit` runs `node --test` over `tests/unit/*.test.ts`; `tests/api/api-test.sh` covers endpoints. TDD order:

1. `chapter-files.test.ts` — versions and latest-prose for `romance-sweet-deterministic` (7 steps/chapter), `novel-pipeline` (write/polish) and the legacy `humanize-deterministic` labels; asserts scene briefs, improvement plans and JSON audits are never `latestProseStep`. **Includes the regression that `manuscript-assembly` returns 24 chapters for project-84, not 0.**
2. `book-contents.test.ts` — tree shape: five groups, optional items chipped, ghost items carry the right skill/pipeline, flags map onto rows, `run` derived from a project with and without a gate.
3. `decide-save.test.ts` — all six rules, each in isolation. Two matter most: an edit on a gated chapter must return `gate-edit`, never `file`; and the compiled item must return `refuse` even though it is ready and latest.
4. `book-view-api.test.sh` — the four endpoints under auth; `PUT` on an earlier version is `409`; `PUT` on the compiled item is `409`; `PUT` on a gated chapter routes to the review action and clears the gate.
5. `book-view-shortcut.test.ts` — the accelerator fires on a bare `b`, and does **not** fire with a modifier, while composing, or when focus sits in an `input`/`textarea`/`[contenteditable]`.
6. Studio build assertion alongside the existing `studio-build` test.

Manual verification is not sufficient for the save path and must not be left in a transcript.

## Out of scope

Continuous whole-book scroll (one item at a time for now); diffing two versions; starting a run from this view (**Continue** only — cold starts keep their pipeline and model choices on the Board); WYSIWYG editing; phone layout; series-level or multi-book views; editing front matter derived from the manifest (title, author, copyright year) anywhere but book settings; **MCP tools for any of the new endpoints**; a general keyboard-shortcut registry.

## Resolved decisions (owner, 2026-09-12)

1. **Compiled output is viewable, not editable** — §7. It joins Reference as a `derived` item and is locked by `decideSave` rule 3; the edit path is "change a chapter, compile again".
2. **No new MCP surface** — Components / boundaries. This is a human optimisation; the endpoints stay UI-only.
3. **Keyboard shortcut added** — §9. Bare `b` with a focus guard, Escape to close, opening the book already in context.
