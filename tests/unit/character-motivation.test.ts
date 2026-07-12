/**
 * Unit tests for gateway/src/services/character-motivation.ts.
 *
 * Two layers under test:
 *   1. `buildCharacterMotivationBrief(entity)` — pure rendering of an
 *      EntityEntry's attributes + arc (change-log). No AI, no I/O.
 *   2. `critiqueMotivation(...)` — dialogue extraction (bucketed per
 *      character) + one 'style_analysis' AI call per eligible character,
 *      driven here by a FAKE aiComplete/aiSelectProvider (no network).
 *      Covers: JSON parsing into flags, malformed-JSON fail-soft to [],
 *      MIN_LINES_FOR_CRITIQUE / MAX_CHARACTERS_PER_RUN caps.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CharacterMotivationService,
  type CharacterMotivationFlag,
} from '../../gateway/src/services/character-motivation.js';
import type { EntityEntry } from '../../gateway/src/services/context-engine.js';

const selectProvider = (_taskType: string) => ({ id: 'stub-provider' });

function makeEntity(overrides: Partial<EntityEntry> = {}): EntityEntry {
  return {
    name: 'Alice',
    type: 'character',
    aliases: [],
    description: '',
    firstAppearance: 'ch-1',
    lastSeen: 'ch-1',
    attributes: {},
    changes: [],
    ...overrides,
  };
}

// ── buildCharacterMotivationBrief (pure) ────────────────────────────────────

test('buildCharacterMotivationBrief: renders name, aliases, description, attributes, and arc', () => {
  const svc = new CharacterMotivationService();
  const entity = makeEntity({
    name: 'Alice',
    aliases: ['Al'],
    description: 'A cautious locksmith.',
    attributes: { wants: 'to retire quietly', fear: 'being caught' },
    changes: [
      { chapterId: 'ch-1', description: 'Agrees to one last job.' },
      { chapterId: 'ch-3', description: 'Discovers the job is a trap.' },
    ],
  });

  const brief = svc.buildCharacterMotivationBrief(entity);

  assert.equal(brief.name, 'Alice');
  assert.deepEqual(brief.aliases, ['Al']);
  assert.equal(brief.description, 'A cautious locksmith.');
  assert.deepEqual(brief.attributes, { wants: 'to retire quietly', fear: 'being caught' });
  assert.deepEqual(brief.arc, [
    { chapterId: 'ch-1', description: 'Agrees to one last job.' },
    { chapterId: 'ch-3', description: 'Discovers the job is a trap.' },
  ]);
});

test('buildCharacterMotivationBrief: missing optional fields default to empty, not throw', () => {
  const svc = new CharacterMotivationService();
  const entity = makeEntity({ name: 'Bob', aliases: undefined as any, attributes: undefined as any, changes: undefined as any });

  const brief = svc.buildCharacterMotivationBrief(entity);

  assert.equal(brief.name, 'Bob');
  assert.deepEqual(brief.aliases, []);
  assert.deepEqual(brief.attributes, {});
  assert.deepEqual(brief.arc, []);
});

// ── critiqueMotivation: dialogue extraction + AI parsing ───────────────────

/** N tagged lines of dialogue for one speaker (3+ so the min-lines gate passes). */
function taggedLines(name: string, n: number, text = 'I will not do that'): string {
  const paras: string[] = [];
  for (let i = 0; i < n; i++) {
    paras.push(`"${text}, ${i}," said ${name}.`);
  }
  return paras.join('\n\n');
}

test('critiqueMotivation: parses AI JSON into flags for an eligible character', async () => {
  const svc = new CharacterMotivationService();
  const alice = makeEntity({
    name: 'Alice',
    attributes: { wants: 'to retire quietly' },
    changes: [{ chapterId: 'ch-1', description: 'Agrees to one last job.' }],
  });

  const aiComplete = async (_req: any) => ({
    text: JSON.stringify({
      flags: [
        { line: 'I will not do that, 0', reason: 'Contradicts her established caution.', suggestion: 'I cannot do that.' },
      ],
    }),
    tokensUsed: 10,
    estimatedCost: 0,
    provider: 'stub-provider',
  });

  const report = await svc.critiqueMotivation(
    { projectId: 'proj-1', chapterText: taggedLines('Alice', 3), chapterId: 'ch-1' },
    aiComplete,
    selectProvider,
    [alice],
    [],
  );

  assert.equal(report.projectId, 'proj-1');
  assert.equal(report.chapterId, 'ch-1');
  assert.deepEqual(report.charactersReviewed, ['Alice']);
  assert.equal(report.totalFlags, 1);
  assert.equal(report.byCharacter.length, 1);
  assert.equal(report.byCharacter[0].character, 'Alice');
  assert.equal(report.byCharacter[0].linesReviewed, 3);
  const flag: CharacterMotivationFlag = report.byCharacter[0].flags[0];
  assert.equal(flag.line, 'I will not do that, 0');
  assert.equal(flag.reason, 'Contradicts her established caution.');
  assert.equal(flag.suggestion, 'I cannot do that.');
});

