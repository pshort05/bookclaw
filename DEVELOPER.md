# BookClaw — Developer Guide

The developer's entry point to BookClaw. For installation and end-user usage, start with the [README](README.md); for the authoritative agent/coding instructions, read [CLAUDE.md](CLAUDE.md). This file summarizes **where the project is going**, **what it's made of**, **the standards all code must meet**, and **where every developer document lives**.

BookClaw is a Node.js/TypeScript writing-agent gateway: one process runs Express + Socket.IO on port `3847`, serves the React studio, exposes a REST + WebSocket API, and bridges to Telegram/Discord. It autonomously executes multi-step writing **projects** by chaining tiered AI calls and injecting **skill** content into each step.

---

## Development direction

- **Multi-author, multi-book studio.** A book is a self-contained, portable container (`workspace/books/<slug>/`: manifest + snapshotted templates + data). The book-container model is complete (Phases 0–12); everything new is designed to compose with it. See [docs/developer/BOOK-CONTAINER-ARCHITECTURE.md](docs/developer/BOOK-CONTAINER-ARCHITECTURE.md).
- **Author identity as a first-class lever.** A pen name isn't just a prompt — it's an Author + Voice profile plus per-author **models** (`sceneBriefModel`/`draftModel`) and a per-book **Creative/Surgical temperature**, so different authors genuinely *sound* different and stay consistent across their books.
- **Drift-proof, deterministic craft.** Editing passes are **audit → code-apply** (the LLM emits a JSON edit list; deterministic code patches the draft — it never regenerates), guarded against malformed splices. Consistency/continuity engines, a canon-drift gate, and a character-name registry keep long books coherent.
- **Human-in-the-loop where it matters.** Review gates (per-chapter/per-act), one-step edit-and-approve, and **Alternate Takes** (the model proposes several distinct "takes" at a creative fork and a human picks) put the author in control of craft decisions.
- **Config-not-code.** Pipelines are editable, data-driven sequences of definitions pulled from a book's snapshot — not a hardcoded phase enum.
- **Threat model: single-user, home-LAN.** BookClaw is built to run locally or over a trusted LAN via Docker; it is **not** hardened for the public internet. Weigh design and review decisions against that model — for anything internet-facing, front it with a TLS-terminating, authenticating reverse proxy. See [docs/SECURITY.md](docs/SECURITY.md).

The forward roadmap, product vision (North Star), and strategy are maintainer working notes in [`docs/internal/`](docs/internal/) — not part of the developer contract.

---

## Architecture at a glance

Full detail: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). In brief:

- **Entry point** — `gateway/src/index.ts`, a single `BookClawGateway` class wired in a numbered init sequence (`gateway/src/init/phase-*`). REST routes are composed in `gateway/src/api/routes.ts` from per-feature modules under `gateway/src/api/routes/` sharing `_shared.ts`.
- **Three concentric layers** — (1) **Security perimeter** (`gateway/src/security/`: Vault, SandboxGuard, InjectionDetector, AuditLog, PermissionManager, ConfirmationGate); (2) **AI routing** (`gateway/src/ai/router.ts`: six providers, `TASK_TIERS`/`TIER_ROUTING`/`TASK_REASONING`/`TASK_OUTPUT_BUDGET`, plus per-step resolution in `castStep`/`stepRouting`); (3) **Skills + Projects** (`services/projects.ts`, the autonomous loop).
- **Per-step model + temperature precedence** — spice re-route → explicit per-step pin → per-stage pin → author/book per-role model → book all-stages default → genre casting sheet → tier default; per-book Creative/Surgical temperature overrides the sheet temperature below any explicit pin.
- **Frontend** — the v6 React studio (`frontend/studio/`, an npm workspace) + the Chat app (`frontend/chat/`), Vite-built; dists are gitignored (Docker builds them).
- **MCP server** — `mcp/` is the vendored, stateless façade over a curated subset of the REST API; it changes in lockstep with the routes it wraps.

---

## Feature set (subsystems)

End-user documentation for each lives in [`docs/features/`](docs/features/). The technical subsystems:

- **Books & pen names** — book containers, Author/Voice profiles, per-author models, concurrent multi-book runs.
- **Pipelines & sequences** — config-not-code production pipelines, per-step model/temperature overrides, Alternate Takes.
- **AI routing** — tiered provider selection, casting sheets, reasoning-effort translation, cost budgets.
- **Genres** — 190+ genre guides snapshotted per book and injected into generation.
- **Continuity & consistency** — fact ledger, Character Knowledge Matrix, selective exclusion, plot promises, canon-drift gate, character-name registry.
- **Craft & editorial** — craft critic, dialogue auditor, pacing heatmap, beta readers, editorial council, the two-pass de-AI humanizer, the narrative anti-fingerprint skill, Prompt Runner.
- **World Repository** — structured worldbuilding codex with per-book relevance-pull and appendixes.
- **Series** — multi-book continuity, shared refs, divergence detection.
- **Publishing & launch** — DOCX/EPUB export, covers, blurbs, launch orchestrator, website builder.
- **Backups** — default-on snapshots outside the workspace, per-book restore, opt-in cloud push.
- **Surfaces** — Studio, Chat app, Telegram/Discord bridges, REST/WebSocket API, MCP server.

---

## Engineering standards

