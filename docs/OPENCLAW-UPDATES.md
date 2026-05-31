# OpenClaw → BookClaw Feature-Backport Candidates

Snapshot taken 2026-05-28. Sources reviewed:
- OpenClaw `main` README inventory
- OpenClaw release notes for **2026.5.26-beta.1** (May 26), **2026.5.26** (May 27), **2026.5.27** (May 28)
- Local BookClaw tree (`/home/paul/data/dev/bookclaw`) — last upstream sync was commit `80df746` *"Reasoning + browser pieces from OpenClaw 2026.4.24/25"*, so anything below has shipped upstream **after** BookClaw's last pull.

Ranking criterion: marginal value for a *novelist's* workflow (drafting, series bibles, KDP self-publishing, pen-name management) — not raw feature parity. A feature OpenClaw added for sysadmins ranks lower here than one that helps a writer dictate a scene on a walk.

---

## 🟥 TIER 1 — Game-changers for a writing agent

### 1. Realtime voice + Voice Wake + Talk Mode
**Upstream:** Voice Wake (macOS/iOS), continuous Talk Mode (Android), Discord realtime voice with speaker attribution, ElevenLabs + system TTS, wake-name tolerance, barge-in detection, realtime turn-context tracking, iOS direct realtime voice sessions, Android offline voice + gateway recovery, Realtime Talk inspection from Web UI.
**Author payoff:** Dictate prose hands-free on a walk. Voice brainstorming during a stuck scene. Read a chapter aloud and have the agent suggest line edits in conversation. BookClaw currently has *output-only* TTS (9 Edge presets) and no voice **input** path at all.
**Effort:** High. Realtime voice is a new bridge + a new sandbox class. Start with Telegram voice-message ingestion (Whisper transcription) as a wedge before tackling true wake-word.
**Why it's #1:** Voice is the closest thing to a 10× lever for the actual writing act. Every other item on this list helps *around* the writing.

### 2. Transcripts as a core subsystem
**Upstream (2026.5.26):** Transcript-backed meeting summaries, source-provider chunk support, user-turn persistence with cleaned text, CLI surface for transcript management.
**Author payoff:** Interview transcripts → nonfiction source material. Dictated voice memos → first-draft scene. Recorded plotting sessions → outline structure. Pairs perfectly with #1.
**Effort:** Medium. Decoupled from the voice bridge — transcripts can land first with file-upload ingestion (mp3/m4a → cleaned text → injected into a project), and the voice bridge plugs in later.
**Why this rank:** Nonfiction authors and ghostwriters live in transcripts. Without a real transcripts pipeline, BookClaw can't serve memoir / business-book / podcast-to-book customers.

### 3. Live Canvas / A2UI (agent-driven visual workspace)
**Upstream:** Agent renders rich interactive visuals (the "Canvas" surface) reachable from iOS/Android/Web.
**Author payoff:** Visualize the series bible — character relationship graphs, beat-sheet boards, plot-promise heatmaps, timeline strips, world maps. BookClaw's planning artifacts (`story-structures`, `plot-promises`, `series-bible`) are currently *.md only — no visual layer.
**Effort:** High, but bounded. Could ship an MVP that just renders a few hardcoded canvas types (beat board, character graph) before generalizing.
**Why this rank:** Authors plotting a series live in whiteboards in real life. Replacing the whiteboard is a defensible differentiator.

### 4. Browser tool (real headless browser)
**Upstream:** Full browser automation tool with SSRF policy enforcement on snapshots.
**Author payoff:** Real comp-title research on Amazon/Goodreads/BookBub. KDP dashboard scraping for sales/royalty data. Reading reviews of competing books for blurb angles. BookClaw's current `ResearchGate` is HTTP-fetch + HTML extraction with a domain allowlist — fine for Wikipedia, useless for JS-rendered sites.
**Effort:** Medium. The OpenClaw commit referenced in `80df746` already brought *"browser pieces"* — find out how much of the runtime landed vs. just the scaffolding, then wire it into the existing research skills.
**Why this rank:** Half the marketing skills (`ams-ads`, `bookbub-submitter`, `reader-intel`, `release-calendar`) are bottlenecked on data the current research stack cannot reach.

