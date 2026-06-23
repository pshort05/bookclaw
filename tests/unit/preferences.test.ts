/**
 * Characterization tests for PreferenceStore (Batch D, persistent state).
 *
 * Covers the real logic: detectFromMessage() pattern matching + key inference,
 * the explicit-vs-inferred override guard in set(), persistence round-trip,
 * length bounds on detected values, multi-rule extraction from one message,
 * and buildContext() formatting. Persist is plain writeFile (no debounce).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { PreferenceStore } from '../../gateway/src/services/preferences.js';

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), 'bookclaw-pref-'));
}

test('detectFromMessage maps POV/tense author phrases to canonical keys', async () => {
  const dir = freshDir();
  try {
    const store = new PreferenceStore(dir);
    await store.initialize();
    const pov = await store.detectFromMessage('I write in first person, by the way.');
    assert.deepEqual(pov, [{ key: 'writing.pov', value: 'first person' }]);
    const tense = await store.detectFromMessage('I write in past tense usually.');
    assert.deepEqual(tense, [{ key: 'writing.tense', value: 'past tense' }]);
    assert.equal(store.get('writing.pov'), 'first person');
    assert.equal(store.get('writing.tense'), 'past tense');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('detectFromMessage infers key from "I prefer ..." via keyword inference', async () => {
  const dir = freshDir();
  try {
    const store = new PreferenceStore(dir);
    await store.initialize();
    const r = await store.detectFromMessage('I prefer concise responses.');
    assert.equal(r.length, 1);
    assert.equal(r[0].key, 'response.style'); // "concise" -> response.style
    assert.equal(r[0].value, 'concise responses');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('negative phrasing prefixes the stored value (avoid:/never:)', async () => {
  const dir = freshDir();
  try {
    const store = new PreferenceStore(dir);
    await store.initialize();
    const dislike = await store.detectFromMessage("I don't like adverbs.");
    // NOTE: the adverbs inference regex is /\b(adverb|ly words?)\b/ — the trailing
    // \b means "adverbs" (plural) does NOT match "adverb", so the key falls through
    // to the generic 'preference.<slug>' bucket. Singular "adverb" would key as
    // writing.adverbs. Encoding actual behavior. // NOTE: possible bug (plural miss)
    assert.equal(dislike[0].key, 'preference.adverbs');
    assert.equal(dislike[0].value, 'avoid: adverbs');

    const never = await store.detectFromMessage("don't ever use emojis.");
    assert.equal(never[0].value, 'never: use emojis');
    assert.equal(never[0].key, 'formatting.emojis');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('detected values shorter than 3 or longer than 100 chars are rejected', async () => {
  const dir = freshDir();
  try {
    const store = new PreferenceStore(dir);
    await store.initialize();
    assert.deepEqual(await store.detectFromMessage('I prefer x.'), []); // 1 char -> rejected
    const longVal = 'a'.repeat(120);
    assert.deepEqual(await store.detectFromMessage(`I prefer ${longVal}.`), []); // too long
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('multiple detection rules fire on one message', async () => {
  const dir = freshDir();
  try {
    const store = new PreferenceStore(dir);
    await store.initialize();
    // "I prefer ..." (greedy to end) plus the genre rule both match.
    const r = await store.detectFromMessage('my genre is dark fantasy. my target audience is adults.');
    const keys = r.map(x => x.key).sort();
    assert.deepEqual(keys, ['writing.genre', 'writing.target_audience']);
    assert.equal(store.get('writing.genre'), 'dark fantasy');
    assert.equal(store.get('writing.target_audience'), 'adults');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('detected (inferred) preferences round-trip through disk', async () => {
  const dir = freshDir();
  try {
    const a = new PreferenceStore(dir);
    await a.initialize();
    await a.detectFromMessage('I publish on Amazon KDP.');
    assert.equal(a.get('publishing.platform'), 'Amazon KDP');

    const b = new PreferenceStore(dir);
    await b.initialize();
    assert.equal(b.get('publishing.platform'), 'Amazon KDP');
    assert.equal(b.getAllWithMetadata().metadata['publishing.platform'].source, 'inferred');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('an explicit preference is not overridden by a later inferred detection', async () => {
  const dir = freshDir();
  try {
    const store = new PreferenceStore(dir);
    await store.initialize();
    await store.set('writing.pov', 'third person', 'explicit');
    // A later message that would infer first person must NOT clobber the explicit value.
    await store.detectFromMessage('I write in first person.');
    assert.equal(store.get('writing.pov'), 'third person');
    assert.equal(store.getAllWithMetadata().metadata['writing.pov'].source, 'explicit');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('buildContext emits a markdown bullet per pref with a source tag for non-explicit', async () => {
  const dir = freshDir();
  try {
    const store = new PreferenceStore(dir);
    await store.initialize();
    await store.set('tone', 'casual', 'explicit');
    await store.set('writing.pov', 'first person', 'inferred');
    const ctx = store.buildContext();
    assert.ok(ctx.includes('- **tone**: casual'));
    assert.ok(!ctx.includes('tone**: casual (')); // explicit -> no source tag
    assert.ok(ctx.includes('- **writing.pov**: first person (inferred)'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('remove() deletes a key and reports whether it existed', async () => {
  const dir = freshDir();
  try {
    const store = new PreferenceStore(dir);
    await store.initialize();
    await store.set('tone', 'formal', 'explicit');
    assert.equal(await store.remove('tone'), true);
    assert.equal(store.get('tone'), undefined);
    assert.equal(await store.remove('tone'), false); // already gone
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('reset() clears all preferences and persists the empty state', async () => {
  const dir = freshDir();
  try {
    const a = new PreferenceStore(dir);
    await a.initialize();
    await a.set('tone', 'casual', 'explicit');
    await a.reset();
    assert.deepEqual(a.getAll(), {});

    const b = new PreferenceStore(dir);
    await b.initialize();
    assert.deepEqual(b.getAll(), {});
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
