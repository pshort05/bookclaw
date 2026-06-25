/**
 * BookClaw Sandbox Guard
 * Constrains all file operations to the workspace directory
 */

import { resolve, relative, sep, dirname } from 'path';
import { realpathSync, existsSync } from 'fs';

export class SandboxGuard {
  private workspaceRoot: string;
  private forbiddenPatterns = [
    /\.\.\//, /\.\.\\/, // path traversal
    /\/etc\//, /\/proc\//, /\/sys\//, // system dirs
    /~\/\.ssh/, /~\/\.gnupg/, // sensitive dirs
    /\.env$/, /\.vault/, // sensitive files
    /node_modules/, // dependency dirs
  ];

  constructor(workspaceRoot: string) {
    this.workspaceRoot = resolve(workspaceRoot);
  }

  /**
   * Validate that a path is within the workspace
   */
  validatePath(targetPath: string): { valid: boolean; reason?: string; resolved?: string } {
    const resolved = resolve(this.workspaceRoot, targetPath);

    // Check it's within the workspace. Compare resolved paths directly using
    // the platform separator. This is a pure-string lexical check and does NOT
    // catch symlinks — a real symlink-escape defence follows below via realpath.
    // The old compound check was a tautology that collapsed to
    // `rel.startsWith('..')`, missing some cases.
    const rootWithSep = this.workspaceRoot.endsWith(sep)
      ? this.workspaceRoot
      : this.workspaceRoot + sep;
    if (resolved !== this.workspaceRoot && !resolved.startsWith(rootWithSep)) {
      return { valid: false, reason: 'Path escapes workspace boundary' };
    }

    // Also reject any path with literal '..' segments in the untrusted input
    // (handles cases where resolve() might normalize them away on some platforms).
    const rel = relative(this.workspaceRoot, resolved);
    if (rel.split(sep).some(seg => seg === '..')) {
      return { valid: false, reason: 'Path contains traversal segments' };
    }

    // Check forbidden patterns
    for (const pattern of this.forbiddenPatterns) {
      if (pattern.test(targetPath) || pattern.test(rel)) {
        return { valid: false, reason: `Path matches forbidden pattern: ${pattern}` };
      }
    }

    // Symlink-escape defence: the lexical check above can be defeated by a
    // symlink that lives inside the workspace but points outside it. Resolve
    // symlinks with realpath and re-assert containment against the realpath of
    // the workspace root. The target may not exist yet (a file being created),
    // so realpath the nearest existing ancestor and join the remaining tail.
    const realCheck = this.assertRealpathContained(resolved);
    if (!realCheck.ok) {
      return { valid: false, reason: realCheck.reason };
    }

    return { valid: true, resolved };
  }

  /**
   * Resolve symlinks on the resolved target (or its nearest existing ancestor
   * when the target does not exist yet) and assert it still lives under the
   * realpath of the workspace root. Defeats in-workspace symlinks that point
   * outside the sandbox.
   */
  private assertRealpathContained(resolved: string): { ok: boolean; reason?: string } {
    let realRoot: string;
    try {
      realRoot = realpathSync(this.workspaceRoot);
    } catch {
      // Workspace root itself can't be resolved — cannot prove containment.
      return { ok: false, reason: 'Workspace root could not be resolved' };
    }
    const rootWithSep = realRoot.endsWith(sep) ? realRoot : realRoot + sep;

    // Walk up to the nearest existing ancestor of the (possibly not-yet-created)
    // target, realpath it, then re-append the non-existent tail.
    let existing = resolved;
    const tail: string[] = [];
    while (!existsSync(existing)) {
      const parent = dirname(existing);
      if (parent === existing) break; // reached filesystem root
      tail.unshift(existing.slice(parent.length + 1));
      existing = parent;
    }

    let realResolved: string;
    try {
      realResolved = realpathSync(existing);
    } catch {
      return { ok: false, reason: 'Path could not be resolved' };
    }
    if (tail.length > 0) realResolved = resolve(realResolved, ...tail);

    if (realResolved !== realRoot && !realResolved.startsWith(rootWithSep)) {
      return { ok: false, reason: 'Path escapes workspace boundary (symlink)' };
    }
    return { ok: true };
  }

  /**
   * Sanitize a filename
   */
  sanitizeFilename(name: string): string {
    return name
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
      .replace(/\.{2,}/g, '_')
      .substring(0, 255);
  }
}
