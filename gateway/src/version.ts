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
 * BREAKING_VERSION — the product's breaking-change gate. The date stamp carries
 * no compatibility signal, so this separate integer is bumped BY HAND whenever a
 * change breaks compatibility with previously-created workspaces / books /
 * config. A forthcoming boot gate compares it against the persisted
 * `workspace/.bookclaw/workspace.json` marker and refuses/quarantines on an
 * incompatible mismatch (tracked in docs/TODO.md "Owner roadmap"). Starts at 1.
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
 * with existing workspaces/books/config. The enforcing boot gate is a TODO; for
 * now this is surfaced in /api/status and /api/health so the value is visible.
 */
export const BREAKING_VERSION = 1;
