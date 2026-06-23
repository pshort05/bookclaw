# Backups and recovery

## What it is

BookClaw keeps point-in-time **snapshots** of your working data so you can roll back a bad edit, recover a lost book, or move your work to another machine. Backups are **on by default** and run automatically — you do not have to remember to trigger them.

Each snapshot is a plain, uncompressed **mirror** of your workspace (your books, library, author identity, memory, and project outputs) written to a folder **outside** the workspace so a backup can never accidentally back itself up. Snapshots are named by timestamp (for example `2026-06-22T14-30-05`) and pruned to the most recent ten by default.

There are two recovery modes:

- **Whole-workspace restore** — roll everything back to a chosen snapshot.
- **Per-book restore** — revert a single book to how it looked in a snapshot, leaving every other book untouched.

Restoring **always takes a fresh snapshot of the current state first**, so a restore is itself reversible. Your encrypted credential vault and the security audit log are never overwritten by a restore.

Optionally, you can turn on **cloud push** to copy each snapshot offsite (to a synced folder, an `rclone` remote, or a custom command).

## Why it matters

Your manuscripts and author identity live in the workspace. A mistaken overwrite, a botched mass edit, or a disk failure could lose months of writing. Backups give you a safety net with no manual effort:

- **Always recent.** Snapshots run on a schedule, when a project finishes, and on demand — whichever happens first.
- **Reversible recovery.** Because a restore pre-snapshots the current state, you can always undo a restore you did not mean to do.
- **Granular rollback.** Per-book restore lets you revert one book without disturbing the rest of your catalog.
- **Offsite copies.** Optional cloud push protects you against losing the whole machine.

## How to use it

### In the Studio

Open **Settings** and find the **Backups** card.

**Status and history.** The card shows whether backups are enabled, where snapshots are written, when the last run happened (and whether it succeeded), and the current snapshot count.

**Back up now.** The Back-up-now button takes an immediate snapshot. This works even if scheduled backups are turned off — it is an explicit action.

**Restore.** Pick a snapshot from the list, then choose **whole-workspace** or a **specific book** to revert. The restore runs after pre-snapshotting your current state. A whole-workspace restore recommends a restart afterwards so the running app fully picks up the reverted data.

**Settings.** Adjust how many snapshots to keep, how often they run (in hours), and the **scope** (see Under the hood). Changes take effect live — no restart needed.

**Disabling backups.** You can switch backups off, but the server logs a loud warning when you do. Leaving them on is strongly recommended.

**Cloud destinations.** Adding a cloud destination or post-backup command is treated as an outbound side effect, so it must be **approved through the Confirmation gate** before it takes effect. The card shows the pending-approval flow; once approved, future snapshots are pushed there automatically. BookClaw never deletes anything from your cloud destination — pruning offsite copies is up to you.

### Via the API

All routes sit behind the standard bearer auth and IP allowlist (see [SECURITY.md](../SECURITY.md)).

**List snapshots and status.**

```
GET /api/backups
```

Returns the current status (enabled, backup root, last run, count) plus the snapshot list, newest first.

**Back up now.**

```
POST /api/backups
```

Takes an immediate snapshot (reason `manual`). Allowed even when backups are disabled.

**Restore a snapshot.**

```
POST /api/backups/:id/restore
```

Body is optional. Send `{ "book": "<slug>" }` to revert a single book; omit it to restore the whole workspace. The response includes `preSnapshot` (the name of the safety snapshot taken first) and `restartRecommended`. An unknown snapshot id, an unknown book, or a malformed slug returns `404`.

**Read backup configuration.**

```
GET /api/backups/config
```

**Update backup configuration.**

```
PUT /api/backups/config
```

Accepts `enabled`, `scope` (`standard` or `full`), `local.keep` (1–1000), `intervalHours` (>= 1), `onCompletion`, `localPath`, and a `cloud` block (`enabled`, `destinations`, `hook`). Enabling or disabling backups and changing the interval re-arm the scheduler live.

