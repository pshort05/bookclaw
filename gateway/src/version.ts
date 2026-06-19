/**
 * Product versioning.
 *
 * DISPLAY_VERSION — CalVer date stamp `V{yy.mm.dd}` (e.g. `V26.06.12`). Stamped
 * at BUILD/DEPLOY time: `scripts/deploy.sh` computes `V$(date +%y.%m.%d)` and
 * passes it as `BOOKCLAW_VERSION` via `docker/.env` → the container, so every
 * push shows the build date and a plain container restart keeps that date.
 * Local dev (no build) falls back to a boot-time stamp in the same shape, using
 * local server time. Distinct from `package.json`'s semver, which npm tooling
 * and book/workspace provenance still use.
 *
 * BREAKING_VERSION — an API-surfaced product breaking-change marker. The date
 * stamp carries no compatibility signal, so this separate integer is bumped BY
 * HAND whenever a change breaks compatibility with previously-created workspaces
 * / books / config, and is surfaced in /api/status + /api/health for visibility.
 * It is NOT the enforcing gate: the boot-time workspace-compatibility gate is
 * driven by WORKSPACE_SCHEMA_VERSION (workspace-version.ts), which is the integer
 * persisted in `workspace/.bookclaw/workspace.json` and compared on startup (kept
 * separate by the 2026-06-18 owner decision). Starts at 1.
 */
function bootVersion(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `V${p(d.getFullYear() % 100)}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
}

/** The version shown in the banner, /api/status, and the dashboard. */
export const DISPLAY_VERSION = process.env.BOOKCLAW_VERSION || bootVersion();

/**
 * Breaking-change marker — bump by hand on any change that breaks compatibility
 * with existing workspaces/books/config. Surfaced in /api/status and /api/health
 * for visibility. The enforcing boot gate is separate and version-driven by
 * WORKSPACE_SCHEMA_VERSION (workspace-version.ts).
 */
export const BREAKING_VERSION = 1;
