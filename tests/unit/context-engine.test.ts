/**
 * Unit tests for gateway/src/services/context-engine.ts. Two pure areas, both
 * network-free:
 *
 *   (a) Defensive AI-JSON parsing — `parseAIJson` / `recoverTruncatedJson` /
 *       `findObjectEnd`. These are private in production; a thin test subclass
 *       reaches them (the three members were relaxed from `private` to
 *       `protected` for this — no behavior change).
 *
 *   (b) `getRelevantContext` — the fully-synchronous budget/selection logic.
 *       Seeded by calling the public async `loadContext` (which, with a fresh
 *       temp workspace, creates and caches an EMPTY context and returns that
 *       same object reference) and then mutating the returned context in place.
 *       No disk read of pre-existing data, no AI calls.
 *
 * Characterization: assertions encode the code's ACTUAL behavior.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ContextEngine, coerceAttributes, type ProjectContext } from '../../gateway/src/services/context-engine.js';

/** Subclass exposing the protected JSON-recovery helpers for direct testing. */
class TestableContextEngine extends ContextEngine {
  parse(text: string): any { return this.parseAIJson(text); }
  recover(s: string): string | null { return this.recoverTruncatedJson(s); }
  objEnd(s: string, start: number): number { return this.findObjectEnd(s, start); }
}

function freshEngine(): TestableContextEngine {
  // A unique empty temp dir guarantees loadContext finds no file and seeds empty.
  return new TestableContextEngine(mkdtempSync(join(tmpdir(), 'ctx-engine-')));
}

// ════════════════════════════════════════════════════════════
// (a) parseAIJson / recoverTruncatedJson / findObjectEnd
// ════════════════════════════════════════════════════════════

test('parseAIJson: clean object parses', () => {
  const e = freshEngine();
  assert.deepEqual(e.parse('{"a":1,"b":"two"}'), { a: 1, b: 'two' });
});

test('parseAIJson: strips a ```json code fence around the object', () => {
  const e = freshEngine();
  const raw = '```json\n{"summary":"ok","characters":["Ann"]}\n```';
  assert.deepEqual(e.parse(raw), { summary: 'ok', characters: ['Ann'] });
});

test('parseAIJson: ignores prose before and after the object', () => {
  const e = freshEngine();
  const raw = 'Sure! Here is the JSON:\n{"x":1}\nHope that helps.';
  assert.deepEqual(e.parse(raw), { x: 1 });
});

test('parseAIJson: a brace inside a string literal does not end the object early', () => {
  const e = freshEngine();
  // The "}" inside the string must NOT be treated as the object close.
  const raw = '{"note":"this } is literal","n":2}';
  assert.deepEqual(e.parse(raw), { note: 'this } is literal', n: 2 });
});

test('parseAIJson: trailing-comma JSON is repaired', () => {
  const e = freshEngine();
  assert.deepEqual(e.parse('{"a":1,"b":2,}'), { a: 1, b: 2 });
});

test('parseAIJson: single-quoted string values are repaired to double quotes', () => {
  const e = freshEngine();
  // The tryParse fallback converts ': \'...\'' to ': "..."'.
  assert.deepEqual(e.parse("{'name': 'Bob'}"), { name: 'Bob' });
});

test('parseAIJson: empty / whitespace-only input throws', () => {
  const e = freshEngine();
  assert.throws(() => e.parse(''), /empty content/);
  assert.throws(() => e.parse('   \n\t '), /empty content/);
});

test('parseAIJson: a response with no opening brace throws', () => {
  const e = freshEngine();
  assert.throws(() => e.parse('no json here at all'), /No valid JSON object/);
});

test('parseAIJson: truncated entity array recovers the N-1 complete entities', () => {
  const e = freshEngine();
  // Two complete entities then a third cut off mid-string by a token limit.
  const raw =
    '{"entities":[' +
    '{"name":"Ann","type":"character"},' +
    '{"name":"Bob","type":"character"},' +
    '{"name":"Cara","type":"char';
  const parsed = e.parse(raw);
  assert.equal(parsed.entities.length, 2, 'recovers the two complete entities, drops the half one');
  assert.deepEqual(parsed.entities.map((x: any) => x.name), ['Ann', 'Bob']);
});

