# BookClaw — Product Direction

Status: draft for review. Date: 2026-05-31.

This document sets the product and market direction for BookClaw. It is the "why and for whom" companion to the [North Star](TODO.md#north-star--the-ultimate-goal-use-this-to-weigh-every-other-decision) in `TODO.md` (the "what to build") and the [god-class refactor](GOD-CLASS-REFACTOR.md) and [OpenClaw backport audit](OPENCLAW-UPDATES.md) (the "how"). Where any of those conflict with this document on priority, this document wins.

---

## 1. Positioning

> **BookClaw is the open-source writing *studio* for the prolific indie author** — the writer running several pen names and multiple series at once. Where AuthorClaw gives *one* author an excellent production pipeline, BookClaw makes the **book a first-class entity**, so many books — across many author identities and genres — can be in flight simultaneously, each with its own customizable pipeline, and you add more by **configuration, not code**. Self-hosted: your keys, your manuscripts.

That sentence is the reason-to-exist and the answer to "why not just use AuthorClaw?"

## 2. Who it is for

**Primary user: the prolific solo indie author.** One human, several pen names, multiple concurrent series/books at different production stages, self-hosting on their own hardware. Optimizes for throughput and fast switching between identities, genres, and books.

**Explicit non-targets (for now — "not yet", not "never"):**

- **Agencies / small presses / multi-user teams.** Hard isolation between authors, per-author billing, and multi-user access are deferred (see [OpenClaw audit](OPENCLAW-UPDATES.md) #8 isolated workspaces, #9 named auth profiles). The data model should not *preclude* them, but the near-term build is not optimized for them.
- **Non-technical-first users.** Best-in-class onboarding for non-developers (guided tutorial, in-app help) is a real future direction but is not the wedge and not the near-term optimization target.

Naming non-targets is the scope discipline that keeps the first slice small.

## 3. Lineage and the AuthorClaw / OpenClaw relationship

Lineage: **OpenClaw** (original OSS — plugin architecture, TTS, thinking-budget controls, per-channel rate limiter) → **AuthorClaw** (Christopher Kokoski / Writing Secrets — the autonomous pipeline, pen-name personas, skills system, 21-step revision, KDP export) → **BookClaw** (this fork).

- **Differentiation wedge:** books-as-entities plus concurrent multi-identity production with per-novel-type customizable pipelines. AuthorClaw's model is single-author with persona overlays; the studio model is structurally absent there, so this is a genuine *extension*, not parity-chasing.
- **Coexistence stance (decision): diverge on the studio, contribute generic fixes back.** Both projects are MIT/OSS aimed at the same writers. The studio vision is enough of a moat that there is no reason to hoard non-wedge improvements (security hardening, refactors, bug fixes). There is **no upstream git remote** today; syncing is manual. Practice: periodically cherry-pick generic upstream improvements; offer generic BookClaw fixes back upstream where they apply. *(Alternative considered: clean break with no upstream tie — rejected as needlessly uncollegial for little gain.)*

## 4. The five anchoring use cases (the owner's real workflow)

These are the concrete workflows the direction must serve. All five are supportable on the current codebase; the table records where each sits today versus what is net-new.

| # | Use case | Today | Net-new | Effort |
|---|----------|-------|---------|--------|
| 1 | **5 novel types across 3 pen names** (Sweet Romance; Contemporary Romance with spice; Romantasy with spice; Mundane Sci-Fi; Techno-thriller) | `personas.ts` (multi-pen-name) and project-level `preferredProvider` exist; one global `workspace/soul/` identity | First-class `Author-profile` (per-book selectable identity) and `Novel-type` entities; `genre` is free-text today | Medium |
| 2 | **Custom steps/prompts per novel type, with a different model per step** | Steps carry `taskType`, `wordCountTarget`, IDs, status | Largest piece. Pipelines are hardcoded in `services/projects.ts` and must become data-driven per-novel-type definitions; per-step `model` does not exist and must be added to `ProjectStep` and threaded through `ai/router.ts` | Medium-High |
| 3 | **Edit details at any step, go back, rerun** | Solid foundation: `paused` status, `retryStep()`, `/steps/:id/retry`, restart-from-clean, a judge/retry-with-feedback loop | "Edit a step's prompt/output then rerun", and a go-back policy for downstream steps | Medium |
| 4 | **Markdown working copy, final delivered as two Word docs** (KDP-formatted and soft/hardcover-formatted) | `docx-export.ts` already does trim sizes (5x8 / 5.5x8.5 / 6x9) with per-trim margins, front/back matter, section breaks; EPUB exporter exists | Two named export profiles and an "export both" action | Low-Medium |
| 5 | **Device-independent / commute editing** (mass transit, multiple devices) | Server binds `0.0.0.0` with bearer auth + optional IP allowlist; owner already runs WireGuard | Document the WireGuard remote-access recipe; add a "publish final manuscript to a shared folder" capability with an edits-always-win rule | Low-Medium |

Generalizability: only the *specific five genres* are personal — and those ship as **seed templates other authors clone and edit**, which is exactly the "configuration, not code" thesis. Every structural capability (multi-identity, per-genre pipelines, per-step models, interactive rerun, dual export, VPN access plus shared-folder finals) is a broadly shared indie-author need.

## 5. Data model (North Star entities, sharpened by the use cases)

- **Author profile** (pen name) — voice/identity bundle (SOUL / STYLE-GUIDE / VOICE-PROFILE / PERSONALITY). Build on the existing `personas.ts` and `style-clone.ts` rather than a parallel system; cloneable and editable without touching the global `workspace/soul/`.
- **Novel-type** (genre) — **owns the customizable pipeline** plus genre context (tropes, beats, reader-expectation notes). This is the unit the owner customizes per requirement #2.
- **Book** — first-class entity that spans `planning → bible → production → revision → format → launch`. A book = *pick an Author profile + a Novel-type* → it instantiates that Novel-type's pipeline, **version-pinned** so editing a pipeline template never corrupts a book already mid-production. Carries its own history; multiple books are in flight at once.
- **Pipeline** — data-driven, versioned list of steps; each step has a prompt, a `taskType`/tier, an optional **per-step model override**, an optional `wordCountTarget`, and optional attached skills. The current 6 templates + `novel-pipeline` become built-in seed pipelines that can be cloned.
- **Relationship:** Author profile and Novel-type are **independent picks** per book (any pen name can write any type), with optional per-pen-name default types. *(Open — see section 10.)*

## 6. Strategy: vertical thin-slice

Chosen approach: **prove the wedge end-to-end on the smallest real vertical, then generalize** (rejected: foundation-first, too slow to differentiate; big-bang vision-first, too risky on an untested base).

**First slice — build the mechanism once, end-to-end, on one pen name and one novel type:**

- `Book` + `Author-profile` entities (one of each to start).
- One **data-driven pipeline** for that novel type, with **per-step model** selection.
- **Edit / rerun / go-back** on that pipeline's steps.
- **Dual Word export** (the two profiles) plus the **publish-final-to-shared-folder** capability.

Once that vertical works, the owner's other 2 pen names, 4 novel types, and EPUB output are **data entry, not code** — which is the proof that the studio thesis holds.

Deliberately deferred from the slice: full genre trope-pack depth, a polished pipeline-editor GUI beyond what the slice needs, agency isolation, per-author billing, transcripts/voice.

## 7. Roadmap sequencing

- **Just-enough foundation, not foundation-first.** Seed thin unit tests on the two services the slice touches (`ProjectEngine`, `AIRouter`) rather than a full suite or a full Level 2-3 refactor up front. Land the slice on a *minimal* plugin seam so pipelines are plugin-shaped data (aligns with the North Star's Level 3 contract) without committing to the whole refactor now.
- **Rises in priority** (the "many concurrent books" workload stresses exactly these):
  - OpenClaw **embeddings / semantic memory** ([audit](OPENCLAW-UPDATES.md) #5) — keyword memory breaks for continuity across many simultaneous books.
  - **Per-step model selection** (already a `TODO.md` item) — the real cost lever when drafting several books at once; cheap models for bulk drafting, premium only for high-value edits.
- **Holds:** finish the **security review** (`TODO.md`) before any public-facing push — it is the credibility floor for a self-host tool. Note: WireGuard-only access (section 8) materially reduces the urgency of the token-in-HTML and no-TLS items for the owner's own deployment.
- **Defers:** transcripts/voice (audit #1, #2), agency isolation (#8), per-author billing (#9), the long tail of channels, and the data-driven pipeline-editor GUI beyond the slice.

## 8. Portability and deployment pattern (use case 5, generalized)

Two small, well-bounded pieces, each avoiding the sync landmines (vault, SQLite memory DB, and high-churn JSONL logs never leave the server):

1. **VPN remote access (recommended recipe).** BookClaw already binds `0.0.0.0` and gates access with the bearer token and an optional source-IP allowlist. Over a private mesh (the owner's WireGuard; Tailscale is the equivalent — see audit #23), reach the dashboard from any device with no public-internet exposure. Recommended posture: set `BOOKCLAW_ALLOWED_IPS` to the VPN subnet. Ship this as a documented deploy recipe ("reach your studio over your own VPN"), which is most of the device-independence need with essentially no new code.
2. **Publish final to a shared folder, edits-always-win.** When a manuscript is final, BookClaw writes it (markdown plus the two Word docs) to a configured shared directory (for example a Dropbox-synced `~/data/Writing/<book>/`). The owner edits the final on any device, offline. **Edits always win:** BookClaw treats the shared-folder final as authoritative, never silently overwrites it, asks via the confirmation gate before any rerun would regenerate it, and can re-ingest the edited version as the new source of truth. Only finals sync; the working set stays server-side.

## 9. Success signals

This is open-source for adoption and identity, not revenue. Signals to watch:

- A working multi-book demo or screencast showing several books in flight under different pen names and genres.
- The README "studio" framing landing with a handful of real indie-author users.
- The first outside contributor.
- The differentiation being legible enough that prospective users stop asking "why not just use AuthorClaw?"

## 10. Open build-decisions (resolve when speccing the first slice)

- **Pen-name to novel-type relationship** — default: independent picks with optional per-pen-name default types.
- **The two Word targets** — decided: Doc 1 = a clean reflowable manuscript formatted for KDP ebook conversion; Doc 2 = a print-formatted Word doc (trim size, margins, mirrored gutters) for soft/hardcover. The print doc's trim size(s) are picked per book and can be refined later.
- **Go-back policy** — default: rerunning an earlier step flags downstream steps stale (rerun on demand), never auto-deletes output.
- **Final-manuscript conflict rule** — decided: edits always win.
- **EPUB** — default: keep as an optional third export alongside the two Word docs.

## 11. What this is not (scope guard)

Not an agency/multi-tenant platform, not a SaaS, not a non-technical-first onboarding product — yet. Not a from-scratch rewrite: every piece extends existing services (`personas`, `projects`, `docx-export`, `confirmation-gate`, `style-clone`) rather than replacing them.
