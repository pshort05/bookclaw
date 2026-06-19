# Bug Review — 2026-06-18

Full-codebase bug audit. 18 read-only finder agents partitioned every source file under `gateway/src/` and `frontend/`; each candidate was independently verified (recall-biased — only provably-false candidates dropped). 116 candidates surfaced, 20 refuted, **95 kept** after dedup.

**Severity:** 19 high · 41 medium · 35 low

Verdict legend: `CONFIRMED` = failing path constructed from the code; `PLAUSIBLE` = realistically reachable, not disproven.

## High (19)

### B01 · `gateway/src/api/routes/documents.routes.ts:100` · CONFIRMED

**Document-library upload writes the raw multer originalname without sanitization or safePath, allowing arbitrary file write outside workspace/documents.**

- *Scenario:* An authenticated client POSTs to /api/documents/upload with a multipart filename of '../../../../home/paul/bookclaw-workspace/soul/SOUL.md' (ext '.md' passes the fileFilter). filename = req.file.originalname is used directly in wf(j(docsDir, filename), buffer), so path.join resolves the '..' segments and the file is written outside docsDir (overwriting SOUL.md or any reachable file). The extracted-text write on line 129 and metadata key share the same flaw. Note the sibling /api/projects/:id/upload route explicitly sanitizes originalname (lines 239-244); this route was missed.
- *Fix:* Sanitize/whitelist the filename the same way /api/projects/:id/upload does (strip control chars, path separators, leading dots), or run it through safePath(docsDir, filename) and reject on null before any write (raw file, extracted .txt, and metadata key).

### B02 · `gateway/src/api/routes/heartbeat.routes.ts:148` · CONFIRMED

**Non-numeric :index in the idle-task delete passes the bounds check and deletes task 0 instead of returning 404.**

- *Scenario:* DELETE /api/autonomous/idle-tasks/foo (or any non-numeric index) → parseInt('foo') is NaN; the guard `idx < 0 || idx >= tasks.length` is false for NaN, so it falls through to tasks.splice(NaN, 1), which splice coerces to index 0 and removes the first idle task while reporting success.
- *Fix:* After parseInt, reject with 400/404 when Number.isNaN(idx): `if (!Number.isInteger(idx) || idx < 0 || idx >= tasks.length) return res.status(404)...`.

### B03 · `gateway/src/api/routes/projects.routes.ts:724` · CONFIRMED

**qualityMaxRetries default is computed with `Number(undefined) ?? 1`, which yields NaN and silently disables the entire quality-loop feature by default.**

- *Scenario:* Any project that does NOT set context.qualityMaxRetries (the documented default — 'Defaults to 1 retry'). `Number(undefined)` is `NaN`, and `NaN ?? 1` stays `NaN` (??  only catches null/undefined). The guard `while (attempt <= maxRetries)` is `0 <= NaN` → false, so the judge evaluate/retry loop never runs for a single write/polish step. The quality-evaluation feature is effectively off for every default project, contrary to the comment and to the sibling line 723 which correctly uses `|| 70`.
- *Fix:* Use the same falsy-default pattern as qualityThreshold: `const maxRetries = Number(currentProject.context?.qualityMaxRetries) || 1;` (or guard NaN explicitly with Number.isFinite).

### B04 · `gateway/src/bridges/telegram.ts:382` · CONFIRMED

**/read treats any filename beginning with a digit as a file-picker index, so named files like '3-chapter.md' open the wrong file.**

- *Scenario:* User runs `/files` (populating lastFileList), then `/read 3-chapter.md`. parseInt('3-chapter.md',10) returns 3, isNaN(num) is false, and 3 is within lastFileList bounds, so the code silently substitutes lastFileList[2] instead of reading the file the user actually named.
- *Fix:* Guard the numeric branch the same way /speak does: only treat input as an index when `input === String(num)` (i.e. the whole token is a pure number), e.g. `if (!isNaN(num) && input === String(num) && this.lastFileList && num >= 1 && num <= this.lastFileList.length)`.

### B05 · `gateway/src/bridges/telegram.ts:428` · CONFIRMED

**/export has the same parseInt-prefix bug: a filename starting with a digit is misread as a file-picker number.**

- *Scenario:* User runs `/files` then `/export 2025-outline.md html`. parts[0]='2025-outline.md', parseInt yields 2025 (or for '2-x.md' yields a valid index), and when the parsed number falls within lastFileList range the wrong file is exported.
- *Fix:* Only treat filename as an index when the whole token is numeric: `if (!isNaN(num) && filename === String(num) && this.lastFileList && num >= 1 && num <= this.lastFileList.length)`.

### B06 · `gateway/src/index.ts:1426` · CONFIRMED

**Dashboard /files command joins user-supplied folder arg into a path with no sandbox/traversal check, allowing directory escape out of workspace/projects.**

- *Scenario:* An authenticated dashboard user sends `/files ../../..` (or `/files ../../`). `join(projectsDir, args)` resolves outside workspace/projects, readdirSync lists that directory, and each entry is pushed into dashboardLastFileList as `join(args, f)` — exposing arbitrary directory contents and seeding the read/export number-pick cache with paths outside the workspace.
- *Fix:* Resolve the target dir and verify it stays under workspace/projects (use this.sandbox / SandboxGuard, or check the resolved path startsWith the projects dir + path.sep) before reading; reject otherwise.

### B07 · `gateway/src/index.ts:2449` · CONFIRMED

**readFile() (used by /read and /export) joins a caller-controlled filename onto workspaceDir with no path-traversal guard, so `..` segments read arbitrary files on the host.**

- *Scenario:* From dashboard chat: `/read ../../../../etc/passwd` (or `/read ../../.env` to grab BOOKCLAW_AUTH_TOKEN/vault key). cleanName only strips leading emoji/space, then `join(workspaceDir, cleanName)` escapes the workspace and fs.readFile returns the file contents to the user. SandboxGuard is imported and wired but never consulted here.
- *Fix:* Run cleanName through this.sandbox to confirm the resolved path is inside workspace/ before existsSync/readFile; reject paths that resolve outside the sandbox.

### B08 · `gateway/src/init/phase-12-chat-http.ts:87` · CONFIRMED

**The chat server's listen promise has no 'error' handler, so a port-in-use error hangs gateway startup forever.**

- *Scenario:* BOOKCLAW_CHAT_PORT is set to a port already bound by another process (or a previous BookClaw instance). chatServer.listen emits an 'error' (EADDRINUSE) event. The promise only resolves from the listen-success callback, so it never resolves. Because there is a process-level uncaughtException handler that logs but does NOT exit (index.ts:132), the process survives but `await new Promise(...)` blocks indefinitely at phase-12 (called at index.ts:441 during initialize()). The main gateway server's listen() at index.ts:2476 is never reached, so the entire app becomes a zombie that serves nothing.
- *Fix:* Attach an error handler before/inside the promise and reject (or resolve fail-soft) on it: `await new Promise<void>((resolve, reject) => { chatServer.once('error', reject); chatServer.listen(chatPort, bind, () => resolve()); });` and wrap in try/catch so a chat-port failure degrades to 'chat disabled' instead of blocking the gateway.

### B09 · `gateway/src/services/book.ts:903` · CONFIRMED

**applySeriesAssets deletes the entire templates/pipeline/ directory before writing a single pipeline file, wiping all other pipelines in a multi-pipeline book's sequence.**