These are **mandatory** (see [CLAUDE.md](CLAUDE.md) for the full text; the four Karpathy directives there override conflicting habits):

- **Think before coding · Simplicity first · Surgical changes · Goal-driven (TDD).** State assumptions, write the minimum that solves the problem, touch only what the task requires, and define verifiable success criteria (write the failing test first).
- **Reference frameworks** — construction: *Code Complete, 2nd ed.*; security: *Writing Secure Code*; infra: *Infrastructure as Code*. Trust-boundary validation, data-loss handling, security, and accessibility are never cut for simplicity.
- **Language standards** — Python → The Hitchhiker's Guide (isolated `.venv/`, never global); TypeScript → the TS Handbook; Java → *Effective Java, 3rd ed.*
- **Repo conventions** — **Node 22+**; TS runs via `--import tsx` (no `ts-node`); **imports use `.js` extensions** even from `.ts` (NodeNext); init is **fail-soft** (log `✓`/`⚠`/`ℹ`, degrade rather than crash on optional-dependency failure); premium skills are gitignored; workspace runtime data is gitignored but the dirs must exist.
- **Security posture** — respect the perimeter env vars (`BOOKCLAW_AUTH_TOKEN`, `BOOKCLAW_CORS_ORIGINS`, `BOOKCLAW_ALLOWED_IPS`, `BOOKCLAW_TRUST_PROXY`); route every irreversible external side effect through the ConfirmationGate.
- **Testing** — `npm run test:unit` (node:test; builds the frontend), `npm run test:api`, `npm run test:smoke` (boots the gateway and asserts the security perimeter). Any check worth running is committed as a runnable script under `tests/`; keep a debug/verbose path so a failing run is diagnosable.
- **Feature tracking** — every in-flight feature is listed in [`docs/internal/TODO.md`](docs/internal/TODO.md); on completion it moves to [`docs/internal/COMPLETED.md`](docs/internal/COMPLETED.md) with a date.
- **Git workflow** — work happens directly on `main` (sole contributor). Claude writes the message to a `commit_message` file; the maintainer runs `./push.sh` (add + commit + push, then removes the file). Claude does not `git commit`/`push` unless explicitly asked.
- **Feature process (superpowers)** — brainstorm → **spec** (`docs/superpowers/specs/`) → **writing-plans** (`docs/superpowers/plans/`) → TDD implementation → code review (fix medium+ findings) → deploy. Every shipped feature leaves a spec + plan record.

---

## Deployment

Local/Docker/VPS operations: [docs/LAUNCH-GUIDE.md](docs/LAUNCH-GUIDE.md). Common commands are in the [README](README.md#deployment). The maintainer's host-specific runbook (Mercury dev / Neptune prod) is gitignored at `docs/internal/DEPLOYMENT.local.md`.

---

## Developer documentation index

**Technical references** ([`docs/developer/`](docs/developer/)):
- [BOOK-CONTAINER-ARCHITECTURE.md](docs/developer/BOOK-CONTAINER-ARCHITECTURE.md) — book-as-container data model, `book.json` manifest fields, phased roadmap.
- [CANON-DRIVEN-PIPELINE.md](docs/developer/CANON-DRIVEN-PIPELINE.md) — canon-driven pipeline design (source PDF alongside).
- [GOD-CLASS-REFACTOR.md](docs/developer/GOD-CLASS-REFACTOR.md) — decomposition of the former `index.ts` / `routes.ts` god classes.
- [AUTHOR-PROFILES-REFERENCE.md](docs/developer/AUTHOR-PROFILES-REFERENCE.md) — reusable author/voice profile catalog.
- [GENRE-GUIDE-TEMPLATE.md](docs/developer/GENRE-GUIDE-TEMPLATE.md) — genre-guide schema/template.
- [PREMISE-TEMPLATE.md](docs/developer/PREMISE-TEMPLATE.md) — parse-friendly premise-document template.

**Per-feature design records** — brainstorming → writing-plans output for every feature: [`docs/superpowers/specs/`](docs/superpowers/specs/) (58) and [`docs/superpowers/plans/`](docs/superpowers/plans/) (80). This is the richest corpus for understanding *why* a subsystem is shaped the way it is (and for training Claude on the codebase).

**Public docs a developer needs:**
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — system architecture (entry point, init, the three layers, on-disk layout).
- [docs/SECURITY.md](docs/SECURITY.md) — vault, sandbox, audit log, network posture, threat model.
- [docs/GLOSSARY.md](docs/GLOSSARY.md) — canonical vocabulary (Book, Pipeline, Step, Author, Voice, Genre, …).
- [docs/MODEL-GUIDE.md](docs/MODEL-GUIDE.md) — provider/model trade-offs and per-task recommendations.
- [docs/HOW-TO-CREATE-AUTHOR-PROFILES.md](docs/HOW-TO-CREATE-AUTHOR-PROFILES.md) · [docs/HOW-TO-CREATE-GENRE-GUIDES.md](docs/HOW-TO-CREATE-GENRE-GUIDES.md) — authoring content.
- [mcp/README.md](mcp/README.md) — the vendored MCP server.

**Maintainer/internal notes** ([`docs/internal/`](docs/internal/)) — roadmap, product vision, strategy, reviews, and audits. Working notes, not part of the developer contract.
