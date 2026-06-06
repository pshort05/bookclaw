import { join } from 'path';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import { ConfigService } from '../services/config.js';
import { ROOT_DIR } from '../paths.js';
import type { BookClawGateway } from '../index.js';

/**
 * Current on-disk schema version of the workspace tree. Bumped only on a
 * breaking layout change; the per-book/library compatibility gate (a later
 * phase) reads this. See docs/BOOK-CONTAINER-ARCHITECTURE.md.
 */
export const WORKSPACE_SCHEMA_VERSION = 1;

/** Phase 1: Configuration + workspace schema marker. */
export async function initConfig(gw: BookClawGateway): Promise<void> {
  gw.config = new ConfigService(join(ROOT_DIR, 'config'));
  await gw.config.load();
  console.log('  ✓ Configuration loaded');

  await stampWorkspaceMarker();
}

/**
 * Stamp workspace/.bookclaw/workspace.json with the schema version on first run
 * (and log the version on later runs). No compatibility gate yet — that lands
 * with the per-book version gate. Fail-soft: a marker problem must not block
 * startup.
 */
async function stampWorkspaceMarker(): Promise<void> {
  const markerDir = join(ROOT_DIR, 'workspace', '.bookclaw');
  const markerPath = join(markerDir, 'workspace.json');

  if (existsSync(markerPath)) {
    try {
      const m = JSON.parse(await fs.readFile(markerPath, 'utf-8'));
      console.log(`  ℹ Workspace schema v${m.schemaVersion} (created by app ${m.createdByApp ?? '?'})`);
    } catch {
      console.log('  ⚠ Workspace schema marker present but unreadable — leaving it untouched');
    }
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
