# TODO

Tracking list of items surfaced while writing CLAUDE.md. Grouped by effort.

## Pending plans (separate files)

- [ ] **[RENAME-PLAN.md](RENAME-PLAN.md)** — rename project from AuthorClaw → BookClaw. Decisions captured, runbook ready, not yet executed.

## Full security review (post-LAN-exposure)

Opening the bind from loopback to LAN turned several previously-defense-in-depth
assumptions into single points of failure. A proper security review should
cover at minimum:

- [ ] **Add HTTP/WebSocket authentication.** Current state: any host on the LAN can drive the agent, read the workspace, and trigger confirmation-gate items. Pick a model — bearer token in env var (simplest), shared-secret HMAC on every request, or mTLS — and enforce it on every Express route and on the Socket.IO `connection` handshake (`socket.handshake.auth.token`).
- [ ] **Tighten CORS once auth lands.** Replace `cors: { origin: '*' }` (both Express and Socket.IO) with an explicit allowlist driven by `AUTHORCLAW_CORS_ORIGINS` env var (comma-separated). Same for the WebSocket origin check that was removed in the LAN patch.
- [ ] **Restore + tighten Helmet CSP.** Replace `connectSrc: ["'self'", "*"]` with an allowlist that matches the configured origins. Reconsider `upgradeInsecureRequests: null` — keep it off only while the deployment is HTTP-on-LAN; flip it back on once the reverse-proxy path becomes the recommended deployment.
- [ ] **API-level rate limiting.** Per-channel rate limiting exists for bridges (`bridges/telegram.ts`, `bridges/discord.ts`) but not for HTTP routes. Add per-IP throttling on `/api/*` and on the WebSocket message handler.
- [ ] **Audit the confirmation-gate's "local requester" assumption.** `ConfirmationGateService` was designed assuming the approver is on the same machine. Confirm nothing in the gate flow trusts source IP / loopback in a way that LAN exposure breaks.
- [ ] **Audit-log the request source IP** on every gateway HTTP route and every WebSocket connection, so a compromise is forensically traceable. `workspace/.audit/` currently logs `websocket_connected` with socket id only.
- [ ] **`npm audit` / dependency check.** No tests, no CI; vulnerable transitive deps could ship silently. Run `npm audit --omit=dev` and triage.
- [ ] **Vault key on a multi-host Docker volume.** Verify `config/.vault/vault.enc` permissions survive volume mounts. Document the backup-and-restore path for `AUTHORCLAW_VAULT_KEY` since losing it means losing every stored credential.
- [ ] **Outbound egress posture.** The AI router and `ResearchGate` make outbound calls to Anthropic / Gemini / OpenAI / DeepSeek / OpenRouter / allowlisted research domains. Confirm `helmet`-level CSP doesn't accidentally weaken egress controls now that `connectSrc` is `*`.
- [ ] **Re-read every place that hardcoded `127.0.0.1` / `localhost`** (CSP, CORS, websocket allowlist, bind address — all touched by the LAN patch — plus any others). Confirm no remaining assumptions silently treat localhost as a trust boundary.

## Quick cleanups (minutes)

- [ ] **Stale version banner in `gateway/src/index.ts`** — console banner prints `v3.0.0` (around line 202), but `package.json` is `4.0.0`. Update the banner string.
- [ ] **Stale version in `QUICKSTART.md`** — sample startup output also shows `AuthorClaw v3.0.0`. Update to match.
- [ ] **Stale historical comment in `gateway/src/skills/loader.ts`** — comment explains that the `ops` category was once missing from the load list. The bug is fixed; delete the comment.
- [ ] **Windows path in `LAUNCH-GUIDE.md`** — section "Local PC (Windows — Direct)" references `C:\Users\chris\...`. Either generalize it or move under a per-user-example heading; right now it reads like documentation of a specific machine.

## Investigations (under an hour each)

- [ ] **Confirm `OpenClaw` / `openclaw` references are intentional** — they appear in `package.json` keywords, README, and inline comments. Decide whether to keep them as fork attribution or scrub the ones that are no longer accurate.
- [ ] **Decide whether `npm run build` (tsc emit to `dist/`) is still needed** — dev and production both run through `tsx`. If `dist/` is never consumed, the script and `tsconfig` emit settings can be simplified.

## Larger items (worth scoping before starting)

- [ ] **No test suite exists.** Pick the highest-leverage area to seed coverage — likely `AIRouter` (provider routing + token-budget logic) and `ProjectEngine` (step orchestration + completion hooks). Decide test runner first (`node --test` is already used in the sibling `claude-cowork-linux` project per the workspace `CLAUDE.md`).
- [ ] **`gateway/src/index.ts` is 2,649 lines, declares a single `AuthorClawGateway` class, owns 61 service instances across 35 numbered init phases (with two distinct `Phase 6h` blocks — symptom of how chaotic the sequence has grown), and exposes 77 methods.** Initialization is one numbered Phase sequence. Worth extracting the per-phase init into separate modules so the entry point becomes a thin composition root rather than a god class. Not a refactor to start without an explicit goal — note for the next time `index.ts` blocks a feature. **Full analysis, OpenClaw architecture comparison, and three-level refactor plan in [GOD-CLASS-REFACTOR.md](GOD-CLASS-REFACTOR.md).**
- [ ] **`gateway/src/api/routes.ts` is 5,516 lines.** A single `createAPIRoutes(app, gateway)` factory mounts all 234 endpoints. Split per feature area (projects, personas, vault, voice, website, wave3) once it next causes a merge conflict or readability issue. **Covered as Level 1 in [GOD-CLASS-REFACTOR.md](GOD-CLASS-REFACTOR.md) — same pattern as the `index.ts` extraction; can be done in the same sprint.**
- [ ] **`dashboard/dist/index.html` is ~3,800 lines** of HTML + inline JS. No build step. Acceptable today, but the next non-trivial UI change is the moment to introduce a real build (Vite or esbuild) and split into modules.

## Standing constraints (do not "fix" these)

- Server bind defaults to `0.0.0.0` and is overridable via `AUTHORCLAW_BIND`. CORS / Socket.IO / Helmet `connectSrc` are permissive (`*`). This is a deliberate departure from the upstream localhost-only contract so the Docker image is usable on a LAN. **Do not revert to `127.0.0.1`-only.** Also: `SECURITY.md` and the README still describe the old contract — flag for update when next touched.
- Fail-soft init (services log `⚠`, gateway continues) is intentional — don't make startup require optional deps (better-sqlite3, yt-dlp, Ollama).
- `.js` import extensions on `.ts` source files are required by `NodeNext` module resolution — don't strip them.
- `skills/premium/*/` is intentionally gitignored — never commit premium skill content.
- `ConfirmationGateService` must gate every new feature with external side effects (publish, send, submit, upload, bid, purchase).