- *Scenario:* A book created with a multi-pipeline sequence (e.g. pipelineSequence=['book-planning','book-production']) is pulled into a series whose refs include a pipeline. assetRel('pipeline') returns 'pipeline' (the whole dir), so the loop rm -rf's templates/pipeline/ and .baseline/pipeline/, then writes only the one ref pipeline. The other sequence pipelines' <name>.json files are gone, but manifest.pipelineSequence still lists them, so snapshotPipelineOf()/pipelineOf() return null for them and the book's generation breaks.
- *Fix:* For pipeline kind in applySeriesAssets, do not rm the whole 'pipeline' dir; target/remove only templates/pipeline/<ref.name>.json (mirroring repull's writeMap, which mkdirs and writes the single file without deleting the directory).

### B10 · `gateway/src/services/character-voices.ts:234` · CONFIRMED

**Corpus trim resets dialogueWordCount to only the retained (capped) word total but never resets fingerprintBuiltAtWordCount, so wordsSinceLastBuild can go negative and the fingerprint stops rebuilding.**

- *Scenario:* A talkative character accumulates >20K words across >100 corpus lines. On the chapter where corpus.length first exceeds 100, the trim block sets voice.dialogueWordCount = total (e.g. ~20000, the cap) but may drop it below fingerprintBuiltAtWordCount if that was recorded at a higher count earlier. Then `wordsSinceLastBuild = dialogueWordCount - fingerprintBuiltAtWordCount` is negative, so `wordsSinceLastBuild >= 500` is never true and the existing fingerprint is never refreshed again as the character keeps speaking.
- *Fix:* When trimming, clamp/reset fingerprintBuiltAtWordCount to min(it, voice.dialogueWordCount), or track words-since-build independently of the capped total.

### B11 · `gateway/src/services/character-voices.ts:433` · CONFIRMED

**explicitTagRe matches a tag verb that appears AFTER the closing quote anywhere in the paragraph and captures the word before the verb as speaker, but the regex pattern `[",”]\s*[,.?!]?\s*(Name)\s+(said...)` requires a quote immediately before the name — this misattributes 'said Alice' (verb-first) lines and tags like inside-dialogue capitalized words.**

- *Scenario:* A paragraph like `"Get out," she said. Marcus stepped forward.` The explicitTagRe looks for quote + Name + verb; reverseTagRe looks for verb + Name. For `"Hello," said John` the explicitTagRe requires the Name BEFORE the verb right after the quote, so it fails, then reverseTagRe matches `said John` correctly. But for `"Hello," John said` explicitTagRe matches `" John said` → John, good. The real defect: reverseTagRe `\b(said...)\s+(Name)` will also match narration like `...he had said. Marcus...` capturing Marcus as the speaker of an unrelated quote in the same paragraph, producing confident (0.85) wrong attributions.
- *Fix:* Anchor the tag regexes to the dialogue boundary (immediately adjacent to the closing/opening quote) rather than matching the verb anywhere in the paragraph.

### B12 · `gateway/src/services/context-engine.ts:487` · CONFIRMED

**extractEntities dereferences ne.name without guarding against a missing/undefined name from the AI JSON, crashing the merge loop.**

- *Scenario:* The AI returns an entity object lacking a `name` field (or name:null) within the entities array — plausible on a malformed-but-parseable response. `ne.name.toLowerCase()` throws TypeError, aborting extractEntities and the surrounding writing/continuity step, discarding all entities in that batch.
- *Fix:* Skip entries where `!ne?.name || typeof ne.name !== 'string'` before normalizing.

### B13 · `gateway/src/services/launch-orchestrator.ts:258` · CONFIRMED

**proposeStep uses timeline.find(s => s.phase === phase) but several phases map to multiple timeline steps, so only the first step of a phase can ever be proposed.**

- *Scenario:* buildPlan emits three steps with phase 'launch_day' (flip pre-order, send launch email, post social, plus the day-1 AMS kickoff) and three with phase 'follow_up_30' (price pulse, follow-up email, AMS review), and two 'arc_seeded'. Calling proposeStep(id,'launch_day') always returns the first match (flip KDP pre-order) and there is no way to create confirmations for the launch email, social, or AMS steps; same for follow_up_30/arc_seeded.
- *Fix:* Key steps by a unique identifier (e.g. add a stepId or use dayOffset+action) and have proposeStep accept that, or change proposeStep to operate on all steps of a phase instead of find() returning just the first.

### B14 · `gateway/src/services/memory-search.ts:423` · CONFIRMED

**Every conversation turn is indexed twice — once live and once on full reindex — because the two code paths build different sourceRefs that never collide on the UNIQUE(source, source_ref) constraint.**

- *Scenario:* A chat turn happens: MemoryService.process() fires the live-index hook, which calls indexConversationTurn() and inserts with sourceRef `<date>.jsonl#live-<ts>-<rand>`. Later reindexAll() runs (on boot via phase-03/phase-07, or manual reindex) and re-reads the same JSONL line, inserting it again with sourceRef `<file>#<i>`. The two refs differ, so ON CONFLICT never triggers and the same turn now appears as two separate search hits, inflating getStats totals and returning duplicate snippets.
- *Fix:* Make the live and reindex sourceRefs deterministic and identical. In indexConversationTurn, derive the JSONL line index the same way reindexAll does (e.g. track the appended line number in MemoryService.process and pass it through), so both produce `<date>.jsonl#<i>` and upsert dedups.

### B15 · `gateway/src/services/orchestrator.ts:508` · CONFIRMED

**debouncedPersist() leaks/abandons the prior promise's resolve when called twice within the debounce window, so an awaiting caller (addScript/removeScript) hangs forever.**

- *Scenario:* Call addScript() then removeScript() (or two addScript) within 2 seconds. The first call sets persistTimer and returns a Promise P1 (resolve1 captured by timer T1). The second call clears T1 (line 509) — so resolve1 is never invoked — and creates T2/resolve2 for P2. P1 never resolves, so the `await this.debouncedPersist()` in the first CRUD call hangs indefinitely; any caller awaiting that response stalls.
- *Fix:* Don't tie the returned promise to a per-call timer. Either resolve immediately and persist in the background, or track pending resolvers in an array and resolve them all when the single debounced write fires.

### B16 · `gateway/src/services/projects.ts:835` · CONFIRMED

**completeStep persists state only when the project finishes; every intermediate step completion returns early without calling persistState(), so step results are never written to disk until the final step.**

- *Scenario:* Run any multi-step project. Complete step 1: a `next` step exists, so the function mutates step1.status='completed'+result and returns at line 835 before reaching persistState() at line 851. If the server restarts (or crashes) before the last step completes, loadState() restores stale step statuses/results from the last persisted snapshot, losing all intermediate progress and completed-step outputs from the state file.
- *Fix:* Call this.persistState() inside the `if (next)` branch before `return next;` (line ~834), so every completion is debounced-persisted, not just project completion.

### B17 · `gateway/src/services/track-changes.ts:71` · CONFIRMED

**The insert/delete/formatting regexes never capture w:author or w:date, so every tracked change is attributed to 'Unknown' with an empty date even when the docx supplies real attributes.**

- *Scenario:* Parse any real Word track-changes .docx where <w:ins w:author="Alice" w:date="..."> carries attributes. The lazy `[^>]*?` segment before each optional `(?:w:author=...)?`/`(?:w:date=...)?` group matches the fewest characters, so the optional groups always match empty. Verified at runtime: m[1] and m[2] come back undefined for `<w:ins w:id="1" w:author="Alice" w:date="...">`. The report's `authors` array is therefore always empty/['Unknown'] and per-change author/date are wrong.
- *Fix:* Capture attributes from the tag's attribute list independently of order, e.g. grab the full opening tag with one match (`<w:ins\b([^>]*)>`) then run `/w:author="([^"]*)"/` and `/w:date="([^"]*)"/` against the captured attribute string; apply the same pattern to the del, fmt, and comment regexes.

### B18 · `gateway/src/services/track-changes.ts:132` · CONFIRMED

**The comment regex also fails to capture w:author/w:date for the same lazy-quantifier reason, so all comments are attributed to 'Unknown' with no date.**

- *Scenario:* applyDecisions/parseDocx on a .docx with reviewer comments carrying `w:author`/`w:date`: the mandatory `w:id` capture works, but the optional author/date groups always match empty (verified at runtime). Comment attribution in the report is always wrong.
- *Fix:* Extract author/date from the captured comment opening-tag attribute string with separate `/w:author="([^"]*)"/` and `/w:date="([^"]*)"/` matches rather than relying on order-sensitive optional groups.

### B19 · `gateway/src/services/website-builder.ts:339` · CONFIRMED

**Nav and footer links in shell() are always root-relative, so every per-book and per-blog-post page (rendered into book/ and blog/ subdirectories) has broken navigation.**

- *Scenario:* Build any site with at least one book or blog post. Open the generated book/<slug>.html or blog/<slug>.html. The nav links href="index.html", "books.html", "about.html", "contact.html" resolve relative to the subdirectory (e.g. book/index.html, book/books.html) and 404; only the stylesheet/feed hrefs (lines 372-373) were special-cased with ../, the nav (line 339-348) and footer were not.
- *Fix:* Compute a single isSubpage flag (pages not in {Home,About,Books,Contact}) and prefix nav/footer internal links with '../' when isSubpage, using the same condition already applied to the stylesheet/RSS hrefs. Better: pass an explicit depth/prefix argument into shell() rather than inferring from pageTitle.

## Medium (41)

### B20 · `frontend/shared/src/chat.ts:34` · CONFIRMED

**connect_error handler calls onError unconditionally, injecting '[error]' bubbles into the chat thread even on transient blips when the user is not waiting for a reply.**

- *Scenario:* While the chat is idle (no pending turn), Socket.IO emits a transient `connect_error` (network hiccup, server restart). connErr fires onError, which in ChatPane/ChatThread appends an assistant message like '[error] websocket error' / '⚠ ...' to the thread, polluting the conversation with spurious errors unrelated to any user action. The reply path is guarded by isWaiting(), but the error path is not.
- *Fix:* Gate the onError call (or at least the thread-append) on isWaiting(), or distinguish transient vs terminal connect_error before surfacing it to the user.

### B21 · `frontend/studio/src/components/ResetSpendModal.tsx:49` · CONFIRMED

**doReset() has no catch, so a failed reset-total POST silently swallows the error and shows the user nothing.**

- *Scenario:* User types the confirmation phrase and clicks 'Reset total spend' while the gateway returns 500 (or is briefly down). The await rejects, setResult is never reached, the finally clears busy, and no error message is rendered — the modal looks like it did nothing while the rejection is unhandled. Unlike every sibling modal/action which wraps the API call in try/catch with a visible error, this one only has try/finally.
- *Fix:* Add a catch around the api() call that surfaces the failure, e.g. `catch (e) { setResult(null); /* show an error */ setMsg(`Reset failed — ${String(e)}`); }` mirroring DeleteBooksModal.

### B22 · `gateway/src/api/routes/core.routes.ts:172` · PLAUSIBLE

**GET /api/activity awaits activityLog.getRecent with no try/catch and is not wrapped in asyncHandler, so a rejection hangs the request (no response ever sent).**

- *Scenario:* The dashboard polls /api/activity. If activityLog.getRecent() rejects (e.g. corrupt/locked JSONL, transient fs error), the async handler's promise rejects; the global unhandledRejection handler only logs it, the Express error middleware is never reached (next is not called), and `res` is never written — the client hangs until its own timeout. Repeated polling leaks hung responses.
- *Fix:* Wrap the handler body in try/catch returning res.status(500), or wrap the route with asyncHandler (already imported in this file) so rejections route to the error middleware.

### B23 · `gateway/src/api/routes/documents.routes.ts:393` · CONFIRMED

**Workspace stats scans '.memory' and '.audio' but the real directories are 'memory' and 'audio', so those buckets always report 0.**

- *Scenario:* GET /api/workspace/stats calls scanDir('memory', j(workspaceDir, '.memory')) and scanDir('audio', j(workspaceDir, '.audio')). MemoryService/MemorySearch write to workspace/memory (no dot) and TTS writes to workspace/audio (tts.ts:124, no dot). The dirs with leading dots don't exist, so existsSync is false and both buckets always show files:0/size:0, undercounting totalFiles/totalSize on the dashboard.
- *Fix:* Change the scanDir targets to j(workspaceDir, 'memory') and j(workspaceDir, 'audio') (no leading dot), matching the actual write locations. '.agent' is correct and should stay.

### B24 · `gateway/src/api/routes/documents.routes.ts:413` · CONFIRMED

**Workspace clean maps target 'audio' to directory '.audio', but the real audio dir is 'audio', so the clean silently deletes nothing.**

- *Scenario:* DELETE /api/workspace/clean?target=audio sets dirName = '.audio' and removes workspace/.audio, which does not exist. The real generated TTS files live in workspace/audio (tts.ts:124). The endpoint returns success with deleted:0 while the actual audio directory is never cleaned.
- *Fix:* Drop the audio->'.audio' remapping; use targetDir = j(workspaceDir, target) directly so 'audio' resolves to workspace/audio.

### B25 · `gateway/src/api/routes/heartbeat.routes.ts:284` · CONFIRMED

**HTML export interpolates docTitle/docAuthor/content into the generated HTML without escaping, producing a stored-XSS payload on disk.**

- *Scenario:* POST /api/author-os/format with title or a markdown file containing `<script>...` or `<img onerror>` writes that markup verbatim into workspace/exports/*.html (docTitle into <title>/<h1>, content via the naive markdown→HTML replace). The app's own file-serve path forces .html to octet-stream so it is not reflected through the API, but the on-disk file is a live XSS document if opened directly or served by any other static host (e.g. the website deploy).
- *Fix:* HTML-escape docTitle, docAuthor, and the text portions of content before interpolation (escape `&<>"` on the title/author and on text runs of the markdown conversion).

### B26 · `gateway/src/api/routes/knowledge.routes.ts:571` · CONFIRMED

**Default progress of 100 is never applied because Number(undefined) yields NaN, which the ?? chain does not replace.**

- *Scenario:* GET /api/projects/:id/plot-promises/audit when the project is missing/has no progress AND no ?progress query param: progressPct = project?.progress ?? Number(req.query.progress) ?? 100 evaluates to undefined ?? NaN ?? 100 = NaN (NaN is not null/undefined so ?? keeps it). audit() receives NaN explicitly, so its default param =100 never engages; NaN >= riskThreshold is false (no at-risk flagging) and progressPct < riskThreshold is also false, so the summary wrongly reports 'All promises closed... Story feels complete' even when open promises exist.
- *Fix:* Guard the parse, e.g. const q = Number(req.query.progress); const progressPct = project?.progress ?? (Number.isFinite(q) ? q : 100);

### B27 · `gateway/src/api/routes/projects.routes.ts:551` · CONFIRMED

**restart with keepCompleted:true still deletes the assembled manuscript markdown when outputs live in the shared book data/ dir, because the preserve-list checks unprefixed filenames but the files are written id-prefixed.**

- *Scenario:* A novel-pipeline project bound to a book (Phase 8, the current default) assembles its manuscript as `${project.id}-manuscript.md` (lines 932-933). Calling POST /api/projects/:id/restart with body {keepCompleted:true, deleteOutputFiles:true}: line 547 keeps the .md, line 550 keeps it (id prefix matches), but line 551's guard compares against the literal `manuscript.md` / `revised-manuscript.md` etc., which never equals `${id}-manuscript.md`, so the assembled manuscript the user asked to preserve is rm'd. (The .docx survives only incidentally via the .md filter on line 547.)
- *Fix:* Strip the `${project.id}-` prefix before the keep-comparison when activeDataDir is set, e.g. compute `const base = activeDataDir ? f.replace(new RegExp('^'+project.id+'-'),'') : f;` and test `base` against the preserve list.

### B28 · `gateway/src/bridges/telegram.ts:40` · CONFIRMED

**lastFileList is a single instance-wide array shared across all chats, so concurrent users' /files and /read-by-number cross-contaminate.**

- *Scenario:* User A in chat 111 runs `/files` (lastFileList = A's files). Before A reads, user B in chat 222 runs `/files` (overwrites lastFileList with B's files). User A then runs `/read 2` and gets a file from B's list. Same applies to /export and /speak by number.
- *Fix:* Key the file list per chat: change to `private lastFileList: Map<number, string[]>` and store/read by chatId, mirroring voiceMode/lastResponse.

### B29 · `gateway/src/bridges/telegram.ts:99` · PLAUSIBLE

**message.from is dereferenced without a guard, crashing the poll handler on updates that carry text but no from field.**

- *Scenario:* Telegram delivers an update whose `message` has `.text` but no `.from` (e.g. automatic-forward/channel-linked group posts where `from` is absent). Line 99 `String(message.from.id)` throws 'Cannot read properties of undefined', the error is caught in poll()'s catch but that update_id was already advanced, and authorization is effectively bypassed for that branch since the exception fires before the allowedUsers check.
- *Fix:* Guard at line 97: `if (!message?.text || !message.from) continue;` (or fall back to chat.id for userId), so messages without a sender are skipped cleanly.

### B30 · `gateway/src/index.ts:182` · CONFIRMED

**apiRateLimits Map is never pruned — expired buckets are only overwritten when the same key returns, so with attacker-varied source keys it grows without bound (memory leak) and the limiter is bypassed.**

- *Scenario:* With BOOKCLAW_TRUST_PROXY=1, req.ip is derived from X-Forwarded-For. A client sending a unique XFF value per request gets a brand-new `${ip}|anon` bucket each time: the count never exceeds the limit (rate limiting defeated) and apiRateLimits accumulates one entry per request indefinitely until the process OOMs.
- *Fix:* Periodically sweep entries whose resetAt <= now (e.g. opportunistically delete the entry when resetAt has passed instead of relying on overwrite, and/or cap Map size); independently, do not trust unauthenticated XFF for bucketing.

### B31 · `gateway/src/index.ts:1499` · CONFIRMED

**/export self-call hardcodes port 3847 instead of the configured server.port, so it fails when the gateway is run on a different port.**

- *Scenario:* Operator sets server.port (config) or runs the gateway on a non-default port; `/export 1` does fetch('http://localhost:3847/api/author-os/format'), which connects to nothing (or the wrong process) on the actual port, and export silently fails with a connection error.
- *Fix:* Build the URL from this.config.get('server.port', 3847) (and localhost) rather than the literal 3847, or call the format handler in-process instead of via HTTP.

### B32 · `gateway/src/services/audiobook-prep.ts:253` · CONFIRMED

**Author-supplied IPA is injected unescaped into the SSML phoneme ph attribute, so an IPA value containing a double-quote breaks the SSML (malformed XML).**

- *Scenario:* Author fills suggestedIPA for an entity with a value containing a double quote or '<'/'>' (or even '&'). buildSSML emits `<phoneme alphabet="ipa" ph="${ipa}">` with the raw value, producing invalid XML that Polly/Azure/Google TTS reject for that whole chapter.
- *Fix:* Run the IPA through escapeXml (it already escapes ", <, >, &) before interpolating it into the ph="..." attribute.

### B33 · `gateway/src/services/backup.ts:151` · CONFIRMED

**Full-scope snapshots copy workspace/.vault (and .audit) into the backup, and pushCloud then zips and uploads that snapshot including the credential vault.**

- *Scenario:* With backup.scope='full' and backup.cloud.enabled=true, createSnapshot uses readdirSync(workspaceDir).filter(!FULL_SKIP) which includes .vault and .audit (neither starts with .tmp). pushCloud zips the whole snapshot dir and copies/rclones it to the configured cloud destination, exfiltrating the encrypted vault and audit chain — even though restore() is careful to never touch .vault/.audit.
- *Fix:* Exclude .vault and .audit from createSnapshot's top-level set in both scopes (add them to the FULL_SKIP / tops filter), consistent with restore()'s exclusion, so they are never copied into snapshots or pushed to cloud.

### B34 · `gateway/src/services/beta-reader.ts:138` · CONFIRMED

**parseFeedback validates pacing with `validPacing.includes(parsed.pacing)` but parsed may be {} on JSON failure making parsed.pacing undefined (ok, defaults), however clampTension/clampContinue use `Number(n) || fallback` which treats a legitimate 0 wantToContinue as missing and substitutes 50.**

- *Scenario:* A beta-reader archetype legitimately returns wantToContinue: 0 (would definitely stop reading). `Math.max(0, Math.min(100, Number(0) || 50))` → Number(0)||50 = 50, so the strongest 'I'd quit' signal is silently rewritten to a neutral 50, corrupting aggregate avgWantToContinue and weakest-chapter detection.
- *Fix:* Use a null-aware coercion: `const x = Number(n); return Number.isFinite(x) ? clamp(x) : fallback;` so 0 is preserved.

### B35 · `gateway/src/services/blog-post-drafter.ts:338` · CONFIRMED

**markdownToBasicHTML emits link hrefs straight from AI markdown without scheme validation, allowing javascript:/data: URLs to survive HTML escaping.**

- *Scenario:* The model (or injected excerpt/author-angle text) emits markdown like [click](javascript:alert(document.cookie)). HTML special chars are escaped earlier, but the link regex on line 338 reinserts the raw URL into href, producing <a href="javascript:alert(...)">; when the static page is opened the script can run on the author's own domain. Static + author-reviewed lowers but does not remove the risk.
- *Fix:* After capturing the URL, reject or neutralize non-http(s)/mailto schemes (e.g. only allow URLs matching /^(https?:|mailto:|\/|#)/i, otherwise drop the link or render it as text), and escape quotes in the URL.

### B36 · `gateway/src/services/character-voices.ts:445` · CONFIRMED

**spokenMatches regex `["“]([^"“”]+)["”]` requires non-empty content but a paragraph whose dialogue uses only straight quotes with nested apostrophes, or a single unclosed quote, yields no match and the whole spoken line is dropped even though startsWithQuote passed.**

- *Scenario:* A paragraph starts with a quote (passes startsWithQuote at line 438) but the closing quote is a different style or missing (e.g. `"I can't believe it.` with no closing quote, common in multi-paragraph speech). spokenMatches is [], spoken is '', the line is skipped at line 450, so legitimately spoken dialogue across paragraph breaks is never attributed to the character.
- *Fix:* Fall back to stripping the leading quote and taking the rest of the paragraph as spoken text when no full quote pair is found.

### B37 · `gateway/src/services/context-engine.ts:180` · CONFIRMED

**The code-fence stripping regex can delete the entire JSON body when the model emits a closing ``` after the JSON.**

- *Scenario:* A model returns ```json\n{...}\n``` (allowed per the comment that models wrap output despite the prompt). The second replace `/```[\s\S]*$/` matches the trailing fence AND everything after the first occurrence is fine, but the FIRST replace `/^[\s\S]*?```(?:json|JSON)?\s*/` strips the opening fence; then `/```[\s\S]*$/` greedily removes from the trailing ``` to end. That works for a single block, but if the model emits any inline ``` later (e.g. inside a string value, or a second fenced block of commentary), the greedy `[\s\S]*$` from the first ``` truncates valid JSON content, yielding unparseable/partial JSON.
- *Fix:* Prefer extracting the substring between the first '{' and matching last '}' before fence-stripping, or make the trailing-fence removal non-greedy / anchored to a fence that is not inside a JSON string.

### B38 · `gateway/src/services/context-engine.ts:355` · PLAUSIBLE

**debouncedPersist swallows write errors and the 2s timer can fire after shutdown, and persistContext serializes the live cached object with no lock, risking lost writes / unhandled state.**

- *Scenario:* Two rapid generateSummary/extractEntities calls schedule debounced writes; the timer's persistContext runs `JSON.stringify(ctx)` on the same Map-held object that a concurrent extractEntities is mutating mid-loop, so a partially-merged context can be serialized. Additionally `.catch(() => {})` hides ENOSPC/permission failures, so context silently never persists and survives only in memory until process exit.
- *Fix:* Snapshot or guard the object during serialization and log (not swallow) persist failures; clear timers on shutdown.

### B39 · `gateway/src/services/cron-scheduler.ts:119` · CONFIRMED

**Day-of-month and day-of-week are AND-combined instead of the standard cron OR semantics.**

- *Scenario:* User enters '0 9 13 * 5' expecting 'at 9am on the 13th OR on any Friday' (POSIX cron behavior). matches() requires dom AND dow to both match, so the job only fires when the 13th is itself a Friday — almost never. Any expression that restricts both DOM and DOW produces far fewer (or zero) runs than the author expects.
- *Fix:* When both dom and dow are restricted (neither is the full '*' set), match if EITHER dom OR dow matches, per cron convention; keep AND only when one of them is unrestricted.

### B40 · `gateway/src/services/cron-scheduler.ts:192` · CONFIRMED

**Jobs that were due while the server was down never fire, contradicting the documented catch-up behavior.**

- *Scenario:* A user schedules a daily-midnight backup ('0 0 * * *'). The server is restarted at 02:00. initialize() loops every job and calls recomputeNextRun(), which sets nextRunAt to nextRun(new Date()) — i.e. tonight's midnight, in the future. The immediate setImmediate(tick) in start() therefore finds nothing due, and the midnight run that was missed during downtime is silently skipped despite the comment 'Run once immediately so jobs that were due during downtime fire.'
- *Fix:* On initialize, compare the persisted lastRunAt and the cron schedule to detect a missed slot (e.g. if nextRun computed from lastRunAt is <= now, fire once on the immediate tick), or set nextRunAt based on lastRunAt rather than recomputing purely from now.

### B41 · `gateway/src/services/dialogue-auditor.ts:113` · CONFIRMED

**parseDialogueParagraph quoteRe `^["“]([^"”]*)["”](.*)$` excludes the closing curly-quote char from the captured group but NOT a straight quote inside, so dialogue containing an inner straight double-quote or the captured class mismatch truncates the spoken text at the first inner quote-like char.**

- *Scenario:* A line like `"He said \"no\" to me," Alice replied.` The character class `[^"”]` stops at the first inner straight quote, so dialogueText becomes `He said ` and the remainder parsing (and thus speaker attribution) operates on the wrong tail, mis-detecting the tag/speaker.
- *Fix:* Match to the LAST closing quote (greedy) or handle nested quotes; at minimum align the opening/closing quote classes so straight-quoted dialogue with inner quotes isn't truncated.

### B42 · `gateway/src/services/disclosures.ts:192` · CONFIRMED

**Word-splitting a platform name on /[\s/]/ produces empty-string tokens, and lower.includes('') is always true, so rules whose platform contains a slash (e.g. 'Spotify / Findaway') match every platform.**

- *Scenario:* Any disclosure check that includes the 'ai_narration' scope (e.g. launch-orchestrator narration step for platform 'Amazon KDP') calls getRequirements('Amazon KDP', ['ai_narration']). The rule with platform 'Spotify / Findaway' splits to ['spotify','','','findaway']; the empty token causes lower.includes('') === true, so the Spotify/Findaway requirement is pulled into the requirement set for an unrelated platform and shown (wrong text/source) in the confirmation card.
- *Fix:* Filter out empty tokens after splitting: r.platform.toLowerCase().split(/[\s/]/).filter(Boolean).some(w => lower.includes(w)). Optionally require word-boundary matching to avoid the 'us' substring over-match noted below.

### B43 · `gateway/src/services/manuscript-hub.ts:146` · CONFIRMED

**chaptersWritten can exceed chapterTarget (which is then 0), yielding nonsensical progress when writing steps lack a 'write chapter' label.**

- *Scenario:* A project's writing steps are labeled e.g. 'Draft chapter' / phase==='writing' but none match /write chapter/i. Then chaptersWritten falls back to writingSteps.length (e.g. 10) while chapterTarget = steps matching /write chapter/i = 0. The dashboard sees chaptersWritten=10, chapterTarget=0 (a divide-by-zero / >100% completion signal).
- *Fix:* Derive both chaptersWritten and chapterTarget from the same predicate (the writing-phase steps), or guard the consumer against chapterTarget===0; don't fall back chaptersWritten to writingSteps.length while leaving chapterTarget anchored to the 'write chapter' label.

### B44 · `gateway/src/services/memory.ts:218` · CONFIRMED

**reset() does not clear the active persona, leaving stale per-persona tagging applied to all post-reset conversation turns.**

- *Scenario:* User sets an active persona, then calls reset() (settings.routes.ts → memory.reset). reset clears conversations, summaries, and activeProjectPath but never touches activePersonaId or deletes active-persona.txt. Every subsequent turn logged by process() is still tagged with the old personaId, so a 'clean slate' continues writing memory under the previous pen name and on restart the stale persona reloads from active-persona.txt.
- *Fix:* In reset(), set this.activePersonaId = null and rm the active-persona.txt file (guarded by existsSync), mirroring the active-project handling.

### B45 · `gateway/src/services/plot-promises.ts:335` · PLAUSIBLE

**addPromise spreads `...input` after setting touchedAtChapters, but uses `input.introducedAtChapter` which is a number that may be 0 — falsy-zero makes touchedAtChapters empty for a legitimately chapter-0 promise.**

- *Scenario:* Caller adds a promise with introducedAtChapter: 0 (prologue indexed as 0). `input.introducedAtChapter ? [0] : []` evaluates 0 as falsy, so touchedAtChapters becomes [] instead of [0]. Downstream audit/payoff tracking loses the introduction chapter for any 0-indexed opening.
- *Fix:* Use `typeof input.introducedAtChapter === 'number' ? [input.introducedAtChapter] : []`.

### B46 · `gateway/src/services/plot-promises.ts:490` · CONFIRMED

**normalizeCategory checks `allowed.includes(value)` where value is unvalidated AI output of type any; a non-string (object/number) silently falls to 'other', fine, but a valid category string with different casing (e.g. 'Mystery') is rejected and downgraded to 'other'.**

- *Scenario:* The extraction LLM returns category 'Romance' or 'MYSTERY' (capitalized, very common from LLMs). `['mystery',...].includes('Romance')` is false → category becomes 'other', losing the real categorization for most extracted promises.
- *Fix:* Lowercase/trim value before the includes check: `const v = String(value||'').toLowerCase().trim(); return allowed.includes(v as PromiseCategory) ? ... : 'other'`.

### B47 · `gateway/src/services/projects.ts:834` · CONFIRMED

**completeStep mutates next.prompt in place by prepending an enrich prefix; re-running a step (retry → complete again) prepends the prefix cumulatively.**

- *Scenario:* Complete step N (its prompt gets the '[Build on the work from ...]' prefix written back into next.prompt). Later retryStep() resets a downstream step to pending but does not restore its original prompt. If that step is advanced-to again via completeStep, enrichWithPriorResults runs once more and prepends a second '[Build on the work...]' header, accumulating stale prefixes across retries.
- *Fix:* Don't persist the enriched prompt back onto the step; compute the enriched prompt as a transient value returned to the caller, or guard against re-prefixing by checking for an existing marker before prepending.

### B48 · `gateway/src/services/research.ts:84` · CONFIRMED

**SSRF IPv6 prefix check misclassifies ordinary DNS hostnames that begin with 'fc'/'fd'/'fe8'-'feb' as private IPv6 literals and blocks them.**

- *Scenario:* A user allowlists a normal domain such as 'fda.gov' (starts with 'fd'), 'fcbarcelona.com' ('fc'), or 'feb.org'; isPrivateIpLiteral('fda.gov') hits host.startsWith('fd') and returns true, so isAllowed() returns false and every research fetch/search result for that domain is silently blocked even though it is allowlisted.
- *Fix:* Only apply the fc/fd/fe8-feb ULA/link-local checks to actual IPv6 literals (e.g. require host.includes(':') before testing these prefixes), not to arbitrary hostnames.

### B49 · `gateway/src/services/series-bible.ts:455` · CONFIRMED

**mergeEntity reads `value.toLowerCase()` on attribute values from incoming.attributes without verifying value is a string, throwing if an attribute value is a number/null after JSON load.**

- *Scenario:* An entity's attributes loaded from a project context contains a non-string value (e.g. age stored as a number, or null from a malformed context file). `value.toLowerCase().trim()` at line 455 throws TypeError, aborting buildReport for the whole series mid-merge.
- *Fix:* Coerce: `const v = String(value ?? ''); ` and compare with that, or skip non-string attribute values.

### B50 · `gateway/src/services/soul.ts:186` · PLAUSIBLE

**updateVoiceProfile writes VOICE-PROFILE.md into voiceDir/soulDir but, after a composeForBook/stateless run, soulDir may still point at a book's read-only Author snapshot, writing the learned voice to the wrong (or snapshot) location.**

- *Scenario:* useBook() repoints soulDir to workspace/books/<slug>/templates/author (a per-book snapshot). If the voice-analysis hook later calls updateVoiceProfile, it writes VOICE-PROFILE.md into that book's snapshot dir rather than the user's library/global voice, so the learned profile is scoped to one book's frozen template and lost on the next book switch (or fails if the snapshot is treated as read-only).
- *Fix:* Write voice updates to the canonical library/global voice dir (or the resolved per-book voiceDir intentionally), not whatever soulDir currently points at.

### B51 · `gateway/src/services/story-structures.ts:350` · CONFIRMED

**Genre matching uses substring containment in both directions, so an empty/short genre string causes spurious matches and a 1-2 char genre matches almost everything.**

- *Scenario:* If input.subgenre is '' (empty) but provided, `subgenreLower.includes(g.toLowerCase())` is false but `g.toLowerCase().includes(subgenreLower)` is `g.includes('')` which is ALWAYS true. So every structure gets a +0.6 genre match for any project where subgenre is the empty string, making recommend() return arbitrary structures with high fitScore.
- *Fix:* Guard the bidirectional includes with a minimum length, e.g. only test `g.includes(subgenreLower)` when subgenreLower.length >= 3, and skip empty strings entirely.

### B52 · `gateway/src/services/story-structures.ts:359` · PLAUSIBLE

**The 'works less well for' penalty only checks genre/subgenre against the penalty list but the genre-match boost also checks the penalty entries via substring, so a genre can get both +0.6 and never the -0.4, or vice versa inconsistently; also empty subgenre triggers false penalty.**

- *Scenario:* Same empty-subgenre issue as the boost: `subgenreLower.includes(g.toLowerCase())` with subgenreLower='' is false, but here only one direction is used so empty subgenre is safe. However a genre like 'romance' that appears in recommendedFor of one structure and worksLessWellFor of another is fine. The concrete bug is narrower: when subgenre is empty string the boost path (line 351) over-fires; this penalty path does not — leaving net scores skewed positive for empty subgenre.
- *Fix:* Treat empty-string genre/subgenre as absent across all matching logic (already partially done with trim, but '' still passes the truthy descLower-independent includes on the boost side).

### B53 · `gateway/src/services/track-changes.ts:192` · CONFIRMED

**applyDecisions advances insIdx/delIdx for every <w:ins>/<w:del> block, but parseDocx skips blocks with empty extracted text, so occurrence indices (and thus change-id lookups) desync when an empty change block is present.**

- *Scenario:* A paragraph contains a <w:ins> wrapping only a paragraph-mark/formatting run with no <w:t> text (common in Word) followed by a real text insert. parseDocx skips the empty one (`if (!insertedText) continue`), so report.changes has only the text insert at occurrence 0; but applyDecisions' replace callback hits the empty block first (insIdx 0) and maps it to the real change, then the real block (insIdx 1) maps to occurrence 1 which findChangeIndex returns -1 for. The user's accept/reject decision is applied to the wrong block or lost.
- *Fix:* In applyDecisions, skip empty change blocks the same way parseDocx does (only increment insIdx/delIdx when the inner has extractable text), or key decisions by a position-independent id instead of an occurrence counter.

### B54 · `gateway/src/services/transfer-security.ts:34` · CONFIRMED

**Zip-bomb budget is checked only against central-directory declared sizes, which an attacker controls and can understate, so getData() can still inflate far beyond MAX_ENTRY_BYTES.**

- *Scenario:* A crafted zip declares header.size=0 (or a small value) for an entry whose compressed stream actually inflates to hundreds of MB. checkZipBudget passes (declared total under 100MB), then writeFileSync(dest, e.getData()) inflates the real payload into memory and onto disk, defeating the disk-exhaustion guard.
- *Fix:* After inflation, also enforce per-entry and running-total byte limits on the actual e.getData().length (or stream-limit), not just the declared header.size, before/while writing each entry.

### B55 · `gateway/src/services/tts.ts:237` · CONFIRMED

**Voice-fingerprint detection overrides the user's configured provider, so a global ElevenLabs setting is silently ignored when the active voice is an Edge-style ID.**

- *Scenario:* User runs setProvider('elevenlabs') but the resolved voice is the default/preset Edge voice 'en-US-AriaNeural'. In generate(), provider = options.provider || detectProviderForVoice(voice) || configuredProvider. detectProviderForVoice returns 'edge' for that pattern, so the code calls generateEdge and never honors the configured ElevenLabs provider. The configuredProvider fallback is dead because detectProviderForVoice always returns a non-empty string.
- *Fix:* Consult the configured provider before fingerprint detection, e.g. `const provider = options.provider || this.configuredProvider || this.detectProviderForVoice(voice);` (or only fall back to detection when configuredProvider is unset).

### B56 · `gateway/src/services/user-model.ts:221` · CONFIRMED

**preferredHourOfDay and preferredDayOfWeek are computed from ALL observations, not from session_start events as the field documentation states, producing a misleading 'peak hour'.**

- *Scenario:* A user fires many message_sent / words_written observations clustered at, say, 14:00 UTC but actually starts sessions in the morning. computeMetrics increments hourCounts/dowCounts for every observation regardless of type (lines 217-224), so preferredHourOfDay reflects message volume, not session-start time. The snapshot field comment (line 73) and the injected context line 'peak hour ~H:00 UTC' (buildContext) then assert a wrong working rhythm to the model.
- *Fix:* Only count the hour/day buckets when o.type === 'session_start' (or rename the field to reflect overall-activity mode if that is the intended semantic).

### B57 · `gateway/src/services/website-builder.ts:372` · CONFIRMED

**shell() decides root-relative vs ../ asset paths from pageTitle string equality, so a book or blog post literally titled 'Books', 'About', 'Home', or 'Contact' gets root-relative styles.css/feed.xml and loses its stylesheet.**

- *Scenario:* Create a book whose title is 'About' (or a blog post titled 'Books'). Its page is written to book/about.html (or blog/books.html) but shell() matches pageTitle==='About' and emits href="styles.css" instead of "../styles.css", so book/about.html requests book/styles.css (404) and renders unstyled with a dead RSS link.
- *Fix:* Do not infer directory depth from the human-facing page title. Pass an explicit assetPrefix ('' for top-level pages, '../' for book/ and blog/ pages) from each page builder into shell().

### B58 · `gateway/src/services/website-sites.ts:145` · CONFIRMED

**update() blindly Object.assigns the patch, so a caller can overwrite lastRenderedAt/pendingChanges/books/blogPosts (or null them), and it always bumps pendingChanges even for no-op or render-state patches.**

- *Scenario:* A route calls update(siteId, { lastRenderedAt: someValue }) or update with a stale full PersistedSite-shaped body; Object.assign clobbers server-managed fields and then unconditionally increments pendingChanges, desyncing the 'site is X behind' freshness indicator (e.g. marking a freshly rendered site as having pending changes).
- *Fix:* Whitelist the patchable fields (config, linkedProjectIds, aboutHTML, contactHTML, deploy) explicitly instead of Object.assign over an open Partial, and don't auto-increment pendingChanges for patches that don't change rendered content.

### B59 · `gateway/src/services/writing-judge.ts:495` · CONFIRMED

**overall is computed from clamped dimension scores, but topIssues sorting uses the RAW unclamped d.score, so an out-of-range score (e.g. 0 or 50) sorts dimensions incorrectly for the 'top issues' selection.**

- *Scenario:* If the LLM returns a dimension with score 0 or a 50, the overall average clamps it to 1-10, but `[...dims].sort((a,b)=>a.score-b.score)` at line 497-498 sorts on the raw score. A dimension scored 50 (meant as a mistake) would sort as 'highest' and be excluded from top issues even though after clamping it is a 10; conversely a 0 sorts as lowest and is surfaced as a top issue with `[name 0/10]` text that contradicts the clamped dimension list. Minor display/selection inconsistency.
- *Fix:* Sort and label topIssues using the clamped score (Math.max(1,Math.min(10,d.score))) consistent with `overall` and the returned dimensions.

### B60 · `gateway/src/skills/loader.ts:211` · CONFIRMED

**An empty trigger string makes a skill match every input, flooding prompts with that skill's content.**

- *Scenario:* A SKILL.md frontmatter contains a blank list item under triggers (e.g. `- ""` or `- `), so parseSkill pushes an empty-string trigger; in matchSkills, lower.includes('') is always true, so that skill's full content is injected into every single message/step prompt regardless of relevance.
- *Fix:* In parseSkill, skip empty values (`if (!value) continue;`) when pushing triggers, or in matchSkills ignore triggers whose trimmed length is 0.

## Low (35)

### B61 · `frontend/studio/src/components/asset/SkillEditor.tsx:61` · CONFIRMED

**contentValid frontmatter regex requires LF after the opening '---', so a SKILL.md with CRLF line endings is rejected as invalid and the user cannot save.**

- *Scenario:* A user pastes or edits SKILL.md content with Windows CRLF line endings. The regex /^---\n[\s\S]*?\n---/ does not match '---\r\n...', so contentValid is false, the warning banner shows, and the Save button stays disabled even though the frontmatter is structurally valid.
- *Fix:* Allow optional \r in the anchors, e.g. /^---\r?\n[\s\S]*?\n---/ (and similarly for the closing fence).

### B62 · `frontend/studio/src/components/write/PipelineRail.tsx:200` · PLAUSIBLE

**planStepStatus/matchedProjectStep rely on ?? binding tighter than ?:, so the index fallback (projectSteps[i]) only applies in the label branch, never when a step has an id that fails to match.**

- *Scenario:* For a static pipeline step that carries an id which has no matching project step yet (e.g. ids assigned differently between template and project), the id branch returns undefined with no index fallback, so the step is shown as 'queued' even when projectSteps[i] is the active step. The comment ('then fall back to index') implies index fallback is intended for the id case too.
- *Fix:* If index fallback is intended for the id branch, restructure with explicit parentheses/variables: compute byId then `?? (byLabel ?? projectSteps[i])`.

### B63 · `frontend/studio/src/routes/Activity.tsx:8` · PLAUSIBLE

**category() classifies any entry with a numeric metadata.cost as 'Cost' before the type switch, so an error/step entry that carries a cost is mislabeled and filtered out of its real category.**

- *Scenario:* An entry of type 'error' (or 'step_failed') that also has metadata.cost set as a number is returned as { label: 'Cost' }. Under the 'Production' or 'System' filter it disappears, and it never shows the 'Error' category styling — the cost check short-circuits the type-based classification.
- *Fix:* Move the metadata.cost shortcut after (or fold into) the type switch, or only apply it for non-error types.

### B64 · `frontend/studio/src/routes/Series.tsx:111` · PLAUSIBLE

**pull()/finalizePull() interpolate the book slug into the URL path without encodeURIComponent, unlike every other slug-in-path call in the codebase.**

- *Scenario:* api(`/api/series/${sel.id}/pull/${slug}`) is called with a raw slug. Slugs are normally hyphen-safe, but this is the only call site that omits encoding (compare Files.tsx, PromptRunner.tsx, BookDrawer.tsx, DeleteBooksModal.tsx which all encode); a slug containing a reserved character (e.g. from a future slug scheme or imported book) would build a malformed path and hit the wrong/no route.
- *Fix:* Wrap the slug in encodeURIComponent(slug) in both pull() and finalizePull() to match the rest of the codebase.

### B65 · `frontend/studio/src/routes/Write.tsx:49` · PLAUSIBLE

**Code comment claims panes are revealed only when the resolved active book matches the target slug, but setReady(true) runs unconditionally after the fetch — the guard described in the comment is not implemented.**

- *Scenario:* When deep-linking /write/:slug, activation is awaited but ready is set true regardless of whether the fetched active book actually matches paramSlug; if loadBooks() resolved the active pointer to a different book (e.g. concurrent activation race), the panes render with a slug/active mismatch instead of staying in the Loading state the comment promises.
- *Fix:* Either implement the documented guard (only setReady(true) when the resolved active.slug === paramSlug) or remove the misleading comment; given panes resolve book data from slug, tightening the guard is the safer fix.

### B66 · `gateway/src/ai/router.ts:340` · CONFIRMED

**selectProvider's Ollama 'came online' branch only warns and never re-checks availability, so a preferred-Ollama that started after boot still falls through to tier routing.**

- *Scenario:* User sets Ollama as preferred provider but Ollama wasn't running at init. Later Ollama starts. selectProvider sees `!pref` (not in map), logs the 'will be checked on next reinitialize' warning, and silently uses tier routing — the comment promises a re-check that never happens, so the user's explicit preference is ignored until a manual reinitialize.
- *Fix:* Either trigger reinitialize/checkOllama here, or update the misleading comment; functionally, the preference is silently dropped.

### B67 · `gateway/src/ai/router.ts:720` · PLAUSIBLE

**The OpenAI reasoning-model regex matches gpt-4o-style names via the o-series alternation edge and can mis-send reasoning_effort, or miss valid models.**

- *Scenario:* `/^(o[1-9]|o\d+|gpt-5|gpt-5\.\d+)/i` — `o\d+` already covers `o[1-9]`, and it will also match a hypothetical `o0-...`; more importantly models like `gpt-5-mini` match (fine) but `gpt-4.1`/`o4-mini` ordering is fine, yet `gpt-5` with a suffix like `gpt-5o`? The real defect: `gpt-4o` does NOT match (correct), but `o1-pro`/`o3` match correctly. Low-risk; the main hazard is future OpenAI naming (e.g. a non-reasoning `gpt-5-chat-latest` would wrongly get reasoning_effort and drop max_tokens, potentially erroring).
- *Fix:* Tighten to an explicit allowlist of reasoning model prefixes, or confirm the gpt-5* assumption holds for chat variants before stripping max_tokens.

### B68 · `gateway/src/api/routes/backups.routes.ts:58` · PLAUSIBLE

**An empty cloud.destinations array passes validation, so cloud.enabled=true can be persisted with no destinations and without the confirmation gate.**

- *Scenario:* PUT /api/backups/config with { cloud: { enabled: true, destinations: [] } } — the `.some()` check passes for an empty array, newDests is empty so no confirmation is created, and persist() writes cloud.enabled=true with zero destinations. Harmless functionally (nothing to upload) but bypasses the documented 'enabling cloud upload is gated' invariant and leaves an inconsistent config.
- *Fix:* When cfg.cloud.enabled is true, require at least one destination or a hook: reject if destinations.length === 0 && !hook.

### B69 · `gateway/src/api/routes/books.routes.ts:145` · CONFIRMED

**serveFile is invoked with `void`, discarding its promise; a read-stream error after the existsSync check is unhandled.**

- *Scenario:* GET /api/books/:slug/files/:filename for a file that passes existsSync but then fails to open or errors mid-stream (deleted/permission race). serveFile awaits the dynamic imports and returns a promise that `void` discards; if createReadStream emits 'error' after headers, there is no 'error' listener, producing an unhandled stream error and a half-written/hung response.
- *Fix:* Attach an error handler to the stream inside serveFile (e.g. stream.on('error', () => res.destroy())), and/or `.catch()` the serveFile promise at the call site.

### B70 · `gateway/src/api/routes/media.routes.ts:350` · CONFIRMED

**POST /api/audio/config stores a preset name as the active voice without resolving it to a voice ID, unlike POST /api/audio/voice.**

- *Scenario:* POST /api/audio/config { voice: 'narrator_deep' } calls setVoice('narrator_deep') which persists the literal preset name; getActiveVoice() then reports 'narrator_deep' to the dashboard instead of the resolved Edge voice id (generation still works because generate() re-resolves, but the displayed/persisted active voice is inconsistent with the /api/audio/voice path which calls resolveVoice first).
- *Fix:* Resolve before saving: `if (voice) await services.tts.setVoice(services.tts.resolveVoice(voice));` to match the /api/audio/voice handler.

### B71 · `gateway/src/api/routes/wave.routes.ts:29` · PLAUSIBLE

**Goal creation rejects a legitimate target of 0 because the guard treats falsy-zero as missing.**

- *Scenario:* POST /api/goals with { target: 0, ... } (e.g. a 'zero missed days' streak goal) fails the `!target` check and returns 400 'target required' even though 0 was supplied.
- *Fix:* Validate type instead of truthiness for numeric fields: `if (typeof target !== 'number')` rather than `!target`.

### B72 · `gateway/src/api/routes/wave.routes.ts:197` · PLAUSIBLE

**audiobook/attribute treats chapterNumber 0 as 'no filter', returning all chapters.**

- *Scenario:* POST /api/projects/:id/audiobook/attribute with { chapterNumber: 0 } hits `const filtered = targetCh ? chapters.filter(...) : chapters` — 0 is falsy, so instead of attributing only chapter 0 it attributes the entire manuscript. Only an issue if any pipeline ever uses a 0-based chapter number.
- *Fix:* Test for presence/type explicitly: `const filtered = typeof targetCh === 'number' ? chapters.filter(c => c.number === targetCh) : chapters;`

### B73 · `gateway/src/bridges/telegram.ts:165` · CONFIRMED

**/novel's autoRunProject is fire-and-forget with no .catch(), so a rejection becomes an unhandled promise rejection (unlike /write and /project which attach .catch).**

- *Scenario:* User runs `/novel ...`; autoRunProject rejects (e.g. provider error mid-pipeline). Because no `.catch()` is attached (line 165-167), the rejection is unhandled — the user never sees the error message and Node logs an UnhandledPromiseRejection, whereas the /write and /project paths handle this.
- *Fix:* Attach a `.catch(async (e) => { await this.sendMessage(chatId, `❌ Error: ${String(e)}`); })` to the autoRunProject call, matching the /write and /project handlers.

### B74 · `gateway/src/bridges/telegram.ts:595` · PLAUSIBLE

**wordCount caption uses split(/\s+/).length which over-counts by one when text has leading whitespace and is misleading for file-derived text.**

- *Scenario:* When /speak reads a file whose content starts with whitespace/newline, `speakText.split(/\s+/)` yields a leading empty string, inflating the reported word count by one in the voice caption.
- *Fix:* Use `speakText.trim().split(/\s+/).filter(Boolean).length` for an accurate count.

### B75 · `gateway/src/init/phase-11-http.ts:41` · CONFIRMED

**Phase-11 strips non-digits from BOOKCLAW_CHAT_PORT while phase-12 uses Number(), so a value like '8080x' injects a working chat link in the studio while the chat server is actually disabled.**

- *Scenario:* BOOKCLAW_CHAT_PORT='8080x'. Phase-12 (line 11) does Number('8080x')=NaN → falsy → chat server disabled. Phase-11 (line 41) does replace(/\D/g,'') → '8080' → injects __BOOKCLAW_CHAT_PORT_VALUE__='8080', so the studio shows and links a Chat button pointing at a port nothing is listening on.
- *Fix:* Use the same coercion in both phases: compute the port once with Number() and only inject it when phase-12 actually started the chat server (e.g. derive chatPort in phase-11 from the same validated value, treating non-numeric as empty).

### B76 · `gateway/src/init/phase-11-http.ts:47` · CONFIRMED

**A user-supplied BOOKCLAW_AUTH_TOKEN is injected unescaped into the served HTML/JS, so a token containing a quote or </script> breaks or escapes the script context.**

- *Scenario:* An operator sets BOOKCLAW_AUTH_TOKEN to a value containing a single quote, backslash, or the substring </script>. serveDashboard does replaceAll('__BOOKCLAW_AUTH_TOKEN__', token) directly into the single-quoted JS string in index.html, breaking the token-bridge script (dashboard fails to authenticate) — and with </script> could inject markup. Auto-generated tokens are hex and safe; only manual tokens trigger this. Same pattern exists in phase-12-chat-http.ts:70.
- *Fix:* JSON.stringify the token (or restrict/validate to URL-safe chars) before injecting, mirroring the digits-only sanitization already applied to chatPort on the adjacent line.

### B77 · `gateway/src/security/audit.ts:54` · PLAUSIBLE

**Hash-chained audit log writes are fire-and-forget at most call sites and appendFile is not serialized, so concurrent log() calls can append lines to the JSONL file in an order that does not match the previousHash chain, breaking chain verification.**

- *Scenario:* Two near-simultaneous unawaited this.audit.log(...) calls (e.g. websocket connect + message received in index.ts) each synchronously capture previousHash and update lastHash, then race on appendFile; the OS may write line B before line A, so a verifier walking previousHash links sees the lines out of order.
- *Fix:* Serialize writes through a promise queue (chain each log() onto a private this.writeChain = this.writeChain.then(() => appendFile(...))) so both lastHash mutation and the append happen atomically per entry.

### B78 · `gateway/src/security/sandbox.ts:47` · CONFIRMED

**The /node_modules/ forbidden pattern is tested against the resolved absolute path, so if the workspace root itself lives under a node_modules path every valid path is rejected.**

- *Scenario:* If BookClaw is run with a workspaceRoot that contains 'node_modules' anywhere in its absolute path (e.g. a vendored/checked-out deployment), validatePath() rejects all otherwise-legal in-workspace paths with 'matches forbidden pattern'.
- *Fix:* Test the forbidden patterns only against the relative path (rel) or the untrusted targetPath, not against the fully-resolved absolute path that includes the workspace root prefix.

### B79 · `gateway/src/services/book.ts:338` · CONFIRMED

**migrateBookToV2 marks a v1 book as v2 with pipelineSequence=['pipeline'] even when templates/pipeline.json is absent, leaving the book pointing at a nonexistent pipeline snapshot.**

- *Scenario:* A v1 book directory without templates/pipeline.json (malformed/partial) is opened; the existsSync(legacy) block is skipped so no templates/pipeline/<name>.json is written, but manifest.pipelineSequence is still set to ['pipeline'] and schemaVersion bumped to 2. Subsequent pipelineOf()/snapshotPipelineOf() return null and the book has no usable pipeline.
- *Fix:* Only set pipelineSequence/bump schemaVersion when a legacy pipeline.json was actually found and migrated; otherwise leave the book unmigrated (or skip claiming a 'pipeline' sequence entry).

### B80 · `gateway/src/services/bookbub-submitter.ts:141` · CONFIRMED

**summarizeDealHistory uses a fixed 30-day month and Math.floor, so a recent prior deal can compute monthsSince that under-reports the cooldown gap, and a future-dated deal yields a negative month count in the warning.**

- *Scenario:* A prior deal dated 5 months ago at ~150 days yields monthsSince=5 (fine), but a deal ~35 days ago gives monthsSince=1 and the warning text reads 'only 1 months ago'; a mistakenly future-dated entry yields a negative number like 'only -2 months ago'. Edge-case correctness/wording only.
- *Fix:* Guard against negative diffs (Math.max(0, ...)) and consider rounding rather than floor; pluralize the warning. Optionally use a real month diff.

### B81 · `gateway/src/services/context-engine.ts:563` · PLAUSIBLE

**getRelevantContext addPart drops a whole section when it exceeds remaining budget instead of including higher-priority truncation, so a long previous-chapter summary suppresses ALL lower-priority context.**

- *Scenario:* The previous-chapter summary block is larger than maxChars: addPart returns false, parts stays empty, and because charBudget was never decremented, later sections may still fit but the most important (previous chapter) context is silently omitted entirely — the writing step gets a thin or empty context with no indication the key block was dropped.
- *Fix:* Truncate the previous-chapter block to fit the budget rather than dropping it wholesale, or reserve budget for priority-1 first.

### B82 · `gateway/src/services/costs.ts:119` · PLAUSIBLE

**getStatus rounds daily/monthly spend to 2 decimals, which floors sub-cent free/cheap-model spend to 0.00 in the dashboard even though the comment notes this exact failure mode for the lifetime/per-book figures.**

- *Scenario:* A day of only Ollama/Gemini/DeepSeek calls accumulates e.g. $0.0007 daily; getStatus returns daily: 0, so the dashboard daily line shows $0.00 while total/byBook (4dp) show the real amount — an inconsistent display, and the near/over-budget gauge appears empty.
- *Fix:* If sub-cent visibility on the daily/monthly lines is desired, round to 1e4 like total/byBook; otherwise document that daily/monthly are intentionally cent-resolution (currently the comment only justifies the 4dp fields).

### B83 · `gateway/src/services/craft-critic.ts:427` · PLAUSIBLE

**classifyStoryShape 'classic' branch requires midAvg below BOTH first and last, but uses firstAvg*0.9 and lastAvg*0.9; a genuinely classic dip that is, say, 0.88x of first but 0.95x of last is misclassified as 'flat'.**

- *Scenario:* Edge-case classification only; produces a 'flat' label when 'classic' is more accurate. No crash, cosmetic report field.
- *Fix:* If intended, relax thresholds; otherwise acceptable. Low severity.

### B84 · `gateway/src/services/cron-scheduler.ts:270` · CONFIRMED

**runNow executes a job but never updates lastRunAt/runCount/nextRunAt or persists, so a manually-run job's recorded state diverges from reality.**

- *Scenario:* User clicks 'Run now' in the dashboard. executeJob updates lastRunStatus/lastRunMessage on the in-memory job but runNow does not call recomputeNextRun, increment runCount, set lastRunAt, or schedulePersist. After a restart the partial status is lost, and runCount/lastRunAt never reflect the manual run.
- *Fix:* After executeJob in runNow, set job.lastRunAt = now, job.runCount++, call recomputeNextRun(job) and schedulePersist(), mirroring the tick() finally block.

### B85 · `gateway/src/services/epub-export.ts:71` · CONFIRMED

**dc:language is interpolated into the OPF without XML escaping.**

- *Scenario:* A caller passes a language string from user/project metadata containing '<', '>' or '&' (e.g. a malformed locale). The resulting content.opf is invalid XML and the EPUB fails validation/opening. Low because language is usually a safe code, but it is the one metadata field not run through escapeXml.
- *Fix:* Wrap with escapeXml(language) like the other dc:* fields.

### B86 · `gateway/src/services/goals.ts:231` · CONFIRMED

**pace is computed against full cumulative current with daysElapsed floored to a 1-day minimum, so a goal that just started reports an inflated 'on track' pace.**

- *Scenario:* A word_count goal is created and immediately auto-advanced with a large existing manuscript count (e.g. projectIds already at 40,000 words). daysElapsed = max(1, floor(~0)) = 1, so pace = 40000/day, projectedCompletion lands far before the deadline, atRisk is false, and computeProgress reports a wildly optimistic '40,000 words/day, on track' on day zero.
- *Fix:* Base pace on progress accrued since start (e.g. current minus the first history snapshot value) rather than total cumulative current, or guard the first-day case.

### B87 · `gateway/src/services/heartbeat.ts:712` · CONFIRMED

**getStats/getContext divide by dailyWordGoal without the >0 guard used elsewhere, yielding 100% when the goal is 0.**

- *Scenario:* A user sets heartbeat.dailyWordGoal to 0 in config (the `?? 1000` default only fires for null/undefined, not 0). getStats computes Math.min(100, Math.round((todayWords/0)*100)) = Math.min(100, Infinity) = 100, so the dashboard shows '100%' goal progress with a zero goal, which is misleading.
- *Fix:* Guard the division as checkReminders already does: `dailyWordGoal > 0 ? Math.round(...) : 0` in both getStats (line 712) and getContext (line 733).

### B88 · `gateway/src/services/image-gen.ts:313` · CONFIRMED

**Cover-set cost estimate is keyed on the requested variant dimensions even when the active provider is Gemini/Together (which don't bill the gpt-image-1 size table), overstating cost for non-OpenAI runs.**

- *Scenario:* User runs generateCoverSet with provider:'gemini' (free tier). Every successful variant still adds costMap[sizeKey] (0.17–0.25) * qualityMult to estimatedCost, reporting a dollar cost for a free generation.
- *Fix:* Only accumulate estimatedCost when result.provider === 'openai' (the cost table is gpt-image-1 specific); zero it for gemini/together.

### B89 · `gateway/src/services/memory.ts:47` · PLAUSIBLE

**activeProjectPath loaded from active-project.txt on init is used to build a filesystem path in getRelevant/getActiveProject without the sanitizeSegment guard that setActiveProject applies.**

- *Scenario:* setActiveProject sanitizes the id before persisting, but initialize() reads active-project.txt with only .trim() (line 47). If that file is ever written with a traversal value (corruption, manual edit, or a future code path that writes it unsanitized), getRelevant joins it into book-bible/<value> and reads files outside the intended dir under workspace/.
- *Fix:* Run the loaded value through this.sanitizeSegment(...) in initialize() before assigning to activeProjectPath.

### B90 · `gateway/src/services/release-calendar.ts:60` · PLAUSIBLE

**The `...input` spread after the default can overwrite `status` with `undefined`.**

- *Scenario:* createEvent is typed to accept an optional `status`. If a caller passes an object that explicitly contains `status: undefined` (e.g. spreading a partial event), the line `status: input.status ?? 'upcoming'` computes 'upcoming' but the subsequent `...input` re-copies `status: undefined`, leaving the event with an undefined status that then serializes/sorts incorrectly and breaks the ICS STATUS field.
- *Fix:* Place `...input` first and the computed defaults (id, status) after it: `{ ...input, id: ..., status: input.status ?? 'upcoming' }`.

### B91 · `gateway/src/services/release-calendar.ts:119` · CONFIRMED

**buildPricePulsePlan generates four event IDs in a tight synchronous loop using Date.now(), risking duplicate IDs that collide in the events Map.**

- *Scenario:* All four price-pulse events are mapped in the same millisecond, so each id is `event-<sameMs>-<4 random chars>`. Two of the four can collide on the 4-char random suffix; if these are later inserted via createEvent/set, the second silently overwrites the first in the Map, dropping a scheduled price change.
- *Fix:* Use a per-item incrementing index or crypto.randomUUID() for the id suffix so all four are guaranteed unique.

### B92 · `gateway/src/services/research-lookup.ts:252` · CONFIRMED

**Citation extraction stops at the first blank line, truncating multi-paragraph Sources lists.**

- *Scenario:* The LLM returns a 'Sources:' section that contains a blank line (e.g. grouped or wrapped entries); the lazy `[\s\S]*?(?:\n\n|$)` regex stops at the first \n\n, so only the first paragraph of sources is parsed and later citations are dropped, leaving hasVerifiedSources understated.
- *Fix:* Capture to end-of-text rather than the first blank line (drop the \n\n terminator, or split the remaining text into lines and stop only at a non-list line).

### B93 · `gateway/src/services/series-bible.ts:447` · CONFIRMED

**mergeEntity alias merge calls `alias.toLowerCase()` assuming aliases are strings; a malformed context alias array with a non-string element throws.**

- *Scenario:* ctx.entities[i].aliases contains a non-string (e.g. null) from a corrupt or hand-edited context file; `a.toLowerCase()` or `alias.toLowerCase()` throws, aborting buildReport.
- *Fix:* Filter aliases to strings before the loop, or guard with typeof checks.

### B94 · `gateway/src/services/transfer-security.ts:20` · CONFIRMED

**EVENT_RE requires whitespace immediately before an event-handler attribute, so handlers separated by '/' (e.g. <a/onclick=) bypass the HTML/event-handler scan.**

- *Scenario:* A staged .md/.json file contains <a/onclick=alert(1)>. injection.scan doesn't flag it, HTML_RE matches only the start tag set (a is not in the list), and EVENT_RE /\son\w+\s*=/ fails because the char before 'on' is '/' not whitespace, so no html_payload finding is produced for a real event-handler injection.
- *Fix:* Broaden EVENT_RE to match an event handler preceded by whitespace or '/' (e.g. /[\s/]on\w+\s*=/i).

### B95 · `gateway/src/services/website-builder.ts:183` · CONFIRMED

**buildIndex treats books[0] as the 'Latest release' but build() never sorts input.books, so the featured book is whatever order the caller passed, not the newest.**

- *Scenario:* If books are supplied in title or insertion order other than newest-first (e.g. a caller that builds the array directly rather than via website-sites.autoAddBook's unshift), the home page features an arbitrary book under the 'Latest release' heading.
- *Fix:* Sort by releaseDate descending (with a fallback) when picking latestBook, or document/enforce that callers pass newest-first.

---

## Review round (post-fix) — 2026-06-19

After the surgical fix pass, an 8-angle code review of the fix diff surfaced **20 issues introduced or left incomplete by the automated fixers** (4 high, 7 medium, 9 low). All 20 were resolved by hand; the most common cause was a fixer over-correcting a false positive and regressing working behavior. Verification after the round: backend + frontend `tsc` clean, 410/410 unit tests, frontend build green, perimeter smoke all-pass.

### High (4)

- **R01 `gateway/src/services/goals.ts:231`** — Pace baseline uses history[0].value (first post-update snapshot), not the goal's starting value of 0
- **R02 `gateway/src/services/dialogue-auditor.ts:113`** — Quote-extraction regex changed from [^closequote]* to greedy .* with /s, so dialogueText now swallows narration/tags in split-dialogue paragraphs
- **R03 `gateway/src/services/tts.ts:237`** — Reordered provider precedence makes detectProviderForVoice() unreachable, so ElevenLabs voice IDs route to Edge
- **R04 `gateway/src/services/transfer-security.ts:38`** — checkZipBudget now fully inflates each entry via getData() before the per-entry size check, enabling a memory-exhaustion DoS from a decompression bomb

### Medium (7)

- **R05 `gateway/src/init/phase-12-chat-http.ts:70`** — Chat-app token injection not escaped, unlike the parallel phase-11 studio fix
- **R06 `gateway/src/services/launch-orchestrator.ts:264`** — proposeStep now throws for phase-only calls when the phase has multiple steps
- **R07 `gateway/src/services/context-engine.ts:189`** — AI-JSON parser now bounds JSON by first '{' and last '}', so trailing commentary containing a brace breaks parsing it previously recovered
- **R08 `gateway/src/services/cron-scheduler.ts:287`** — runNow() executes a job without the this.running guard, racing with tick() on the same job and mutating shared scheduling state concurrently
- **R09 `gateway/src/api/routes/knowledge.routes.ts:778`** — proposeStep now throws when a launch phase has multiple timeline steps and no stepId is supplied, breaking previously-working phase-only callers
- **R10 `gateway/src/services/memory.ts:179`** — Live-index line counting reads the entire day's conversation JSONL into memory on every store() call
- **R11 `gateway/src/services/cron-scheduler.ts:291`** — runNow() copy-pastes the tick() post-run bookkeeping (lastRunAt/runCount/recompute/persist) and omits the running-set guard

### Low (9)

- **R12 `gateway/src/services/research-lookup.ts:252`** — Citation block regex now extends to end-of-text, pulling trailing prose into bogus citations
- **R13 `gateway/src/routes/Write.tsx:50`** — Ready gate can hang the Write page forever if the post-activation loadBooks() fails
- **R14 `gateway/src/init/phase-11-http.ts:47`** — Dashboard auth-token escaper for single-quoted JS string covers \\ ' < but not newline/CR, so a token containing a line break corrupts the injected script
- **R15 `gateway/src/security/transfer-security.ts:96`** — Staged-text HTML/event scan only covers .md/.txt/.json (SCAN_EXTS); an HTML payload in an allowed non-scanned extension is not flagged
- **R16 `gateway/src/services/projects.ts:1291`** — enrichWithPriorResults guard plus completeStep persisting the enriched prompt can bake a stale 'Build on the work from "X"' reference into a re-advanced step
- **R17 `gateway/src/services/memory.ts:180`** — lineIndex is computed by re-reading and counting the JSONL file before append with no serialization, so concurrent process() calls can assign the same index and collide on the dedup key
- **R18 `gateway/src/bridges/telegram.ts:167`** — The new .catch on the fire-and-forget autoRunProject calls sendMessage, whose rejection inside the catch is itself unhandled
- **R19 `gateway/src/api/routes/documents.routes.ts:233`** — Inline filename sanitizer re-implements the existing SandboxGuard.sanitizeFilename helper
- **R20 `gateway/src/api/routes/projects.routes.ts:725`** — maxRetries '?? 1' → '|| 1' fixes the NaN case but now coerces an explicit 0 (disable retries) to 1
