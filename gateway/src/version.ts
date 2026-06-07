/**
 * Product display version — date-time based: `V5.MM.DD.HH.MM`.
 *
 * Stamped at BUILD/DEPLOY time: `scripts/deploy.sh` computes
 * `V5.$(date +%m.%d.%H.%M)` and passes it as `BOOKCLAW_VERSION` via
 * `docker/.env` → the container. So every Mercury push
 * (`build_now` → `build-watch.sh` → `deploy.sh`) shows a fresh version, and a
 * plain container restart keeps that build's version.
 *
 * Local dev (no build) falls back to a boot-time `V5.MM.DD.HH.MM` in the same
 * shape, using local server time. Distinct from `package.json`'s semver
 * (`5.0.0`), which npm tooling and book/workspace provenance still use.
 */
function bootVersion(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `V5.${p(d.getMonth() + 1)}.${p(d.getDate())}.${p(d.getHours())}.${p(d.getMinutes())}`;
}

/** The version shown in the banner, /api/status, and the dashboard. */
export const DISPLAY_VERSION = process.env.BOOKCLAW_VERSION || bootVersion();