test('findObjectEnd: returns the index of the matching close brace, skipping string braces', () => {
  const e = freshEngine();
  const s = '{"a":"}{","b":1}';
  // The real close is the final char; the braces inside the string are skipped.
  assert.equal(e.objEnd(s, 0), s.length - 1);
});

test('findObjectEnd: returns -1 for an object that never balances', () => {
  const e = freshEngine();
  assert.equal(e.objEnd('{"a":1', 0), -1);
});

test('recoverTruncatedJson: a clean, balanced object is returned unchanged', () => {
  const e = freshEngine();
  const s = '{"a":1}';
  assert.equal(e.recover(s), s);
});

test('recoverTruncatedJson: non-object input (not starting with "{") returns null', () => {
  const e = freshEngine();
  assert.equal(e.recover('[1,2,3'), null);
  assert.equal(e.recover(''), null);
});

test('recoverTruncatedJson: closes an array+object truncated after a complete element', () => {
  const e = freshEngine();
  const s = '{"entities":[{"name":"Ann"},{"name":"Bob"},{"name":"Ca';
  const recovered = e.recover(s);
  assert.ok(recovered, 'expected a recovery string');
  const parsed = JSON.parse(recovered!);
  assert.deepEqual(parsed.entities.map((x: any) => x.name), ['Ann', 'Bob']);
});

// ════════════════════════════════════════════════════════════
// (b) getRelevantContext — budget + selection
// ════════════════════════════════════════════════════════════

/** Seed the engine's in-memory context for `projectId` and return it for mutation. */
async function seed(e: ContextEngine, projectId: string): Promise<ProjectContext> {
  // loadContext on a fresh temp dir creates + caches an empty context and
  // returns that same reference — mutating it seeds getRelevantContext.
  return e.loadContext(projectId);
}

function summary(over: Partial<ProjectContext['summaries'][number]>): ProjectContext['summaries'][number] {
  return {
    chapterId: 'c1', chapterNumber: 1, title: 'T', summary: 'S',
    wordCount: 100, characters: [], locations: [], timelineMarker: '',
    plotThreads: [], endingState: 'end', ...over,
  };
}

function entity(over: Partial<ProjectContext['entities'][number]>): ProjectContext['entities'][number] {
  return {
    name: 'X', type: 'character', aliases: [], description: 'd',
    firstAppearance: 'c1', lastSeen: 'c1', attributes: {}, changes: [], ...over,
  };
}

test('getRelevantContext: empty context returns an empty string', async () => {
  const e = freshEngine();
  await seed(e, 'p');
  assert.equal(e.getRelevantContext('p', 'c1', 'anything', 5000), '');
});

test('getRelevantContext: includes the previous chapter summary as priority 1', async () => {
  const e = freshEngine();
  const ctx = await seed(e, 'p');
  ctx.summaries.push(summary({ chapterId: 'c1', chapterNumber: 1, title: 'Opening', endingState: 'A door opens.', summary: 'Chapter one happens.' }));
  ctx.summaries.push(summary({ chapterId: 'c2', chapterNumber: 2, title: 'Next' }));
  // Writing chapter 2 → previous chapter is c1.
  const out = e.getRelevantContext('p', 'c2', 'no entity names here', 5000);
  assert.match(out, /Previous Chapter: Opening/);
  assert.match(out, /A door opens\./);
});

test('getRelevantContext: with no current-index match, uses the LAST summary as previous', async () => {
  const e = freshEngine();
  const ctx = await seed(e, 'p');
  ctx.summaries.push(summary({ chapterId: 'c1', chapterNumber: 1, title: 'First', endingState: 'first end' }));
  ctx.summaries.push(summary({ chapterId: 'c2', chapterNumber: 2, title: 'Latest', endingState: 'latest end' }));
  // currentStepId is unknown (a brand-new step) → currentIdx -1 → falls back to last.
  const out = e.getRelevantContext('p', 'c-new', 'prompt', 5000);
  assert.match(out, /Previous Chapter: Latest/);
});

