import { join } from 'path';
import { EditorService } from '../services/editor.js';
import { ROOT_DIR } from '../paths.js';
import type { BookClawGateway } from '../index.js';

/**
 * Phase 5b: EditorService — per-channel active developmental-editor pointers.
 * Constructed after the library (phase-05) so it can resolve the `editor` kind.
 * Fail-soft like the rest of init: a load failure degrades to "no editor
 * sessions" rather than aborting startup (the service swallows its own errors).
 */
export async function initEditors(gw: BookClawGateway): Promise<void> {
  gw.editors = new EditorService(join(ROOT_DIR, 'workspace'), gw.library);
  await gw.editors.initialize();
  console.log(`  ✓ Editors: ${gw.editors.list().length} available`);
}
