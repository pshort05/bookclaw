# BookClaw — Full Codebase Review — 2026-06-12

> **STATUS (updated 2026-06-12): all surgically-addressable findings FIXED.** A 5-agent fan-out resolved every CRITICAL/HIGH/MEDIUM finding plus the safe LOW items in one batch (`tsc` clean, 211/211 unit tests, frontend build green). The only items left open are the genuinely large/deferred ones — config-not-code pipelines, phases-as-data, `WIRED_KINDS`, the god-class refactor, TLS-aware CSP, custom dialogs, and chat markdown rendering — all tracked under "Deferred from code review 2026-06-12" in `docs/TODO.md`, with the completed batch recorded in `docs/COMPLETED.md`. The finding text below is preserved as-written for the historical record.
>
> **STATUS (2026-06-18): three of the deferred North Star items have since shipped** — **config-not-code pipelines** and **phases-as-data** (named pipelines now run as an editable, data-driven book *sequence*; the code-generated 6-phase enum is no longer the generation path — commits `e79c796`, F1/F2/F3, and `31c66d8`), and **`WIRED_KINDS`** now includes `section` and `skill` (`gateway/src/services/book-types.ts`). The remaining deferred items (god-class refactor, TLS-aware CSP, custom dialogs, chat markdown rendering) are still open. The North Star analysis in sections below is preserved as the 2026-06-12 snapshot.

Reviewer: Claude (Fable 5), 7-agent fan-out across chat, security, AI/engine, book-container data layer, API/init, and frontend. Findings are compared against the **North Star** (multi-author / multi-book studio; "adding an author, genre, or pipeline should be configuration, not code" — `docs/TODO.md` North Star, `docs/BOOK-CONTAINER-ARCHITECTURE.md`).

Severity key: **CRITICAL** (data loss / crash / silent budget defeat / security bypass), **HIGH**, **MEDIUM**, **LOW**.

---

## 0. Chat root cause — FIXED THIS SESSION

**The Chat app on `:3848` was serving a syntactically broken token bridge, so every chat client failed silently.**

`frontend/chat/index.html` declared `window.__BOOKCLAW_API_BASE__='__BOOKCLAW_API_BASE__'` — the placeholder string was **identical to the window variable name**. The serve-time `replaceAll('__BOOKCLAW_API_BASE__', gatewayOrigin)` in `gateway/src/init/phase-12-chat-http.ts` therefore rewrote the assignment target too, emitting:

```js
window.http://192.168.1.32:3847='http://192.168.1.32:3847';
```

a syntax error that aborted the entire inline `<script>`, so `window.__BOOKCLAW_TOKEN__` was never set either → the shared `api()`/`socket()` helpers sent no bearer token → silent 401s and a dead chat UI. Confirmed live: `curl http://192.168.1.32:3848/` returned exactly that mangled script.

**Fix applied** (3 files):
- `frontend/chat/index.html` — placeholder renamed to `__BOOKCLAW_API_BASE_URL__` (distinct from the variable), with a warning comment.
- `gateway/src/init/phase-12-chat-http.ts` — `replaceAll` updated to the new placeholder, with an explanatory comment.
- `tests/unit/chat-token-bridge.test.ts` — **new** regression test simulating the exact replace sequence over the real template, asserting no placeholder survives, no `window.http://` mangling, and a syntactically well-formed script. (3 tests, green.)

Verified: `npx tsc --noEmit` clean, full unit suite green (now 211), `npm run build:frontend` green. **Needs deploy** (`touch build_now`) to reach Mercury, then re-verify `curl :3848` shows the token assigned. The remaining open chat issues below are NOT fixed yet.

---

## Chat feature (remaining, not yet fixed)

