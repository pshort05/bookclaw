# Phase 11 — Backup & Recovery (the release gate) — Design

**Date:** 2026-06-12
**Status:** Draft for owner approval
**Source design:** [BOOK-CONTAINER-ARCHITECTURE.md](../../BOOK-CONTAINER-ARCHITECTURE.md) § "Backup and recovery" (approved 2026-06-04). This spec turns that section into a buildable design; deviations from it are called out explicitly.

## Goal

Point-in-time recovery for the workspace: (1) **revert** to a last-saved version (whole workspace or a single book), and (2) get data **offsite** (Dropbox / GDrive / OneDrive / Box) without BookClaw holding cloud credentials. Default-ON local snapshots are the data-loss floor; cloud is opt-in. **This phase is the official release gate.**

## Non-goals (per the architecture doc)

- Incremental / deduplicated backups (rsync-delta, hardlink trees). Full mirror + keep-N only.
- Automatic cloud retention/pruning — **BookClaw never deletes remote data.**
- Restore *of* cloud zips through the app (the user downloads/unzips by hand; local snapshots are the in-app restore path).

## Components

### 1. `BackupService` (`gateway/src/services/backup.ts`) — new

Single service owning snapshot, prune, restore, cloud push, and triggers.

**Backup root resolution:** `process.env.BOOKCLAW_BACKUP_DIR` ?? config `backup.localPath` (default `~/bookclaw-backups`, `~` expanded against `os.homedir()`). Must resolve **outside** `workspace/` — refuse (loud `⚠`, service degraded-off) if the resolved root is inside the workspace, so backups are never themselves backed up. In Docker the root is a second host bind-mount (see § Docker).

**Snapshot (`snapshot(reason)`):**
- Name: `YYYY-MM-DDTHH-mm-ss` (filesystem-safe ISO, seconds precision; collision → zero-padded `-002` suffix so lexicographic order stays chronological). Matching regex `SNAPSHOT_RE` is the safety boundary for prune/list — nothing else in the backup root is ever touched.
- Format: **uncompressed mirror** under `<root>/<name>/`, copied with `fs.cpSync(..., { recursive, filter })`. Write to `<root>/.tmp-<name>/` then `renameSync` into place, so a crashed copy never looks like a valid snapshot.
- **Scope `standard` (default):** `books/`, `library/`, `.config/`, `soul/`, `memory/`, `documents/`, `projects/`, `.bookclaw/`.
  - *Deviation from the arch doc (flagged for owner approval):* the doc said "books + library + config". `soul/` (global author identity) and `memory/` (book bible, lessons, conversation history) are small, non-regenerable user data — losing them on a restore-from-scratch would be real data loss, so they are added to `standard`. The same non-regenerable rationale covers `documents/` (uploaded manuscripts), `projects/` (legacy/global project outputs), and `.bookclaw/` (workspace schema marker), added during code review.
- **Scope `full`:** the whole workspace (including `.vault/vault.enc` as an offsite copy — safe because `BOOKCLAW_VAULT_KEY` lives in `.env` *outside* the workspace, so no snapshot ever co-locates key + vault), minus live database files (`*.sqlite*`, `*.db` plus `-wal`/`-shm` sidecars — open-file partial-write hazard, regenerable) and `.tmp*`.
- **Standard-scope exclusions (by allowlist):** `.vault/`, `.audit/`, `audio/`, `images/`, the memory SQLite index — per the arch doc's defaults.
- **Restore never touches `.vault/` or `.audit/`** in either direction (never deleted, never overwritten) — credentials and the tamper-evident chain are not part of in-app point-in-time recovery; a full snapshot's vault copy is for manual disaster recovery only.
- A `snapshot.json` marker at the snapshot root records `{ name, at, reason, scope, appVersion, workspaceSchemaVersion }`.

**Prune:** after each successful snapshot, list `SNAPSHOT_RE`-matching dirs, sort by name (= by time), keep the newest `backup.local.keep` (default 10), `rmSync` the rest. Never touches non-matching paths.

