/**
 * Bug #27 — clear-then-await race in reinitialize/reload paths.
 *
 * A method empties a shared collection SYNCHRONOUSLY, then awaits to repopulate
 * it — leaving a window where a concurrent reader sees an EMPTY collection:
 *
 *   router.ts  initialize()/reinitialize(): this.providers.clear() then awaits
 *              checkOllama()/vault.get() before any providers.set(). A concurrent
 *              selectProvider() during that window throws "No AI providers".
 *   library.ts loadAll(): this.entries.clear() then per-kind awaits loadKind()
 *              before this.entries.set(). A concurrent list()/get() returns empty.
 *
 * Fix: build the new collection into a LOCAL, then swap it into the shared field
 * in ONE synchronous assignment AFTER all awaited reads complete. A concurrent
 * reader then always sees either the old fully-populated collection or the new
 * one, never an empty intermediate.
 *
 * Determinism: an async function runs its synchronous prefix fully before it
 * yields at its first real await. With the buggy code that prefix INCLUDES the
 * .clear(), so a read issued in the same tick (after kicking the re-init WITHOUT
 * awaiting it) observes the emptied collection. With the fix the prefix does no
 * mutation, so the same read observes the old collection. No timers needed.
 *
 * Run: node --import tsx --test tests/unit/reinit-race.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AIRouter } from '../../gateway/src/ai/router.js';
import { LibraryService } from '../../gateway/src/services/library.js';

// ── router ───────────────────────────────────────────────────────────────────

function makeVault(): { get: (k: string) => Promise<string | null> } {
  // Async so awaiting it yields to the microtask queue — models a slow probe.
  return { get: async (k: string) => (k === 'gemini_api_key' ? 'test-value' : null) };
}

test('router: selectProvider during an in-flight reinitialize() never sees an empty map', async () => {
  const costs = { isOverBudget: () => false };
  const config = { ollama: { enabled: false } };
  const router = new AIRouter(config, makeVault() as never, costs as never);
  await router.initialize(); // populated: gemini present

  // Kick a reinitialize WITHOUT awaiting it, then read in the SAME tick.
  const inFlight = router.reinitialize();
  // The buggy code has already run this.providers.clear() synchronously here.
  assert.doesNotThrow(
    () => router.selectProvider('general'),
    'a concurrent selectProvider must still resolve the old provider mid-reinitialize',
  );
  const p = router.selectProvider('general');
  assert.equal(p.id, 'gemini');

  await inFlight;
  // After it settles the map is populated again.
  assert.equal(router.selectProvider('general').id, 'gemini');
});

// ── library ──────────────────────────────────────────────────────────────────

const fakeSkills = {
  getSkillCatalog: () => [],
  getSkillByName: () => undefined,
} as never;

test('library: list()/get() during an in-flight loadAll() never sees empty entries', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-reinit-race-'));
  try {
    const builtin = join(root, 'library');
    const workspace = join(root, 'workspace', 'library');
    mkdirSync(join(builtin, 'genres', 'romantasy'), { recursive: true });
    writeFileSync(join(builtin, 'genres', 'romantasy', 'tropes.md'), 'BUILTIN tropes', 'utf-8');

    const lib = new LibraryService(builtin, workspace, fakeSkills);
    await lib.loadAll(); // populated

    // Kick a reload WITHOUT awaiting, then read in the SAME tick.
    const inFlight = lib.loadAll();
    // The buggy code has already run this.entries.clear() synchronously here.
    const genres = lib.list('genre');
    assert.ok(
      genres.some((g) => g.name === 'romantasy'),
      'a concurrent list() must still see the old populated entries mid-reload',
    );
    assert.ok(lib.get('genre', 'romantasy'), 'get() must still resolve the old entry mid-reload');

    await inFlight;
    assert.ok(lib.list('genre').some((g) => g.name === 'romantasy'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