- **HIGH — Handshake failures are invisible to the user.** `frontend/shared/src/chat.ts` (`subscribeChat`) binds only `response`/`error`/`disconnect`. A rejected Socket.IO **handshake** (bad/missing token, blocked IP, CORS) fires `connect_error`, which nothing listens for → the socket never connects, the user types, `waiting` latches on the "thinking" dots forever, no error shown. This is the same silent-401 *class* as the token bug, via a still-open path. **Fix:** bind `s.on('connect_error', e => onError(e?.message || 'connection failed'))` and unsubscribe it in cleanup; surface reconnect.
- **HIGH — Custom `error` event collides with Socket.IO's reserved client event.** Server emits `socket.emit('error', …)` (`gateway/src/index.ts:483`); client `s.on('error', …)` (`chat.ts:17`) conflates it with library-internal errors and assumes a `{message}` shape → bare `[error] error` bubbles. **Fix:** rename the custom event to `chat_error` on both ends.
- **HIGH — All web clients share the single `'webchat'` conversation channel.** `handleMessage(content, 'webchat', …)` (`index.ts:479`) keys history by channel, so the standalone chat AND the studio Write thread AND every browser/tab share one server-side history — the cross-channel isolation guarantee (CLAUDE.md) holds only across Telegram/Discord/web, not *between web clients*. Two concurrent sessions leak each other's turns into the AI context. **Fix:** key per socket (`webchat:${socket.id}`) or a client session id.
- **MEDIUM — Reconnect storm against a rejecting handshake.** Default `io()` has `reconnection:true`; a bad-token/blocked-IP handshake retries forever with backoff, each attempt writing an `ip_blocked` audit row, UI showing nothing. **Fix:** on a non-transient `connect_error`, `disconnect()` and surface a terminal error.
- **MEDIUM — `waiting` latches across a transient disconnect (standalone chat).** `ChatPane.tsx` clears `waiting` on disconnect with no message and no resend/correlation; a mid-request Wi-Fi blip → no reply ever, possible duplicate server work on re-send. The studio variant at least posts a "reconnecting…" notice. **Fix:** mirror the studio notice + correlate replies by message id.
- **LOW — CSP `connect-src` hardcodes `http://`/`ws://`.** Correct for the documented LAN-HTTP posture, but breaks the moment the recommended TLS reverse proxy is used (page is `https`, `connect-src http://…` blocked). **Fix (only when TLS lands):** derive scheme from `X-Forwarded-Proto`.

---

## Security perimeter

Overall the perimeter is well-built (constant-time bearer compare, deny-by-default CORS, IP allowlist in front of auth, hardened zip-staging, atomic 0600 vault writes, a confirmation gate with a pre-auth-claim defense). Calibrated to the documented single-user home-LAN threat model.

- **HIGH — External publish/deploy bypasses the ConfirmationGate.** (Cross-listed with API review.) `WebsiteDeployService.deploy()` shells out to `netlify deploy --prod` / `vercel deploy --prod` / `git push gh-pages` / `rsync … user@host:` — a textbook Wave-3 irreversible external side effect — and is wired with **no** gate (`phase-08-website.ts` constructs it without `setGate`). Contradicts SECURITY.md's "do not bypass this for any new external-side-effect feature." **Fix:** route `/api/.../deploy` and `/publish` through `ConfirmationGateService.createRequest({action:'deploy',riskLevel:'high'})` + finalize-on-approval, like the import flow.
- **MEDIUM — Confirmation finalize never transitions off `approved` → replay window.** Import/finalize calls `finalizeImport` directly and never calls `recordOutcome`/`markCompleted`, so the request stays `approved`. Replay is only stopped incidentally by the staging dir being consumed; the gate's own state still says "ready to execute," and the `approved`-protecting sweep retains the staging dir indefinitely. **Fix:** call `confirmationGate.recordOutcome(id,{success:true})` after a successful finalize so `checkDecision` returns `completed` and a replay is rejected at the gate.
- **MEDIUM — InjectionDetector is broad (false-positive) AND trivially evadable.** `you are now` (`injection.ts:18`) matches innocuous prose ("…and you are now reading chapter two") → spurious gating on imports; conversely the static regex list is bypassed by obfuscation ("ign0re previous", line-splitting, unicode, base64). It is correctly used as *advisory* (the real control is the confirmation gate), but document that and tighten `you are now` to require a role token. **Do not** increase reliance on it.
- **LOW — `?token=` query fallback puts the bearer token in URLs.** Acceptable + documented for LAN (no request logger is wired), but behind a reverse proxy the proxy access logs capture it. **Fix (only if exposed):** scope the query token to GET download routes or issue a short-lived one-time download token.
- **LOW — Vault master key written to `.env` with default perms.** First-run `writeFile(envPath, …)` (`vault.ts:79`) has no mode arg → typically `0644`, while `vault.enc` is correctly `0600`. If the workspace/repo is shared or backed up, key + ciphertext travel together. **Fix:** `chmod(envPath, 0o600)` after writing; document the key must live outside any shared/backed-up path.
- **LOW — Egress/SSRF surface in research + video-research.** `research.ts` allowlist checks only hostname (no private/loopback/link-local IP literal block); `video-research.ts:280` shell-quotes the *un-sanitized* `url` (still shell-safe, but inconsistent) and yt-dlp has no domain allowlist (widest egress hole). LAN-acceptable; flag as internet-exposure. **Fix:** reject private-range IP literals after URL parse; pass `sanitizedUrl` consistently.
- **LOW — Audit hash chain is in-memory only.** `lastHash` resets to `'0'` each boot and is never verified on load, so tampering across restarts is undetectable. **Fix (feature, not regression):** seed `lastHash` from the last line on init + a verify routine.

