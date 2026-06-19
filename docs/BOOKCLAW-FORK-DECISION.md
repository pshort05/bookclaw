# BookClaw: Evolve BookClaw vs. Re-Fork OpenClaw — Effort Comparison

> **Status (2026-06-18):** Decision implemented — Option A was taken. The rename (AuthorClaw → BookClaw) is complete and the book-container model is fully shipped (Phases 0–12; Phase 12 was the final planned phase). Frozen decision record; see docs/COMPLETED.md for current state.

Decision memo for review. Prepared 2026-05-30.

**Question:** Rather than continuing to fix BookClaw and rebranding it to "BookClaw,"
would it be easier to start fresh from a fork of OpenClaw to build BookClaw? Target
features: multi-book support and the StoryHackerAI feature.

**Method note:** This memo is grounded in the local codebase and the existing design docs
(`OPENCLAW-UPDATES.md`, `GOD-CLASS-REFACTOR.md`, `STORYHACKERAI-PORTING.md`, `RENAME-PLAN.md`,
`TODO.md`), plus targeted verification of OpenClaw's current public state. A full multi-source
web research fan-out was deliberately not run: roughly 80% of the question is local, and the
external piece (OpenClaw's nature and architecture) is already documented in-tree and confirmed
below.

---

## The single fact that decides this

**BookClaw is already a fork of OpenClaw.** `package.json`, the startup banner, and
`docs/OPENCLAW-UPDATES.md` confirm the last upstream sync was OpenClaw commit `80df746`. So the
two options are not symmetric:

| Option | What it actually is |
|---|---|
| **A — "fix BookClaw -> BookClaw"** | Keep the OpenClaw base already in the tree + the ~21,000 LOC of writing features built on top, add the two new features, rename. |
| **B — "fresh fork of OpenClaw -> BookClaw"** | Re-fork *current* OpenClaw, then rebuild or re-port the entire writing layer from scratch before starting on the two new features. |

OpenClaw (confirmed via GitHub: ~247k stars, pnpm monorepo, ~150 plugins) is a
**general-purpose multi-channel AI assistant gateway**. It has **zero** book/author/novel
capability. Every writing feature is original to BookClaw, not inherited:

- **53 service files / ~21,000 LOC** of writing-specific logic: `projects.ts` (the novel
  pipeline), `plot-promises`, `story-structures`, `character-voices`, `beta-reader`,
  `craft-critic`, `dialogue-auditor`, continuity checking, `series-bible`, `kdp-exporter`,
  `epub-export` / `docx-export`, `launch-orchestrator`, `website-builder`, and more.
- **~29 author/marketing/ops skills** (15 author skills alone).
- The **security perimeter completed this week** (auth, CORS, source-IP allowlist, CSP).

Option B discards all of that to regain a cleaner architecture and roughly two days of newer
upstream commits. That is the core of the trade.

---

## What each target feature actually requires

### 1. Multi-book support

Already scoped in `docs/TODO.md` as a "Larger item." It is a data-model addition on top of
existing infrastructure:

- A `book` entity owning phase/state across planning -> bible -> production -> revision ->
  format -> launch.
- Named author-style profiles (reusing `services/personas.ts` + `services/style-clone.ts`).
- Genre-style packs replacing the free-text `genre` field.
- A migration treating today's `workspace/soul/` as the default book.

This depends on the existing ProjectEngine, personas, and style-clone services. On a fresh
OpenClaw fork none of those exist yet, so Option B makes this feature *more* expensive, not less.

### 2. StoryHackerAI feature

`docs/STORYHACKERAI-PORTING.md` already audited this. The headline item is making OpenRouter the
canonical AI gateway (a router/config change), plus the Selector -> Brief -> Draft -> Check
multi-pass chapter pipeline and explicit Chronology/Style/Wordcount checks. Several of those
checks already exist as services (`continuity` checking, `craft-critic`, `dialogue-auditor`).
These are enhancements to the existing `AIRouter` and `ProjectEngine`. Same dependency problem
for Option B: the pipeline must be rebuilt before the pattern can be ported into it.

**Both target features are patterns ported INTO infrastructure already owned.** That
infrastructure is exactly what a fresh fork discards.

---

## Honest effort estimates

Ranges assume a solo, focused-session pace. "Working system" = BookClaw today: v5.0.0, smoke
tests pass, `tsc` clean, security review nearly complete.

### Option A — evolve + rebrand

| Work | Effort |
|---|---|
| Rename BookClaw -> BookClaw (runbook ready in `RENAME-PLAN.md`) | 1-2 hours (mechanical) |
| Multi-book entity + author/genre profiles + migration | 1-2 weeks |
| StoryHackerAI port (OpenRouter-canonical + multi-pass + checks) | 1-2 weeks |
| *Optional* Level-1 god-class refactor as a pre-step (`GOD-CLASS-REFACTOR.md`) | 1-2 days |
| **Total to a shipped BookClaw with both features** | **~3-5 weeks**, on a working system |

### Option B — re-fork OpenClaw, rebuild

| Work | Effort |
|---|---|
| Re-port / re-wire ~21k LOC of writing services + 29 skills into OpenClaw's *plugin* architecture (not copy-paste; different wiring model) | 6-12+ weeks |
| Re-do the security perimeter just finished (some covered by OpenClaw's newer security bundle) | days - 1 week |
| **Then** multi-book + StoryHackerAI (same as Option A, but only reachable now) | +3-5 weeks |
| **Total before BookClaw matches today's baseline, plus features** | **~2-4 months** |

**Option B costs roughly 4-8x more,** and its first ~2-3 months produce zero new user-visible
capability — it only returns to today's baseline on a different foundation.

---

## The one legitimate argument for Option B (and why it still loses here)

`GOD-CLASS-REFACTOR.md` is candid: OpenClaw's plugin architecture is decisively better.
`index.ts` (2,649 lines, 61 services, 35 init phases, two duplicate `Phase 6h` blocks) and
`routes.ts` (5,516 lines, 234 endpoints in one function) are real god-class debt. Adding a
provider/channel in OpenClaw is creating a folder; in BookClaw it is editing the monolith.

If the goal were to absorb dozens of OpenClaw upstream features — voice/Talk Mode, Live Canvas,
20+ channels, native iOS/Android apps, embeddings (see `OPENCLAW-UPDATES.md` Tiers 1-2) — then
starting from the plugin architecture would eventually pay off.

Two things defuse that:

1. The same `GOD-CLASS-REFACTOR.md` already lays out how to migrate to that architecture
   incrementally — Level 1 (phase extraction, 1-2 days), Level 2 (service registry, ~1 week),
   Level 3 (plugin contracts for only the 4 subsystems that keep accreting: providers, channels,
   image/video, TTS). The good pattern is reachable without a rewrite, keeping the 21k LOC.
2. The stated goal is narrow: multi-book + StoryHackerAI for a single author. That goal touches
   the writing layer (which Option B discards) and barely touches the channel/provider plane
   (where the plugin architecture shines).

---

## Recommendation

**Take Option A.** Concretely:

1. **Do not frame it as "fixing."** BookClaw is not broken — it is a working, actively
   developed system with (a) well-scoped architectural debt and (b) two missing features. Both
   are already documented with plans.
2. **Rename now if the BookClaw identity is wanted** — `RENAME-PLAN.md` is a ready, reversible
   runbook (~1-2 hrs). Its four decisions still need sign-off.
3. **Do Level-1 phase extraction as a pre-step** to the multi-book work (1-2 days, very low
   risk) — it directly eases the multi-book change, which touches `index.ts`.
4. **Build multi-book, then port StoryHackerAI patterns** into the existing pipeline.
5. **Adopt OpenClaw's plugin pattern selectively** (Level 3) only when/if committing to absorbing
   many upstream channels/providers — not before, and never as a big-bang rewrite.

**Reconsider Option B only if the real intent changes** to: a multi-tenant/agency SaaS, a
voice-first or mobile-app-first product, or riding OpenClaw upstream releases closely. None of
those match "multi-book + StoryHackerAI for one author."

---

## Open questions before this is fully settled

1. **Is the goal genuinely single-author multi-book,** or aimed at an agency / multi-tenant
   product? That single answer is the one that could flip the recommendation toward B.
2. **Multi-book and the rename are not yet marked in-flight in `docs/TODO.md`.** Per the
   feature-tracking workflow in `CLAUDE.md`, neither should start until tracked as active.

---

## Related documents

- [TODO.md](TODO.md) — multi-book is listed under "Larger items"; rename under "Pending plans."
- [RENAME-PLAN.md](RENAME-PLAN.md) — ready, reversible BookClaw -> BookClaw runbook.
- [GOD-CLASS-REFACTOR.md](GOD-CLASS-REFACTOR.md) — OpenClaw architecture comparison + 3-level
  incremental refactor plan.
- [OPENCLAW-UPDATES.md](OPENCLAW-UPDATES.md) — upstream features and which justify the plugin
  architecture.
- [STORYHACKERAI-PORTING.md](STORYHACKERAI-PORTING.md) — StoryHackerAI feature-port audit.

## Sources (external)

- [openclaw/openclaw (GitHub)](https://github.com/openclaw/openclaw)
- [OpenClaw docs](https://docs.openclaw.ai/)
- [What Is OpenClaw? (Milvus)](https://milvus.io/blog/openclaw-formerly-clawdbot-moltbot-explained-a-complete-guide-to-the-autonomous-ai-agent.md)
