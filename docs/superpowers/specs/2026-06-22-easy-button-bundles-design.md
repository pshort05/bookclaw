# Easy Button — Starter Bundles: Design

**Date:** 2026-06-22
**Status:** Design approved (brainstorming). Next: implementation plan (writing-plans).
**TODO item:** Targeted feature roadmap #1 ("Easy Button" onboarding) / Strategy Item 1.

## Goal

A studio-only **3-click "New Book — Easy" wizard** that turns a one-sentence idea into a running novel, built **entirely from public, give-away-able `library/` assets**. It widens BookClaw's reach (a power engine a beginner can use) without exposing any proprietary data.

## Guiding constraint (the reason this design exists)

**Give away the method, not the books.** The owner's real pen names, PKstyle voice DNA, and manuscripts are proprietary and live in the **gitignored** `workspace/` overlay. The built-in `library/` is committed/public. This feature draws **only** from built-in `library/` assets, so shipping it (and its bundles) exposes nothing proprietary. This is enforced by a test (see Testing), not just convention.

## Decisions captured in brainstorming

- **Entry model:** bundle-first. The wizard's middle step is "pick a Starter Bundle"; each bundle is the headline artifact.
- **Bundle contents:** rich / fully configured — voice + genre + generation pipeline + Book Format (structure × form × chapter count × words-per-chapter) + model tier.
- **Storage:** frontend-only presets (a TS data file in the studio), not a new backend library kind. Selecting a bundle still results in a normal `POST /api/books` call, so creation stays API-backed. Consequence (accepted): bundles are a web-studio feature only (not exposed to Telegram/MCP), which is fine — the Easy Button is inherently a web wizard.
- **Start action:** create the book, then immediately auto-run the **planning** pipeline (not the whole novel) on the **free/cheap** model tier, showing live progress.
- **Roster (MVP):** 3 bundles — Romance, Sci-Fi, Thriller ("minimal proof").

## Architecture & scope

A new studio route (working name `/start`) plus a frontend bundle catalog. The existing New Book page becomes the implicit **Advanced** path (progressive disclosure — no rework). The backend already accepts everything a bundle needs (`POST /api/books` takes `author`, `voice`, `genre`, `sequence`, and the `format` fields), so this is **almost entirely frontend** work; the only possible backend touch is confirming/setting the cheap-tier default on the auto-run.

## Components

### 1. Bundle catalog — `frontend/studio/src/data/bundles.ts`

A typed array. Each entry:

```ts
export interface StarterBundle {
  id: string;            // 'romance' | 'scifi' | 'thriller'
  title: string;         // gallery card title
  tagline: string;       // one-line description
  icon: string;          // Font Awesome class, matching existing studio usage
  author: string;        // built-in library/authors slug
  voice: string;         // built-in library/voices slug (usually == author)
  genre: string;         // built-in library/genres slug
  sequence: string;      // built-in library/sequences slug
  format: {
    structure: string;       // story-structures.ts catalog id
    form: string;            // story-forms.ts id
    chapters: number;
    wordsPerChapter: number;
  };
  modelTier: 'free';     // beginner default
}
```

### 2. The three bundles (all reference assets that already exist in built-in `library/`)

| id | title | author/voice | genre | sequence | structure | form | chapters × words |
|----|-------|--------------|-------|----------|-----------|------|------------------|
| `romance` | Contemporary Romance | `warm-smalltown-romance` | `contemporary-romance` | `novel` | `romancing_the_beat` | `novel` | 32 × 2,500 |
| `scifi` | Hard Sci-Fi | `kinetic-ya-scifi` | `hard-science-fiction` | `novel` | `three_act` | `novel` | 30 × 2,800 |
| `thriller` | Thriller | `contemporary-thriller` | `military-thriller` | `novel` | `three_act` | `novel` | 40 × 2,000 |