Confirmed sound (no action): constant-time bearer compare with length guard, Socket.IO handshake gated identically, CORS never reflects arbitrary origins, IP allowlist normalizes IPv4-mapped IPv6 and sits in front of auth on HTTP+WS, the chat Host-header allowlist prevents token redirection, the transfer-security zip guards (budget-before-inflate, symlink-mode reject, traversal/charset allowlist, no-symlink-follow), `sanitizePayload` redaction, and the library-import route correctly keeping attacker-controlled strings out of the gate payload.

---

## AI router & project engine

- **CRITICAL — Fallback completions are never cost-tracked → silent budget defeat.** `gateway/src/index.ts:725-748`: when the primary provider throws and the router falls back, the successful fallback `complete()` returns via `respond()` but `this.costs.record(...)` is **never called** (the only record is line 676, inside the primary `try`). A 25-chapter run that fails over to a paid provider records **zero** spend, so `isOverBudget()` never trips and the budget gate is defeated. **Fix:** record cost + activity on the fallback branch, mirroring 676-697. *(Confirmed against source this session.)*
- **CRITICAL — Two divergent execution loops for the same operation.** Telegram `startAndRunProject` (`index.ts:1700`, max 3 continuations, no quality loop, **no `[AI provider failure]` detection**) vs dashboard `auto-execute` (`projects.routes.ts:501`, max 6 continuations, quality-judge loop, failure short-circuit). On the Telegram path a `"[AI provider failure]…"` string is treated as a valid result, **written to the chapter file**, and the pipeline advances — corrupting the manuscript. Bug fixes must be applied twice. **Fix:** extract one shared step-runner; at minimum add the failure guard to the Telegram path.
- **HIGH — No concurrency guard on `auto-execute`.** `projects.routes.ts:529` `while(true)` on `status==='active'` with no per-project lock; two runners (dashboard + Telegram, or double-click) both process the same step and `completeStep` (whose comment already references the race) → duplicated/overwritten chapter files + double cost. **Fix:** per-project in-flight lock.
- **HIGH — `selectProvider` absolute fallback ignores the budget cap.** `router.ts:357-362`: when no tier provider qualifies, the fallback returns the first available provider regardless of tier/budget → over-budget paid call. **Fix:** prefer free in the absolute fallback and apply the `isOverBudget()` skip (match `getFallbackProvider`'s fail-closed behavior).
- **HIGH — Per-step model override dropped on the short-response retry.** `index.ts:1794-1805` / `projects.routes.ts:561-570` pass `undefined` model on retry; a step pinned to a premium editor that returns <50 chars silently re-runs on free Gemini and that output is saved canonical. **Fix:** preserve the pinned model on retry, or surface the downgrade.
- **MEDIUM — `general`-task output budget (4096) truncates pipeline content steps.** Novel-pipeline premise steps use `taskType:'general'` (`projects.ts:330,335`); a rich premise can truncate mid-section and the bible/outline build on a half-premise. **Fix:** give premise/assembly a content task type or a higher budget.
- **MEDIUM — Multi-pass continuation can lose/duplicate content; word-count via `split(/\s+/)` is unreliable.** Append-with-"don't repeat" has no overlap detection (models re-emit or skip), and token-splitting miscounts. **Fix:** de-dupe on append + one shared word-count helper + unified pass count.
- **MEDIUM — Stale fallback cost table in `costs.ts:77-80`** disagrees with the router's per-token rates and includes a dead `together` provider. **Fix:** derive from the router rates or delete.
- **LOW — Cache hit/miss counters + single-slot prompt cache race under concurrent multi-book runs** (`router.ts:157-160,408-415`) — stats-only, cosmetic.
- **North Star — hardcoded pipelines block config-not-code.** `createNovelPipeline`/`createBookProduction`/`createPipeline`'s 6-phase array are code-generated; `createProjectFromPipeline` honors `dynamic`/`novel-pipeline` by **delegating back to the code generator**, so the data path can't override the flagship novel step prompts. `bookSlug` binding verified intact on all creation paths (no leak), with one latent case: a project bound to a deleted/quarantined book silently falls back to the **global** author voice (genre correctly gets none) — add a guard that logs an unresolvable binding.

---

## Book / library / soul services (+ North Star alignment)

- **HIGH — The schemaVersion gate never blocks a write; `readonly`/`quarantined` are advisory only.** `classifyVersion` drives the badge but no write path consults it: `setActiveBook` warns then activates, `writeTemplate`/`repull`/engine `data/` writes never check, and `updatePulledFrom` rewrites the manifest in the *old* app's shape — exactly the corruption the architecture doc's decision #4 says the gate prevents. **Mitigating:** `BOOK_SCHEMA_VERSION`/`BOOK_MIN_SUPPORTED` are both `1`, so the too-new/too-old rows are currently unreachable; this is a *documented Phase-3 deferral*. **Fix before the first v1→v2 bump:** throw on non-`ok` status at `writeTemplate`/`repull` and the engine's `dataDirOf` resolution; until then document the deferral at `classifyVersion` itself.
- **MEDIUM — Re-pull 3-way merge silently deletes a library-removed file.** `book.ts:756-766`: a file in baseline+book but removed from the library yields `t=''` → diff3 auto-resolves to deletion with `hadConflicts:false`. A clean (un-edited) book re-pulling an author loses `PERSONALITY.md` with no warning. **Fix:** treat library-side removal as a conflict, or surface removed files in `RepullResult`.
- **MEDIUM — Per-book restore leaves the live Author stale.** `backup.restore()` re-inits `BookService` but not the `SoulService` singleton, and the per-book path returns `restartRecommended:false`. Reverting an active book's Author edit leaves free chat writing in the just-reverted voice until restart (pipeline steps are fine — they read fresh via `composeForBook`). **Fix:** re-invoke `soul.useBook(...)` after a restore that touches the active book, or set `restartRecommended:true` then.
- **MEDIUM — `writeEntry` blends edited files with a frozen builtin snapshot.** Editing one `.md` of a builtin author freezes its sibling files at current builtin content (overlay shadows by whole entry); a later builtin improvement never surfaces, with no library-level diff (re-pull diffing exists only for books). Acceptable-as-designed but should record the shadowed builtin version so the UI can flag drift.
- **LOW — `uniqueSlug` TOCTOU race** (two concurrent same-title creates pick the same slug and clobber); **whole-workspace restore is non-atomic** (crash mid-loop → half-restored, pre-snapshot is the manual safety net); **`FILE_SKIP` basename-substring** could drop a legit user file named `*.db`/containing `.sqlite`. All low-likelihood for a single-user LAN app. **Fixes:** atomic `mkdir` non-recursive in the slug loop; restore into a temp dir then swap; anchor the memory-index exclusion to `memory/*.sqlite`.

**North Star alignment.** Strongest where it counts for *inputs*: authors/voices/genres/sections are pure data resolved builtin→overlay→book-snapshot and composed at runtime (`composeForBook`, `genreGuideOf`) — adding one is dropping files, no code. Remaining gaps, in priority order:
1. **Pipelines are only half-data.** Static pipelines are JSON, but the flagship `novel-pipeline`/`book-production` delegate to a TS generator — "add a new pipeline shape" is not yet config.
2. **Phase order is a hardcoded global enum** (`planning|bible|production|revision|format|launch`) — a different genre cadence can't be expressed; phases should be a property of the pipeline artifact.
3. **`WIRED_KINDS` omits sections/skills** — books snapshot section/skill templates that never reach a prompt ("configure a book's sections" is currently a generation no-op).
4. **Make the version gate enforcing** before the first schema bump (see HIGH above).

---

## API routes & init wiring

- **CRITICAL — No `unhandledRejection`/`uncaughtException` guard anywhere, on Express 4 + Node 22.** *(Confirmed: grep returns nothing.)* Express 4 does **not** forward rejected promises from `async` handlers to the error middleware, and Node 22's default terminates the process on an unhandled rejection. The global handler in `phase-11-http.ts:72` only catches sync throws / explicit `next(err)`. So any `await` that rejects inside an unguarded async handler **crashes the whole gateway**, killing all in-flight projects. Many handlers are unguarded:
  - `ops.routes.ts` — nearly every mutating handler (lessons add/adjust/delete, preferences set/delete, orchestrator stop/restart/remove).
  - `website.routes.ts:40-106` — site PATCH/DELETE, link/unlink, add/remove book, add/remove blog-post (while render/deploy/publish *are* wrapped — inconsistent within one file).
  - `core.routes.ts:135-153` — `GET /api/audit` unguarded `readFile` (a read-only endpoint that can crash the process).
  **Fix (do all three):** an `asyncHandler(fn)` wrapper applied at mount, per-handler try/catch on the gaps, AND a process-level `unhandledRejection` safety net.
- **HIGH — Website deploy/publish bypasses the ConfirmationGate.** (See Security.) `WebsiteDeployService` exec's netlify/vercel/gh-pages/rsync with no gate wiring.
- **MEDIUM — Two parallel, drifted backup implementations.** Legacy `media.routes.ts:418` (`POST /api/backup/create` → ad-hoc `workspace/backups/`) vs the Phase 11 `BackupService`-backed `/api/backups` (`~/bookclaw-backups`, SNAPSHOT_RE, restore/cloud-gate). Different ID formats, destinations, source sets; **not restore-compatible**. **Fix:** retire the `media.routes.ts` block or alias it to `BackupService`.
- **MEDIUM — Confirmation-finalize preamble hand-rolled three times and drifted.** `books.routes.ts:259`, `backups.routes.ts:132`, `library.routes.ts:117` all do checkDecision→service-check→approved-check→finalize with inconsistent param shapes (path `:id` vs body `confirmationId`) and 404/409 mappings. **Fix:** extract `finalizeGatedAction(gate,{id,expectedService})` into `_shared.ts`. (Predicted by the Phase 11/12 reviews.)
- **MEDIUM — Duplicate `GET /api/audio/voices` registration** (`media.routes.ts:329` and `:387`); the second is dead code returning a different shape. **Fix:** delete `:387`.
- **MEDIUM — `GET /api/books/:slug/export` missing `SLUG_RE` guard** (every sibling validates first; this one relies on the service throwing). **Fix:** add the guard → 400.
- **LOW — `services.projects` is a permanently-dead branch** in `media.routes.ts:277` (`getServices()` exposes no `projects` key — the engine is `getProjectEngine()`), so persona-voice-by-project never resolves. **Fix:** use `gateway.getProjectEngine?.()`.
- **LOW — god-class:** `index.ts` (~2,300 lines, ~60 service fields) and the very heavy inline business logic in `projects.routes.ts:342-882` (continuation/quality/assembly/narrate/DOCX directly in the handler — the hardest code to test). Prime extraction candidate into `ProjectEngine`.

Confirmed OK: literal-before-`:param` ordering where it matters (books `/active/*`, library `/import`, website deploy-doctor), the `phase-11-http.ts` 404/SPA/error ordering, `safePath` on file-serving endpoints, and init order (routes mount in phase-11 after all service phases; fail-soft `⚠` consistent; deferred wiring correctly ordered).

---

## Frontend (studio + shared + chat)

- **HIGH — Board "live" generation UI never updates after first paint.** `Board.tsx:23` calls `loadBooks()` once on mount with no polling/socket; the whole point of Phase 9 (`b.live`, "writing…" strip, Rail Generating/Idle counts) goes stale immediately — phase never advances, the strip never clears. The only live channel (`streamActivity`) feeds only `Activity.tsx`. **Fix:** poll `loadBooks()` while any book has `live`, or have the Activity SSE trigger a store refresh.
- **HIGH — `api()` error contract is a stringified-status heuristic.** `api.ts:24` throws `new Error('${res.status} ${path}')`; callers branch on `String(e).includes('409')`/`'404'` (`EntryList.tsx`, `Settings.tsx`). Any path/slug/id containing those digits yields a false branch (e.g. a slug `book-409` → "Expired" on a valid error). **Fix:** `Object.assign(new Error(...), {status: res.status})` and branch on `e.status`.
- **MEDIUM — Chat never resubscribes/resets on reconnect; replies aren't correlated.** Singleton socket, no `connect`/`reconnect` handling; a late `response` after reconnect attaches to the wrong prompt; token captured once at socket creation can't pick up rotation without reload. **Fix:** handle `connect`/`reconnect`, tag outgoing messages + match replies, ignore `response` while `waiting===false`.
- **MEDIUM — `marked.parse(...) as string` cast** (`ProseEditor.tsx:52`) will render `"[object Promise]"` if marked ever runs async. (Sanitization itself is correct.) **Fix:** `marked.parse(content,{async:false})`.
- **MEDIUM — Shallow nested `cloud` config PATCH** (`Settings.tsx`) assumes the server deep-merges `cloud`; if it shallow-merges, adding a destination wipes `cloud.enabled`/`hook`. **Fix:** verify server merge (it does deep-merge via `ConfigService.deepMerge` — confirm) or send the full `cloud` object.
- **MEDIUM — `useActiveBook` race before `loadBooks()` resolves.** Deep-linking `/write` (no `:slug`) renders the "No active book" empty state until the store's first fetch finishes, and `Write.tsx` doesn't itself trigger `loadBooks()`. **Fix:** gate the empty state on the existing-but-unused `booksLoaded` flag.
- **LOW — `booksLoaded` exposed but never consumed** (false empty-state flash); **index keys on reorderable `PipelineEditor` steps** (focus/open-state mis-association on reorder — the manual Set-remap is the tell); **native `prompt()`/`confirm()`/`alert()`** for reject/destructive flows (blocking, and Cancel-on-reject still proceeds with empty reason); **studio "Chat" link hardcodes 3848**; **AI replies render as plain text** (raw `**bold**`) while the prose preview renders markdown — consistency gap (don't fix by adding raw `dangerouslySetInnerHTML`).

Confirmed OK: XSS handled correctly — every untrusted/imported render path sanitizes via `DOMPurify.sanitize(marked.parse(...))`; no other `dangerouslySetInnerHTML`. `?token=` confined to native-GET elements (EventSource, export link) + manual-header multipart upload. Effect cleanup generally careful (`cancelled`/`alive` guards). No hardcoded single-book slug assumptions beyond the refresh/race gaps above.

---

## Recommended priority order

1. **CRITICAL — process-crash safety:** add `asyncHandler` + a process-level `unhandledRejection` guard, and wrap the unguarded handlers in `ops`/`website`/`core` routes. One unlucky disk/JSON error currently kills the gateway mid-run.
2. **CRITICAL — fallback cost tracking** (`index.ts:725-748`): record spend on the fallback branch so the budget gate isn't silently defeated.
3. **CRITICAL — unify the two execution loops** (or at minimum add the `[AI provider failure]` guard to the Telegram path so it stops writing error strings into manuscripts).
4. **HIGH — gate website deploy/publish** through `ConfirmationGateService`.
5. **HIGH — chat usability:** bind `connect_error`, rename the reserved `error` event, per-socket conversation channel. (The root-cause token-bridge bug is already fixed; deploy it.)
6. **HIGH — `auto-execute` concurrency lock; budget-aware absolute fallback; preserve pinned model on retry; Board live-refresh; structured `api()` error status.**
7. **MEDIUM — retire the legacy `media.routes.ts` backup block; extract the shared confirmation-finalize helper; re-pull file-deletion conflict; restore→soul reload.**
8. **Before the first schemaVersion bump — make the version gate enforcing.**
9. **North Star — lift `novel-pipeline`/`book-production` into data, make phases a pipeline property, wire sections/skills into prompts.** This is the substantive remaining distance to "configuration, not code."

Per `CLAUDE.md`, none of these should be started without first being tracked in `docs/TODO.md` — this report is the source list; promote items into TODO as they're scheduled.