### 5. OpenAI-compatible embeddings provider (semantic memory / RAG)
**Upstream (2026.5.27):** Core embedding provider with OpenAI-compatible interface. Plugs into existing memory.
**Author payoff:** Today BookClaw memory is SQLite FTS5 — keyword search. Embeddings turn the series bible + all prior chapters + character voice samples into a *semantic* index. "Find every scene where Riley feels watched" stops requiring the exact word "watched." Critical at the 50k-word mark of a draft when the model can't hold the whole manuscript in context.
**Effort:** Medium. Schema migration on the memory store, embedding-write on every save, ANN search wired into the existing `memory-search` service. Could ship behind a feature flag.
**Why this rank:** Continuity is the #1 thing readers complain about in long-form AI-assisted novels. Embeddings make continuity tractable.

---

## 🟧 TIER 2 — High value architectural lifts

### 6. iOS / Android companion node apps
**Upstream:** Native iOS node (WebSocket pairing, voice trigger forwarding, canvas surface) and Android node (Connect/Chat/Voice tabs, camera, screen capture, canvas surface).
**Author payoff:** Capture story ideas in the field. Photo a bookstore display → research the genre's current cover trends. Voice-note a scene fragment while driving. Inhale a competitor's blurb via screen capture. Today, BookClaw is reachable only via Telegram, Discord, or the LAN dashboard.
**Effort:** Very high — native apps are a separate skill tree. Could be split: phase 1 is a PWA wrapping the dashboard with voice-note upload, phase 2 is a real iOS/Android node.

### 7. WhatsApp + iMessage channels (with reaction-based approvals)
**Upstream:** WhatsApp + iMessage + Signal + Slack channels, all with thumbs-up/reaction-based approval flows.
**Author payoff:** Most non-technical author clients live in WhatsApp/iMessage, not Telegram. Reaction approvals (👍 on a draft = "approved, continue") fit the confirmation-gate pattern BookClaw already enforces, and they replace typing `yes` with a tap. Drops the friction of the confirmation gate by an order of magnitude on phone.
**Effort:** Medium per channel. WhatsApp first (largest audience). The reaction-approval handler is the same shape as the existing Telegram approval flow.

### 8. Multi-agent routing with isolated workspaces
**Upstream:** Route inbound channels/accounts to isolated agents, each with its own workspace + sessions.
**Author payoff:** Each pen name gets its own workspace, not just a persona overlay. Today `Lily Hart` and `KS Rhysdale` share `workspace/`, share memory, share file IO. That works for one author with 2 personas. It breaks for an agency, or for an author whose erotica pen name must never be cross-contaminated with the children's-book pen name in any AI context, memory, or research history. Fixes a real privacy + brand risk.
**Effort:** High. Workspace path is wired through dozens of services. Worth scoping against the `gateway/src/index.ts` refactor already noted in TODO.

### 9. Named authentication profiles + credential rotation
**Upstream (2026.5.26):** Named model login profiles with credential migration for Hermes/OpenCode/Codex, optional opt-out controls. (2026.5.27 added device-token invalidation during rotation.)
**Author payoff:** Different pen names with different billing accounts (a Lily Hart Anthropic key vs. a TD Wood Anthropic key, so costs are attributable per persona). Today BookClaw's vault stores one key per provider, full stop.
**Effort:** Medium. Vault schema gets a `profile` dimension; the AI router picks profile based on the active persona.

### 10. Sessions tools — `sessions_spawn` / `sessions_send` / `sessions_list` / `sessions_history`
**Upstream:** First-class agent-to-agent messaging primitives.
**Author payoff:** A pipeline can spawn parallel research sessions (one per chapter that needs fact-checking) and join the results. The current `ProjectEngine` runs steps strictly serially.
**Effort:** Medium-high. Touches the project engine, the sandbox model, and the activity-log streaming.

