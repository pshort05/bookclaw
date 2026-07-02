import { join } from 'path';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import { ConfigService } from '../services/config.js';
import { ROOT_DIR } from '../paths.js';
import { WORKSPACE_SCHEMA_VERSION, workspaceGate } from '../services/workspace-version.js';
import type { BookClawGateway } from '../index.js';

// Re-exported for the rest of init/ (phase-06-content) that still imports it
// from here; the source of truth + the gate logic live in workspace-version.ts.
export { WORKSPACE_SCHEMA_VERSION };

/** Phase 1: Configuration + workspace schema marker. */
export async function initConfig(gw: BookClawGateway): Promise<void> {
  // Runtime overrides persist under the workspace bind-mount (survives image
  // rebuilds); config/user.json stays a read-only baked seed. See config.ts.
  gw.config = new ConfigService(
    join(ROOT_DIR, 'config'),
    join(ROOT_DIR, 'workspace', '.config', 'config-overrides.json'),
  );
  await gw.config.load();
  console.log('  ✓ Configuration loaded');

  await stampWorkspaceMarker();
}

/**
 * Stamp workspace/.bookclaw/workspace.json with the schema version on first run
 * (and gate compatibility on later runs). The gate (workspace-version.ts) refuses
 * to start when the marker was written by a too-new app (or is too old) so an
 * incompatible build can't corrupt the data — fail-closed, mirroring the per-book
 * version gate; an operator can override with BOOKCLAW_SKIP_VERSION_GATE=1.
 *
 * Fail-soft only for non-version problems: a missing marker is a fresh workspace
 * (stamp it) and an unreadable marker can't be classified, so neither blocks
 * startup. A *determinable* incompatible version is the one case that halts boot.
 */
async function stampWorkspaceMarker(): Promise<void> {
  const markerDir = join(ROOT_DIR, 'workspace', '.bookclaw');
  const markerPath = join(markerDir, 'workspace.json');

  if (existsSync(markerPath)) {
    let m: { schemaVersion?: unknown; createdByApp?: unknown };
    try {
      m = JSON.parse(await fs.readFile(markerPath, 'utf-8'));
    } catch {
      console.log('  ⚠ Workspace schema marker present but unreadable — leaving it untouched');
      return;
    }
    // Missing/non-numeric schemaVersion → 0 → quarantined (fail-closed, mirrors
    // the per-book `schemaVersion ?? 0` posture).
    const markerVersion = Number(m.schemaVersion) || 0;
    const gate = workspaceGate(markerVersion, process.env.BOOKCLAW_SKIP_VERSION_GATE === '1');
    if (gate.level === 'fatal') {
      console.error(`\n  ✖ FATAL: ${gate.message}\n`);
      process.exit(1);
    }
    if (gate.level === 'warn') {
      console.log(`  ⚠ ${gate.message}`);
      return;
    }
    console.log(`  ℹ Workspace schema v${markerVersion} (created by app ${m.createdByApp ?? '?'})`);
    return;
  }

  try {
    await fs.mkdir(markerDir, { recursive: true });
    const marker = {
      schemaVersion: WORKSPACE_SCHEMA_VERSION,
      createdByApp: await appVersion(),
      createdAt: new Date().toISOString(),
    };
    await fs.writeFile(markerPath, JSON.stringify(marker, null, 2) + '\n', 'utf-8');
    console.log(`  ✓ Workspace schema marker stamped (v${WORKSPACE_SCHEMA_VERSION})`);
  } catch (err) {
    console.log(`  ⚠ Could not write workspace schema marker: ${(err as Error).message}`);
  }
}

export async function appVersion(): Promise<string> {
  try {
    const pkg = JSON.parse(await fs.readFile(join(ROOT_DIR, 'package.json'), 'utf-8'));
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}