**Restore (`restore(id, { book? })`):**
- Always **snapshots current state first** (`reason: "pre-restore"`); that snapshot participates in keep-N normally.
- **Per-book** (the common "revert this book" case): validate slug (`SLUG_RE`) + the snapshot contains `books/<slug>/book.json`; `rmSync` the live `workspace/books/<slug>/`, `cpSync` from the snapshot, then re-initialize `BookService` so in-memory state (active pointer, channel overrides) reconciles. A restored book passes through the existing `schemaVersion` gate on next read — a too-old manifest lands **read-only/quarantined**, never silently coerced (verify criterion).
- **Whole-workspace:** for each top-level entry present in the snapshot (per its recorded scope), remove the live counterpart and copy from the snapshot; hard exclusions are never deleted from the live tree (`.vault`, `.audit` survive any restore). Response carries `restartRecommended: true` — in-memory service state beyond `BookService` is not hot-reloaded.

**Cloud push (opt-in, fail-soft, runs after each local snapshot when `backup.cloud.enabled`):**
- Zip the new snapshot (AdmZip — already a dependency via `BookTransferService`) to `<root>/.tmp-<name>.zip`, then per destination:
  1. **Directory-drop** — destination is a path: copy the zip there (e.g. a host folder already synced by Dropbox; zero credentials in BookClaw).
  2. **rclone** — destination is `rclone:<remote>[:path]`: `spawn('rclone', ['copy', zip, remote])`. Absent binary → skip with `⚠` notice.
  3. **Post-backup hook** — optional `backup.cloud.hook` script spawned with the zip path as `argv[1]`, for any other "move my data" process.
- Each layer's failure is logged and does not block the others or the local snapshot. The local tmp zip is deleted after push (local retention is the mirror, not zips).
- **ConfirmationGate at setup:** the `PUT /api/backups/config` route gates any **newly added** cloud destination or hook through `ConfirmationGateService.createRequest` (`action: 'enable-backup-destination'`, `platform: 'cloud-backup'`, `isReversible: true` — the upload of data is not reversible but the setting is; `riskLevel: 'high'` since a destination can exfiltrate the workspace). The config write lands only on approval; scheduled pushes then run under that standing approval. Local snapshots are internal and not gated.

**Triggers:**
- **Scheduled:** in-process `setInterval` (`backup.intervalHours`, default 24) — container-portable, no host cron. On boot, if the newest snapshot is older than the interval (or none exists), run one shortly after startup.
- **On completion:** `projects.onProjectCompleted(...)` → snapshot, with a 10-minute min-interval guard so a burst of completions doesn't storm the disk.
- **Before destructive ops:** restore pre-snapshots itself (above). (The future schema-migration runner should call `snapshot('pre-migration')`; noted, not built here.)
- **Manual:** `POST /api/backups`.

**Posture logging (init):** enabled → `✓ Backup: ON (keep 10, every 24h, root <path>)`. `backup.enabled: false` → loud `⚠ BACKUPS ARE DISABLED — no point-in-time recovery. Set backup.enabled=true.` (same posture pattern as `BOOKCLAW_AUTH_DISABLED`). Unwritable/invalid root → `⚠` + degraded-off, gateway continues (fail-soft rule).

### 2. Config (`config/default.json`)

The approved sketch, minus the dead `format` keys (see Decisions):

```jsonc
"backup": {
  "enabled": true,
  "localPath": "~/bookclaw-backups",
  "scope": "standard",            // standard | full
  "local": { "keep": 10 },
  "cloud": { "enabled": false, "destinations": [], "hook": null },
  "intervalHours": 24,
  "onCompletion": true
}
```

User overrides land in `config/user.json` via the existing `ConfigService.set` path (which is what `PUT /api/backups/config` uses).

### 3. API (`gateway/src/api/routes/backups.routes.ts`) — new module, existing mounter pattern

- `GET /api/backups` — snapshot list (name, time, reason, scope, size, books contained) + `lastRun` status + `enabled`.
- `POST /api/backups` — back up now; returns the new snapshot summary.
- `POST /api/backups/:id/restore` — body `{ book?: slug }`; per-book or whole-workspace as above. `:id` validated against `SNAPSHOT_RE`.
- `GET /api/backups/config` / `PUT /api/backups/config` — read/update the `backup.*` block; PUT runs the confirmation gate for new cloud destinations/hook before persisting.

### 4. Init wiring