### 11. Pixverse video generation provider
**Upstream (2026.5.27):** Video generation provider in the AI router.
**Author payoff:** Book trailers. Reels/Shorts/TikTok marketing assets. A scene's "moodboard" rendered as a 5-second clip for the author's own visualization. BookClaw already has Gemini Nano Banana for stills; video closes the loop.
**Effort:** Low if BookClaw's router has a clean provider-plugin interface. Medium if it doesn't.

### 12. ClawHub-style skill registry (Bundled / Managed / Workspace tiers + SKILL.md)
**Upstream:** Three-tier skill model — bundled (in the binary), managed (installed from registry), workspace (user-authored). Online registry called ClawHub. Standardized `SKILL.md` manifest.
**Author payoff:** Today BookClaw skills live in `skills/{author,core,marketing,ops,premium}/` and ship in-tree. A managed-skill story would let third-party authors publish a "Regency Romance Bible" skill or a "Brandon-Sanderson-style magic-system" skill that anyone can install. Already half-aligned with the `auto-skill` service.
**Effort:** Medium. The hard part is policy (security review, signing, abuse handling), not code.

---

## 🟨 TIER 3 — Worth merging in the next security/observability pass

### 13. Security hardening bundle (2026.5.26-beta.1 + 2026.5.27)
Specifically:
- **Browser snapshot SSRF policy** — directly relevant once #4 lands.
- **System-event text sanitization** (prompt-marker spoofing) — applies to any inbound channel content. Real exploit class.
- **Tool-call text scrubbing from replies** — prevents leakage of internal tool plumbing to the user/channel.
- **Group prompt isolation from system prompts** — relevant for any multi-tenant deployment.
- **Hostname dot normalization** — defends DNS/URL allowlists against the `evil.com.` (trailing dot) bypass class.
- **Side-effecting command wrapper blocking** in sandbox — closes a sandbox-escape primitive.
- **Unsafe Node runtime environment override rejection** — same family.
- **No-auth Tailscale exposure rejection** — relevant if BookClaw ever follows OpenClaw's Tailscale path.
- **Admin requirement for node/device-role approvals** — needed once #6 lands.

**Why this rank:** The standing BookClaw TODO already lists "Full security review (post-LAN-exposure)" as the next big rock. Most of these defenses map 1:1 to items on that list. Cheap to port the ones that apply, expensive to design from scratch later.

### 14. OpenTelemetry LLM content spans + Activity tab
**Upstream (2026.5.26):** OTel spans capturing model stream progress, skill/tool usage classification, gateway secret-preparation tracing, plus an ephemeral Activity tab in the UI for live tool summaries.
**Author payoff:** When a 48-step novel pipeline stalls at step 31, the user has zero introspection today beyond `/status`. OTel + Activity tab gives a debuggable timeline.
**Effort:** Medium. Drop an OTel SDK in, wrap `AIRouter` calls, mirror the Activity tab into the dashboard.

### 15. Startup / hot-path caching layer
**Upstream (2026.5.26 + 5.27):** Plugin metadata snapshot caching, gateway metadata caching, model-cost index caching, channel resolution caching, plugin metadata fingerprint caching, auth-environment snapshot caching, auto-enabled plugin config caching, tool-search catalog optimization, session-read optimization, reduced filesystem rediscovery on hot paths.
**Author payoff:** BookClaw's `gateway/src/index.ts` is 2,650 lines that runs a numbered initialization phase sequence. Cold-start is slow. These caches address the same pattern.
**Effort:** Medium. Best done alongside the index.ts decomposition already noted in TODO.

### 16. Sandbox backend pluralism (Docker / SSH / OpenShell)
**Upstream:** Pluggable sandbox backends.
**Author payoff:** BookClaw runs in Docker today. Adding an SSH backend would let a single Mercury install drive jobs on Neptune (the n8n + rclone host) for big batch work without copying state. Aligns with the existing Mercury↔Neptune NFS architecture.
**Effort:** Medium. Sandbox interface looks clean; swap-in cost is bounded.