Notes: there is no plain `thriller`/`science-fiction` genre directory, so each maps to the closest clean generic sub-genre. The exact genre/voice slug per bundle may be fine-tuned during planning, but every value above is a real committed asset (verified: authors/voices `warm-smalltown-romance`, `kinetic-ya-scifi`, `contemporary-thriller`; genres `contemporary-romance`, `hard-science-fiction`, `military-thriller`; sequence `novel`; structures `romancing_the_beat`, `three_act`; form `novel`).

### 3. Wizard — new studio route `/start`

Three steps, one decision each:

1. **Describe** — a working **title** field + a one-sentence **premise**. The premise seeds the book's braindump/description fed into planning.
2. **Pick a bundle** — a gallery of the 3 cards (title, tagline, icon, "≈80k-word novel" summary line derived from `chapters × wordsPerChapter`).
3. **Review & start** — a plain-language summary ("You're writing a *Contemporary Romance* novel, ~80k words, in the warm small-town voice, structured on Romancing the Beat") and a primary **Start writing** button.

### 4. Create + auto-run flow

On **Start writing**:

1. `POST /api/books` with the resolved bundle fields (`title`, `author`, `voice`, `genre`, `sequence`) plus the `format` fields parsed by the existing book-format input path. Returns the new book (slug + manifest with `format` persisted).
2. Create a project **bound to the book** that runs the `novel` sequence's first pipeline (**planning**), and trigger auto-execute on the **free/cheap** model tier.
3. Navigate to the live progress view (the existing project-run / book progress surface) so the beginner watches planning run.

Exact endpoint names for steps 2–3 (book→project run binding, auto-execute, tier selection) are confirmed against the current routes in the implementation plan; the mechanism already exists (projects are book-bound and have an auto-execute path).

## Data flow

```
bundles.ts (frontend data)
   │  user picks a card
   ▼
Wizard collects { title, premise, bundle }
   │  Start writing
   ▼
POST /api/books { title, author, voice, genre, sequence, + format fields }
   │  → book slug
   ▼
create project bound to bookSlug (planning pipeline of `novel`) → auto-execute (free tier)
   │
   ▼
live progress view
```

## IP-safety guardrail

`bundles.ts` may reference **only committed built-in `library/` slugs** — never a `workspace/` overlay asset, never PKstyle, never a real pen name. A unit test enforces this (below), so "method not books" cannot silently regress when the roster grows.

## Error handling

- A bundle referencing a missing asset is a **build-time/test failure** (the unit test fails), never a runtime surprise.
- If `POST /api/books` fails (e.g. duplicate slug), the wizard surfaces the error on the review step and stays put; nothing is half-created beyond what the API already guards.
- Auto-run failures degrade to "book created, planning didn't start" with a retry affordance — the book still exists and is usable via the normal UI (fail-soft, matching the app's posture).

## Testing

- **Unit — `frontend/studio/.../bundles.test.ts`** (or a backend test reading the same data): for every bundle assert
  1. `author`, `voice`, `genre`, `sequence` each exist under built-in `library/` (the IP guardrail + correctness),
  2. `validateFormFit(form, chapters, wordsPerChapter)` passes (length within the form's band),
  3. `structure` is a valid id in the `story-structures.ts` catalog.
- **Smoke — `tests/easy-button-smoke.sh`**: boot the gateway; for each bundle `POST /api/books` with its preset and assert the book is created with `format` persisted; teardown deletes the created books. No full AI run (the create+persist path is what this feature adds). Plus `npm run build:frontend` green.

## Out of scope (deferred)

- AI Muse conversational onboarding (strategy addendum #6).
- A data-driven `bundle` library kind — revisit only if bundles must be user-extendable or exposed to Telegram/MCP.
- Roster beyond the 3 MVP bundles.
- Graduation nudges ("customize your voice / edit your pipeline").
- Any change to the existing New Book (Advanced) page beyond it remaining the advanced entry point.

## Success criteria

1. From the studio, a new user reaches a running planning phase in 3 clicks (title+premise → bundle → start).
2. Created books carry the bundle's author/voice/genre and persisted format.
3. The unit test proves every shipped bundle references only public assets and is length-valid.
4. No proprietary asset (pen name, PKstyle, manuscript) is referenced anywhere in the feature.
