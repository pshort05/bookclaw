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
