/** Shared time-formatting helpers. */

/**
 * Returns an HH:MM string in local time.
 * @param ts - optional ISO 8601 string; defaults to now.
 * Returns an empty string for invalid dates.
 */
export function hhmm(ts?: string): string {
  const d = ts ? new Date(ts) : new Date();
  return isNaN(d.getTime()) ? '' : d.toTimeString().slice(0, 5);
}

/**
 * Returns an HH:MM:SS string in local time.
 * @param ts - optional ISO 8601 string; defaults to now.
 * Returns an empty string for invalid dates.
 */
export function hhmmss(ts?: string): string {
  const d = ts ? new Date(ts) : new Date();
  return isNaN(d.getTime()) ? '' : d.toTimeString().slice(0, 8);
}

/**
 * Formats a USD spend amount with 4 decimals ($0.0001 resolution) so cheap-model
 * spend reads as non-zero. For SPEND amounts only — budget limits/caps render
 * separately (they are whole-dollar figures and 4 decimals would read oddly).
 */
export function money(n: number): string {
  return '$' + (Number.isFinite(n) ? n : 0).toFixed(4);
}
