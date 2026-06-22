import { join, resolve } from 'path';
import { homedir } from 'os';
import { SoulService } from '../services/soul.js';
import { MemoryService } from '../services/memory.js';
import { MemorySearchService } from '../services/memory-search.js';
import { ConsistencyStore } from '../services/consistency/fact-store.js';
import { ROOT_DIR } from '../paths.js';
import type { BookClawGateway } from '../index.js';

/** Phase 3 (+3b memory search): soul & memory. */
export async function initSoulMemory(gw: BookClawGateway): Promise<void> {
  gw.soul = new SoulService(join(ROOT_DIR, 'workspace', 'soul'));
  await gw.soul.load();
  console.log(`  ✓ Soul loaded: "${gw.soul.getName()}"`);

  gw.memory = new MemoryService(join(ROOT_DIR, 'workspace', 'memory'), gw.config.get('memory'));
  await gw.memory.initialize();
  console.log('  ✓ Memory system initialized');

  // ── Phase 3b: Memory Search (FTS5 over conversations + project outputs) ──
  // Hermes-inspired persistent cross-session search. Falls back gracefully
  // if better-sqlite3 isn't available on this platform.
  // The FTS index DB lives in workspace/memory by default, but can be moved to a
  // separate (e.g. local, non-synced) disk via BOOKCLAW_DB_DIR / config memory.dbDir
  // so the workspace can sit in a cloud-synced folder without corrupting the live DB.
  const rawDbDir: string = process.env.BOOKCLAW_DB_DIR || gw.config.get('memory.dbDir', '');
  const dbDir = rawDbDir
    ? (rawDbDir.startsWith('~') ? join(homedir(), rawDbDir.slice(1)) : resolve(rawDbDir))
    : undefined;
  gw.memorySearch = new MemorySearchService(join(ROOT_DIR, 'workspace'), dbDir);
  await gw.memorySearch.initialize();
  if (dbDir) {
    const via = process.env.BOOKCLAW_DB_DIR ? 'BOOKCLAW_DB_DIR' : 'config memory.dbDir';
    console.log(`  ℹ Memory search DB relocated → ${gw.memorySearch.getDbPath()} (${via})`);
  }
  if (gw.memorySearch.isAvailable()) {
    // Wire memory.process() → live FTS indexing
    gw.memory.setLiveIndexHook((entry) => gw.memorySearch.indexConversationTurn(entry));
    // Index any pre-existing data on first boot — incremental on subsequent.
    try {
      const result = await gw.memorySearch.reindexAll();
      const stats = gw.memorySearch.getStats();
      console.log(`  ✓ Memory search ready: ${stats.totalEntries} entries indexed (added ${result.indexed}, skipped ${result.skipped})`);
    } catch (err) {
      console.warn(`  ⚠ Memory search reindex failed: ${(err as Error)?.message || err}`);
    }
  } else {
    console.log('  ⚠ Memory search unavailable (search will be disabled, rest of BookClaw works)');
  }

  // ── Phase 3c: Consistency Store (SQLite fact ledger for cross-chapter auditor) ──
  // Reuses the already-resolved dbDir so it lands beside memory-search.db (or is
  // relocated via BOOKCLAW_DB_DIR). Degrades fail-soft if better-sqlite3 is absent.
  try {
    gw.consistencyStore = new ConsistencyStore(join(ROOT_DIR, 'workspace'), dbDir);
    await gw.consistencyStore.initialize();
    if (gw.consistencyStore.isAvailable()) {
      console.log(`  ✓ Consistency store ready: ${gw.consistencyStore.getDbPath()}`);
    } else {
      console.log('  ⚠ Consistency store unavailable (consistency auditor disabled, rest of BookClaw works)');
    }
  } catch (err) {
    console.warn(`  ⚠ Consistency store init failed: ${(err as Error)?.message || err}`);
  }
}
