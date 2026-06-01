/**
 * Shared utilities for the split route mounters.
 *
 * safePath was previously a module-level function in routes.ts; it is hoisted
 * here so every per-feature mounter file can import it without depending on
 * routes.ts (which imports the mounters — a one-way dependency).
 */
import path from 'path';

/** Verify resolved path stays within the allowed base directory. */
export function safePath(base: string, userInput: string): string | null {
  const resolved = path.resolve(base, userInput);
  const resolvedBase = path.resolve(base);
  if (!resolved.startsWith(resolvedBase + path.sep) && resolved !== resolvedBase) return null;
  return resolved;
}