### 17. Default `cron.maxConcurrentRuns = 8` + Windows Scheduled Tasks
**Upstream (2026.5.26):** Cron concurrency default raised to 8; Windows Scheduled Tasks added as a backend.
**Author payoff:** The `heartbeat` and `release-calendar` services schedule recurring jobs through BookClaw's `cron-scheduler`. Concurrency 1 (or whatever the current default is) bottlenecks the heartbeat. Windows backend matters if any author runs the agent on a Windows box.
**Effort:** Low for the concurrency tweak. Medium for Windows.

### 18. Rastermill image backend (replace Sharp)
**Upstream (2026.5.26):** Image processing backend rewritten to remove the Sharp dependency. Preserves EXIF orientation, PNG alpha optimization.
**Author payoff:** Sharp's native binary is the single most painful dependency for cross-platform installs (the BookClaw README's "fail-soft init" pattern exists partly because of this class of problem). Removing it simplifies the Docker image and unblocks Windows-native installs.
**Effort:** Low-medium if Rastermill is drop-in. The risk is image-processing parity (cover-typography, cover-designer skills).

### 19. DeepInfra full-catalog browsing + bare Anthropic model IDs + Claude CLI OAuth overlay + VLLM thinking parameter
**Upstream (2026.5.27):** Provider/model expansions.
**Author payoff:** DeepInfra catalog gives access to many open-weights models without per-model wiring. Claude CLI OAuth overlay simplifies onboarding for authors who already have a Claude.ai login. VLLM thinking matters only for self-hosters.
**Effort:** Low per item. Group with the next AI-router pass.

---

## 🟩 TIER 4 — Nice to have, lower author-leverage

### 20. macOS menu bar app (push-to-talk overlay, signed builds, SSH remote control of gateway)
Useful if the agent author is on macOS, but adds packaging/signing infrastructure cost (Apple Developer account, notarization) that hits BookClaw the moment it ships an installable. Park until #6 is committed to.

### 21. Telegram forum topic support / iMessage attachment root handling / Discord guild requester check hardening / Slack final-reply persistence / Matrix mention preview strictness / Google Chat DM thread-send prevention
Per-channel polish. Relevant only as each channel actually ships.

### 22. The long tail of niche channels — Matrix, Feishu, LINE, Mattermost, Nextcloud Talk, Nostr, Synology Chat, Tlon, Twitch, Zalo, Zalo Personal, WeChat, QQ, IRC, Microsoft Teams
Not author-relevant. Skip unless a specific customer needs one.

### 23. Tailscale integration / remote gateway access
Mostly relevant if BookClaw ever splits compute across hosts (Mercury + Neptune). #16 (SSH sandbox) probably gets to the same outcome with less infrastructure.

### 24. Discord alpha-bucket model picker (25+ items)
A UX nicety for changing the active model from chat. Already partially achievable today via the dashboard.

### 25. Beta smoke test empty-run rejection / E2E log/probe wait bounding / Release postpublish check hardening / npm globstar exclusion / Docker runtime template packaging / Alpine install hardening
Internal release-engineering improvements. Pick up if/when BookClaw stands up its own release pipeline. Useful as a reference *list* even if not ported directly.

---

## Suggested ordering for an actual sprint

If the goal is the largest user-visible step-up with bounded scope:

1. **Land #5 (embeddings) first** — invisible plumbing but unblocks every long-form drafting use case.
2. **Then #2 (transcripts)** — clean file-upload path, no voice-bridge dependency. Opens nonfiction/ghostwriter market.
3. **Then #11 (Pixverse video)** — quick win, drops a new marketing deliverable into the existing launch skill.
4. **Then #4 (real browser)** — unlocks half the marketing skills' real potential.
5. **Then #13 (security bundle)** — should ship before any channel expansion in #7 or any companion-node work in #6, because both expand attack surface.
6. **Then #7 (WhatsApp + iMessage + reaction approvals)** — the channel expansion authors will actually feel.
7. **#1, #3, #6, #8** are bigger projects each — pick one as the next "north star" feature after the above stabilizes.

Park everything in Tier 4 until a specific customer asks.