If the update introduces a **new** cloud destination or hook, the route does not apply it immediately — it returns `202` with a `pendingConfirmation` id. Approve that confirmation in the Studio, then finalize:

```
POST /api/backups/config/confirm/:id
```

This is one-shot and replay-proof: the pending cloud settings are held server-side, merged over the current config on confirm, and consumed.

The same operations are available through the MCP server's backup tools.

## Under the hood

**Triggers.** A snapshot is created by any of:

- **Scheduled** — an in-process timer (default every 24 hours), staleness-guarded so a recent manual or on-completion snapshot suppresses a redundant scheduled one.
- **On project completion** — after a writing project finishes (10-minute guard against piling up).
- **Manual** — the Back-up-now button or `POST /api/backups`.

**Scope.** Two scopes control what a snapshot contains:

- `standard` (default) — your non-regenerable data: `books`, `library`, `.config`, `soul`, `memory`, `documents`, `projects`, and the workspace marker. This is an allowlist.
- `full` — the entire workspace, including the encrypted vault file (`.vault/vault.enc`) as an offsite copy. The vault **key** lives outside the workspace and is never archived.

Live database files (the memory-search SQLite index and its `-wal`/`-shm` sidecars) are excluded from every scope because they are regenerable and unsafe to copy mid-write.

**Where snapshots go.** The backup root is `BOOKCLAW_BACKUP_DIR`, falling back to the config value `backup.localPath` (default `~/bookclaw-backups`). The service **refuses to start** if this path resolves inside the workspace. In Docker it is a second host bind-mount (`BOOKCLAW_BACKUP_PATH`, default `/home/paul/bookclaw-backups`, mounted at `/app/backups`).

**How a snapshot is written.** Each snapshot is copied to a temporary `.tmp-` directory first and renamed into place only when complete, so a crashed or partial copy never looks like a valid snapshot. A `snapshot.json` manifest records the timestamp, trigger reason, scope, and the list of books it contains. Pruning keeps the newest N (default 10) and only ever touches timestamp-named directories.

**What restore touches — and what it never touches.** A restore copies snapshot contents back over the workspace but always skips `.vault` (your credentials) and `.audit` (the tamper-evident security log) — these are never part of in-app point-in-time recovery. After copying, it re-initializes the book service and reloads the composed author identity. Restoring a `full` snapshot widens the automatic pre-restore snapshot to `full` as well, so the safety copy covers everything the restore overwrites.

**Restoring an old book.** If a restored book's manifest is from a too-old schema version, it is classified by the existing version gate (quarantined) rather than loaded blindly. See [Books and authors](./books-and-authors.md) for the per-book schema lifecycle.

**Cloud push (opt-in).** When enabled, the snapshot is zipped and sent to each configured layer, each independent and fail-soft (one failing layer does not stop the others, and failures surface on the last-run status):

- a plain path — the zip is copied into that directory (for example a Dropbox-synced folder);
- `rclone:<remote>[:path]` — pushed with `rclone copy`;
- a post-backup **hook** — your command, invoked with the zip path as its first argument.

Commands are spawned with fixed arguments and no shell. BookClaw never deletes remote data.

**Vault-key caveat.** Backups protect your writing data, not your secret. Your stored API keys and other credentials are encrypted with `BOOKCLAW_VAULT_KEY`, which lives outside the workspace and is never included in a backup. If you lose that key, the encrypted vault cannot be decrypted even from a `full` snapshot — back up the key separately. See [SECURITY.md](../SECURITY.md).

### Key files

- `gateway/src/services/backup.ts` — `BackupService`: snapshot, prune, restore, cloud push, scheduling.
- `gateway/src/api/routes/backups.routes.ts` — the `/api/backups` routes, config validation, and the confirmation-gated cloud flow.

## Related

- [SECURITY.md](../SECURITY.md) — the vault, the audit log, the Confirmation gate, and the overall security perimeter.
- [Books and authors](./books-and-authors.md) — per-book containers and the schema-version gate that a restored book passes through.