test('critiqueMotivation: malformed AI JSON yields empty flags, does not throw', async () => {
  const svc = new CharacterMotivationService();
  const alice = makeEntity({ name: 'Alice' });

  const aiComplete = async (_req: any) => ({
    text: 'not json at all {{{',
    tokensUsed: 5,
    estimatedCost: 0,
    provider: 'stub-provider',
  });

  const report = await svc.critiqueMotivation(
    { projectId: 'proj-1', chapterText: taggedLines('Alice', 3) },
    aiComplete,
    selectProvider,
    [alice],
    [],
  );

  assert.equal(report.totalFlags, 0);
  assert.deepEqual(report.byCharacter[0].flags, []);
  assert.equal(report.byCharacter[0].character, 'Alice');
});

test('critiqueMotivation: empty AI response yields empty flags, does not throw', async () => {
  const svc = new CharacterMotivationService();
  const alice = makeEntity({ name: 'Alice' });

  const aiComplete = async (_req: any) => ({
    text: '',
    tokensUsed: 0,
    estimatedCost: 0,
    provider: 'stub-provider',
  });

  const report = await svc.critiqueMotivation(
    { projectId: 'proj-1', chapterText: taggedLines('Alice', 3) },
    aiComplete,
    selectProvider,
    [alice],
    [],
  );

  assert.deepEqual(report.byCharacter[0].flags, []);
});

test('critiqueMotivation: a character below MIN_LINES_FOR_CRITIQUE is skipped (no AI call)', async () => {
  const svc = new CharacterMotivationService();
  const alice = makeEntity({ name: 'Alice' });
  const bob = makeEntity({ name: 'Bob' });

  let callCount = 0;
  const aiComplete = async (_req: any) => {
    callCount++;
    return { text: JSON.stringify({ flags: [] }), tokensUsed: 1, estimatedCost: 0, provider: 'stub-provider' };
  };

  // Alice: 3 lines (eligible). Bob: 2 lines (below MIN_LINES_FOR_CRITIQUE=3).
  const chapterText = [taggedLines('Alice', 3), taggedLines('Bob', 2)].join('\n\n');

  const report = await svc.critiqueMotivation(
    { projectId: 'proj-1', chapterText },
    aiComplete,
    selectProvider,
    [alice, bob],
    [],
  );

  assert.deepEqual(report.charactersReviewed, ['Alice']);
  assert.equal(callCount, 1);
});

test('critiqueMotivation: respects MAX_CHARACTERS_PER_RUN cap, prioritizing more lines', async () => {
  const svc = new CharacterMotivationService();
  // 6 characters, each with enough lines to be eligible, but only the top 5
  // by line count should get an AI call (MAX_CHARACTERS_PER_RUN=5). Names
  // need 3+ letters to match the speaker-tag regex ([A-Z][a-z]{2,}).
  const names = ['Ann', 'Bea', 'Cid', 'Dee', 'Eli', 'Fay'];
  const entities = names.map((n) => makeEntity({ name: n }));

  let callCount = 0;
  const aiComplete = async (_req: any) => {
    callCount++;
    return { text: JSON.stringify({ flags: [] }), tokensUsed: 1, estimatedCost: 0, provider: 'stub-provider' };
  };

  // Give each character a distinct, descending line count (9,8,7,6,5,4) so
  // ranking is unambiguous and all clear the MIN_LINES_FOR_CRITIQUE=3 floor.
  const chapterText = names
    .map((n, i) => taggedLines(n, 9 - i))
    .join('\n\n');

  const report = await svc.critiqueMotivation(
    { projectId: 'proj-1', chapterText },
    aiComplete,
    selectProvider,
    entities,
    [],
  );

  assert.equal(callCount, 5);
  assert.equal(report.charactersReviewed.length, 5);
  assert.deepEqual(report.charactersReviewed, ['Ann', 'Bea', 'Cid', 'Dee', 'Eli']);
});

test('critiqueMotivation: a character contradicting established wants/arc yields a flag', async () => {
  const svc = new CharacterMotivationService();
  const alice = makeEntity({
    name: 'Alice',
    attributes: { wants: 'to protect her sister at any cost' },
    changes: [{ chapterId: 'ch-2', description: 'Vows to never abandon her sister.' }],
  });

  // Fake coach: inspects the brief text it was given and flags a line that
  // clashes with the established "protect her sister" motivation.
  const aiComplete = async (req: any) => {
    const userContent = String(req.messages?.[0]?.content ?? '');
    assert.match(userContent, /protect her sister at any cost/);
    assert.match(userContent, /Vows to never abandon her sister/);
    return {
      text: JSON.stringify({
        flags: [
          {
            line: 'I will not do that, 0',
            reason: "Alice abandoning her sister contradicts her established motivation to protect her at any cost.",
            suggestion: 'I have to go back for her.',
          },
        ],
      }),
      tokensUsed: 20,
      estimatedCost: 0,
      provider: 'stub-provider',
    };
  };

  const report = await svc.critiqueMotivation(
    { projectId: 'proj-1', chapterText: taggedLines('Alice', 3) },
    aiComplete,
    selectProvider,
    [alice],
    [],
  );

  assert.equal(report.totalFlags, 1);
  assert.match(report.byCharacter[0].flags[0].reason, /contradicts her established motivation/);
});
