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

/** Humanize an uptime in seconds, e.g. 90061 → "1d 1h 1m 1s" (zero units omitted). */
export function formatUptime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (sec || parts.length === 0) parts.push(`${sec}s`);
  return parts.join(' ');
}

/**
 * Build the /version message body: version + breaking marker + server boot time
 * (derived from uptime) + uptime. The boot time changes on every redeploy/restart,
 * so it disambiguates same-day builds that share the date-stamped DISPLAY_VERSION.
 */
export function formatVersionInfo(opts: { version: string; breakingVersion: number; uptimeSeconds: number; now: Date }): string {
  const boot = new Date(opts.now.getTime() - Math.round(opts.uptimeSeconds * 1000));
  const p = (n: number) => String(n).padStart(2, '0');
  const started = `${boot.getFullYear()}-${p(boot.getMonth() + 1)}-${p(boot.getDate())} ${p(boot.getHours())}:${p(boot.getMinutes())}:${p(boot.getSeconds())}`;
  return [
    `**BookClaw ${opts.version}**`,
    `Breaking version: ${opts.breakingVersion}`,
    `Started: ${started} (up ${formatUptime(opts.uptimeSeconds)})`,
  ].join('\n');
}