New block in the init sequence (after `BookService` and `ProjectEngine` exist — i.e. alongside phase-06 content services): instantiate `BackupService` with `ConfigService` + `BookService` + `ConfirmationGateService`, register the `onProjectCompleted` trigger, start the interval, log posture. Passed into `createAPIRoutes` for the new route module. Fail-soft throughout.

### 5. Studio UI (Settings page — one new "Backups" card)

- Status row: last backup time + result; **persistent warning banner when `backup.enabled` is false**.
- Controls: enabled toggle, keep-N, interval, scope; "Back up now" button.
- Snapshot list: each row shows time/reason/size with **Restore…** (choose whole workspace or pick a book contained in that snapshot; confirm dialog states that a pre-restore snapshot is taken automatically and that whole-workspace restore recommends a restart).
- Cloud: destinations list (add path / rclone remote / hook) — adding one surfaces the pending confirmation in the existing Confirmations UI.
- Lean: no new route/page; everything inside `routes/Settings.tsx` + the shared API client.

### 6. Docker / deploy

- `docker/docker-compose.yml`: second host bind-mount `${BOOKCLAW_BACKUP_PATH:-/home/paul/bookclaw-backups}:/app/backups` + `BOOKCLAW_BACKUP_DIR=/app/backups` env.
- `scripts/deploy.sh`: `mkdir -p` the backup host dir, record `BOOKCLAW_BACKUP_PATH` in `docker/.env`, and chown it to the container user — same pattern (and same reason) as the workspace bind-mount.
- `.env.example`: document `BOOKCLAW_BACKUP_PATH` / `BOOKCLAW_BACKUP_DIR`.

## Security considerations

- Backups can exfiltrate everything → cloud destinations confirmation-gated at setup; default scope excludes the vault; the vault key is never in any archive (it lives outside the workspace).
- `SNAPSHOT_RE` + `SLUG_RE` validation on every id/slug that reaches a filesystem path; the backup root must be outside the workspace; restore never deletes `.vault`/`.audit`.
- Hook + rclone spawn with fixed argv (no shell), and the hook path is part of the gated config.

## Verify (release-gate criteria, from the arch doc)

1. A snapshot appears under the backup dir with the expected content and exclusions.
2. The 11th snapshot prunes the oldest (and prune touches only `SNAPSHOT_RE` dirs).
3. A per-book restore round-trips a modified book.
4. `backup.enabled: false` logs the loud startup warning (and the UI banner shows).
5. A restored too-old book hits the version gate (read-only), not silent coercion.

## Testing

- **Unit (`tests/unit/backup.test.ts`):** snapshot tree + exclusions (standard and full); tmp-then-rename atomicity (a `.tmp-` leftover is never listed); prune at N+1 and prune-safety (non-matching dirs untouched); per-book restore round-trip; pre-restore snapshot taken; whole-workspace restore preserves `.vault`/`.audit`; too-old restored manifest → read-only; disabled → no-op + posture flag; min-interval guard; root-inside-workspace refused; zip excludes vault. Target ~12–14 tests; suite grows from 164.
- **Feature-smoke (Tier A addition, free):** `GET/PUT /api/backups/config` round-trip; `POST /api/backups` → snapshot listed; per-book restore round-trips a throwaway Tier-D-style book; restore of a bogus id → 4xx. Cleanup in the exit trap.
- **Local gates:** `npx tsc --noEmit`, unit suite, `npm run build:frontend`.
- **Live:** Mercury deploy (`touch build_now` → PASS) + feature-smoke + a manual glance at the host backup dir.

## Decisions (don't re-litigate; one flagged for approval)

- **FLAGGED:** `standard` scope adds `soul/` + `memory/` beyond the doc's "books+library+config" (rationale above). Owner to approve or strike. Code review extended the same rationale to `documents/`, `projects/`, and `.bookclaw/`.
- The arch-doc config sketch's `local.format: "mirror"` / `cloud.format: "zip"` keys are **dropped** — nothing read them (mirror and zip are the only implementations), so carrying them was dead config surface.
- Mirror snapshots, keep-N=10, default-ON, cloud opt-in + never-prune-remote, three fail-soft cloud layers, in-process scheduler — all per the approved architecture doc.
- Restore-of-cloud-zips stays out of scope (local mirrors are the restore path).
- Whole-workspace restore is files-on-disk + `restartRecommended`, not hot-reload of every service (only `BookService` re-initializes in-process).