test('getRelevantContext: selects entities named in the prompt (and skips unnamed ones)', async () => {
  const e = freshEngine();
  const ctx = await seed(e, 'p');
  ctx.summaries.push(summary({ chapterId: 'c1', title: 'Ch1' }));
  ctx.entities.push(entity({ name: 'Marlow', type: 'character', description: 'the detective' }));
  ctx.entities.push(entity({ name: 'Vivian', type: 'character', description: 'the heiress' }));
  ctx.entities.push(entity({ name: 'Harbor District', type: 'location', description: 'foggy docks' }));
  const out = e.getRelevantContext('p', 'c2', 'Marlow walks into the Harbor District at dusk.', 5000);
  assert.match(out, /\*\*Marlow\*\*: the detective/);
  assert.match(out, /\*\*Harbor District\*\*: foggy docks/);
  assert.doesNotMatch(out, /Vivian/, 'an unmentioned character is not included');
});

test('getRelevantContext: entity matching is case-insensitive and uses aliases', async () => {
  const e = freshEngine();
  const ctx = await seed(e, 'p');
  ctx.summaries.push(summary({ chapterId: 'c1' }));
  ctx.entities.push(entity({ name: 'Elizabeth', aliases: ['Liz'], description: 'the lead' }));
  const out = e.getRelevantContext('p', 'c2', 'liz storms out of the room', 5000);
  assert.match(out, /\*\*Elizabeth\*\*: the lead/);
});

test('getRelevantContext: respects maxChars — the priority-1 block is truncated, not dropped', async () => {
  const e = freshEngine();
  const ctx = await seed(e, 'p');
  const longSummary = 'word '.repeat(400); // ~2000 chars
  ctx.summaries.push(summary({ chapterId: 'c1', title: 'Big', summary: longSummary, endingState: 'over' }));
  ctx.summaries.push(summary({ chapterId: 'c2', chapterNumber: 2, title: 'Cur' }));
  const maxChars = 120;
  const out = e.getRelevantContext('p', 'c2', 'prompt', maxChars);
  // Priority-1 context must never be silently omitted just because it overflows;
  // it is truncated to the budget instead.
  assert.ok(out.length > 0, 'priority-1 block should be present (truncated), not dropped');
  assert.ok(out.length <= maxChars, `output ${out.length} should be within maxChars ${maxChars}`);
  assert.match(out, /Story Context/);
});

test('getRelevantContext: a low budget drops the optional entity block entirely', async () => {
  const e = freshEngine();
  const ctx = await seed(e, 'p');
  ctx.summaries.push(summary({ chapterId: 'c1', title: 'A', summary: 'x'.repeat(80), endingState: 'e' }));
  ctx.summaries.push(summary({ chapterId: 'c2', chapterNumber: 2, title: 'B' }));
  ctx.entities.push(entity({ name: 'Marlow', description: 'd'.repeat(200) }));
  // Budget large enough for the (truncated) priority-1 header but too small for
  // the whole 200-char character block → addPart() rejects it (all-or-nothing).
  const out = e.getRelevantContext('p', 'c2', 'Marlow appears', 90);
  assert.doesNotMatch(out, /Key Characters in Scene/, 'oversized entity block is dropped, not truncated');
});

// Run-review B3: coerceAttributes folds off-shape AI `attributes` into a flat map.
test('coerceAttributes: passes a flat map through, stringifying non-string values', () => {
  assert.deepEqual(coerceAttributes({ mood: 'anxious', age: 34 }), { mood: 'anxious', age: '34' });
});

test('coerceAttributes: folds an array of {key,value} objects (the deepseek-v4-pro shape)', () => {
  const raw = [{ key: 'engaged', value: 'yes' }, { key: 'location', value: 'hospital' }];
  assert.deepEqual(coerceAttributes(raw), { engaged: 'yes', location: 'hospital' });
});

test('coerceAttributes: folds {name,value} objects and single-key {name:value} objects', () => {
  assert.deepEqual(coerceAttributes([{ name: 'rank', value: 'captain' }]), { rank: 'captain' });
  assert.deepEqual(coerceAttributes([{ hairColor: 'red' }, { eyeColor: 'green' }]), { hairColor: 'red', eyeColor: 'green' });
});

test('coerceAttributes: unusable input degrades to an empty map, never throws', () => {
  assert.deepEqual(coerceAttributes(null), {});
  assert.deepEqual(coerceAttributes('nope'), {});
  assert.deepEqual(coerceAttributes(undefined), {});
});
