/**
 * Workspace-level version gate.
 *
 * Mirrors the per-book `classifyVersion` posture (book-types.ts), applied to the
 * whole workspace tree. The marker `workspace/.bookclaw/workspace.json` persists
 * `schemaVersion`; on boot the gate compares it against this build's supported
 * range and refuses to start when the workspace was written by a too-new app (or
 * is too old), so an incompatible app cannot silently corrupt the data. An
 * operator can override with `BOOKCLAW_SKIP_VERSION_GATE=1` (the conscious human
 * consent — mirrors the `BOOKCLAW_AUTH_DISABLED` escape hatch).
 *
 * Distinct from version.ts `BREAKING_VERSION`, which is an API-surfaced product
 * marker only (not persisted, not gated). Per the owner decision (2026-06-18),
 * the two stay separate: this drives the on-disk workspace-compatibility gate.
 */

/** Current on-disk schema version of the workspace tree. Bump on a breaking layout change. */
export const WORKSPACE_SCHEMA_VERSION = 1;

/** Oldest workspace schema this build can still open. Below it → quarantined. */
export const WORKSPACE_MIN_SUPPORTED = 1;

export type WorkspaceStatus = 'ok' | 'readonly' | 'quarantined';

/** Classify a persisted workspace marker version against this build's range. */
export function classifyWorkspace(v: number): WorkspaceStatus {
  if (v < WORKSPACE_MIN_SUPPORTED) return 'quarantined'; // too old for this app
  if (v > WORKSPACE_SCHEMA_VERSION) return 'readonly';   // written by a newer app
  return 'ok';
}

export interface WorkspaceGate {
  /** True → boot must abort. */
  halt: boolean;
  level: 'ok' | 'warn' | 'fatal';
  /** Human-facing line for the boot log (fatal message tells the operator how to consent). */
  message: string;
}

/**
 * Decide the boot action for a workspace marker version. A compatible marker
 * proceeds. An incompatible marker halts boot (fatal) unless `override` is set,
 * which downgrades it to a loud warning and continues (unsafe).
 */
export function workspaceGate(markerSchemaVersion: number, override: boolean): WorkspaceGate {
  const status = classifyWorkspace(markerSchemaVersion);
  if (status === 'ok') {
    return { halt: false, level: 'ok', message: `workspace schema v${markerSchemaVersion}` };
  }

  const range = WORKSPACE_MIN_SUPPORTED === WORKSPACE_SCHEMA_VERSION
    ? `v${WORKSPACE_SCHEMA_VERSION}`
    : `v${WORKSPACE_MIN_SUPPORTED}–v${WORKSPACE_SCHEMA_VERSION}`;
  const reason = status === 'readonly'
    ? `was written by a newer BookClaw (workspace schema v${markerSchemaVersion}; this build supports ${range})`
    : `is too old for this BookClaw (workspace schema v${markerSchemaVersion}; this build needs at least v${WORKSPACE_MIN_SUPPORTED})`;

  if (override) {
    return {
      halt: false,
      level: 'warn',
      message: `Workspace ${reason}. BOOKCLAW_SKIP_VERSION_GATE=1 set — starting anyway (unsafe).`,
    };
  }
  return {
    halt: true,
    level: 'fatal',
    message:
      `Workspace ${reason}. Refusing to start to avoid corrupting your data. ` +
      `Upgrade BookClaw to a build that supports this workspace, or set ` +
      `BOOKCLAW_SKIP_VERSION_GATE=1 to override (unsafe).`,
  };
}
