// tests/unit/extractor-value-norm.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseExtractorResponse, normalizeFactValue } from '../../gateway/src/services/consistency/extractor.js';

/** Build a one-fact extractor response around the given value fields. */
function factResponse(value: { valueRaw?: unknown; valueNorm?: unknown }): string {
  return JSON.stringify({
    scenes: [{ timeLabel: 'that evening', canonical: true }],
    facts: [
      {
        entity: 'AssIst',
        aliases: ['AssIst'],
        attribute: 'current_location',
        type: 'stateful',
        ...value,
        scene: 0,
        transition: null,
        evidence: 'the sixth floor office',
      },
    ],
  });
}

/** The single fact's computed valueNorm for a given raw/supplied pair. */
function normOf(value: { valueRaw?: unknown; valueNorm?: unknown }): string {
  return parseExtractorResponse(factResponse(value), 0).facts[0].valueNorm;
}

const LOCATION = 'sixth floor, West 22nd Street off Fifth Avenue, Flatiron District, Manhattan';

test('regression: values differing only by trailing punctuation / whitespace / NBSP / curly apostrophe normalise identically', () => {
  const baseline = normOf({ valueRaw: LOCATION });

  // Trailing sentence period — the chapter-2 vs chapter-1 contradiction on Firefly Pond.
  assert.equal(normOf({ valueRaw: `${LOCATION}.` }), baseline, 'trailing period');
  // Other trailing sentence punctuation.
  assert.equal(normOf({ valueRaw: `${LOCATION},` }), baseline, 'trailing comma');
  assert.equal(normOf({ valueRaw: `${LOCATION}!` }), baseline, 'trailing bang');
  // Doubled internal whitespace / newline / tab.
  assert.equal(normOf({ valueRaw: LOCATION.replace('floor, West', 'floor,  West') }), baseline, 'doubled space');
  assert.equal(normOf({ valueRaw: LOCATION.replace('floor, West', 'floor,\nWest') }), baseline, 'newline');
  // Non-breaking space.
  assert.equal(normOf({ valueRaw: LOCATION.replace('floor, West', 'floor, West') }), baseline, 'nbsp');
  // Leading/trailing whitespace.
  assert.equal(normOf({ valueRaw: `  ${LOCATION}  ` }), baseline, 'outer whitespace');
  // Case.
  assert.equal(normOf({ valueRaw: LOCATION.toUpperCase() }), baseline, 'case');

  // Curly vs straight apostrophe, and curly vs straight quotes.
  assert.equal(
    normalizeFactValue('Maya’s office'),
    normalizeFactValue("Maya's office"),
    'curly apostrophe',
  );
  assert.equal(
    normalizeFactValue('the “red room”'),
    normalizeFactValue('the "red room"'),
    'curly quotes',
  );
  // En/em dash vs hyphen.
  assert.equal(normalizeFactValue('sixth–floor'), normalizeFactValue('sixth-floor'), 'en dash');
  assert.equal(normalizeFactValue('sixth—floor'), normalizeFactValue('sixth-floor'), 'em dash');
  // Full-width / decomposed forms converge via NFKC.
  assert.equal(normalizeFactValue('Ｒoom ２２'), normalizeFactValue('room 22'), 'full-width');
  assert.equal(normalizeFactValue('café'), normalizeFactValue('café'), 'decomposed accent');
});

test('an LLM-supplied valueNorm is normalised too (not taken verbatim)', () => {
  const fallback = normOf({ valueRaw: LOCATION });
  const supplied = normOf({ valueRaw: 'somewhere else entirely', valueNorm: `  ${LOCATION.replace('sixth floor', 'Sixth  Floor')}.  ` });
  assert.equal(supplied, fallback);

  // Short-form case from the prompt spec: "Sixth Floor, West 22nd Street." → same as the raw text.
  assert.equal(
    normOf({ valueRaw: 'sixth floor, west 22nd street' }),
    normOf({ valueRaw: 'ignored', valueNorm: 'Sixth Floor, West 22nd Street.' }),
  );
});

test('a value the model wrapped in quotes/parens folds to the bare value', () => {
  const bare = normalizeFactValue('the office');
  assert.equal(normalizeFactValue('"the office."'), bare, 'quoted + trailing period');
  assert.equal(normalizeFactValue('“the office”'), bare, 'curly quoted');
  assert.equal(normalizeFactValue("'the office'"), bare, 'single quoted');
  assert.equal(normalizeFactValue('(the office)'), bare, 'parenthesised');
  assert.equal(normalizeFactValue('[the office]'), bare, 'bracketed');
  assert.equal(normalizeFactValue('("the office").'), bare, 'nested wrappers + period');

  // Zero-width / invisible characters are stripped: two values that render
  // identically must not compare as different.
  assert.equal(normalizeFactValue('the​office'), normalizeFactValue('theoffice'), 'ZWSP');
  assert.equal(normalizeFactValue('﻿the office'), bare, 'BOM');

  // But a wrapper that does NOT enclose the whole value is left alone.
  assert.notEqual(normalizeFactValue('"a" and "b"'), normalizeFactValue('a and b'));
  assert.equal(normalizeFactValue("maya's office"), "maya's office", 'apostrophe untouched');
});

test('genuinely different values stay different', () => {
  const pairs: [string, string][] = [
    ['green', 'blue'],
    ['sixth floor', 'seventh floor'],
    ['22nd Street', '23rd Street'],
    ['Maya', "Maya's sister"],
    ['the office', 'the offices'],
    ['room 12', 'room 21'],
    ['not injured', 'injured'],
    ['west 22nd street', 'east 22nd street'],
  ];
  for (const [a, b] of pairs) {
    assert.notEqual(normalizeFactValue(a), normalizeFactValue(b), `${a} vs ${b}`);
    assert.notEqual(normOf({ valueRaw: a }), normOf({ valueRaw: b }), `${a} vs ${b} (via parse)`);
  }
  // Interior punctuation is NOT stripped — it can carry meaning.
  assert.notEqual(normalizeFactValue('dr. wells'), normalizeFactValue('dr wells'));
});

test('empty / missing / non-string values are handled without throwing', () => {
  assert.equal(normalizeFactValue(undefined), '');
  assert.equal(normalizeFactValue(null), '');
  assert.equal(normalizeFactValue(42), '');
  assert.equal(normalizeFactValue({}), '');
  assert.equal(normalizeFactValue(''), '');
  assert.equal(normalizeFactValue('   '), '');
  assert.equal(normalizeFactValue('...'), '');

  assert.equal(normOf({}), '');
  assert.equal(normOf({ valueRaw: '' }), '');
  assert.equal(normOf({ valueRaw: null }), '');
  assert.equal(normOf({ valueRaw: 42 }), '');
  assert.equal(normOf({ valueRaw: 'blue', valueNorm: 42 }), 'blue', 'non-string supplied norm falls back to raw');
  assert.equal(normOf({ valueRaw: 'blue', valueNorm: '  ' }), 'blue', 'blank supplied norm falls back to raw');
});

/** Build an extractor response with explicit scenes / facts / knowledgeEvents. */
function response(body: {
  scenes?: unknown;
  facts?: unknown[];
  knowledgeEvents?: unknown[];
}): string {
  return JSON.stringify({
    scenes: body.scenes ?? [{ timeLabel: null, canonical: true }],
    facts: body.facts ?? [],
    knowledgeEvents: body.knowledgeEvents ?? [],
  });
}

test('regression: acquire and use of the same fact produce the SAME factKey despite punctuation/case', () => {
  // Verbatim reproduction: one extractor response where the acquire carries
  // "The Affair." and the use carries "the affair" — the same concept. Before
  // the fix these produced `Maya\0secret\0the affair.` vs `Maya\0secret\0the
  // affair` and check-engine reported a high-severity fabricated
  // knowledge-violation ("learns it at no point in the story").
  const parsed = parseExtractorResponse(
    response({
      scenes: [
        { timeLabel: 'that evening', canonical: true },
        { timeLabel: 'the next day', canonical: true },
      ],
      knowledgeEvents: [
        {
          knower: 'Jay', factEntity: 'Maya', factAttribute: 'secret',
          factValueNorm: 'The Affair.', kind: 'acquire', source: 'told',
          scene: 0, evidence: 'she told him everything',
        },
        {
          knower: 'Jay', factEntity: 'Maya', factAttribute: 'secret',
          factValueNorm: 'the affair', kind: 'use', source: 'reference',
          scene: 1, evidence: 'he mentioned the affair',
        },
      ],
    }),
    5000,
  );

  const [acquire, use] = parsed.knowledge;
  assert.equal(acquire.factKey, use.factKey, 'acquire and use must share one canonical key');
  assert.equal(acquire.factKey, 'Maya\0secret\0the affair');

  // check-engine groups by `${knower} ${factKey}` and clears a use when a
  // canonical acquire exists at an earlier-or-equal storyTime. Asserted here
  // rather than importing evaluateKnowledge so this test stays confined to the
  // extractor. Same-key + ordered acquire => no fabricated violation.
  assert.equal(`${acquire.knower} ${acquire.factKey}`, `${use.knower} ${use.factKey}`);
  assert.ok(acquire.canonical);
  assert.ok(acquire.storyTime <= use.storyTime);
});

test('facts and knowledge derive the same canonical key segment for the same value', () => {
  const parsed = parseExtractorResponse(
    response({
      facts: [
        {
          entity: 'Maya', aliases: ['Maya'], attribute: 'secret', type: 'stateful',
          valueRaw: 'The Affair.', scene: 0, transition: null, evidence: 'the affair',
        },
      ],
      knowledgeEvents: [
        {
          knower: 'Jay', factEntity: 'Maya', factAttribute: 'secret',
          factValueNorm: '  THE   Affair!  ', kind: 'use', source: 'reference',
          scene: 0, evidence: 'he mentioned it',
        },
      ],
    }),
    0,
  );

  const fact = parsed.facts[0];
  const factKeyFromFacts = `${fact.entity}\0${fact.attribute}\0${fact.valueNorm}`;
  assert.equal(parsed.knowledge[0].factKey, factKeyFromFacts);
});

test('scene indexes are coerced to non-negative integers and clamped, even when scenes is empty', () => {
  const BASE = 1000;
  const cases: [unknown, number][] = [
    [1500, 999],   // above the 1000-wide chapter band → clamped to the top of its own band
    [-4, 0],       // negative → below its own band
    ['2', 2],      // string → must not concatenate into a string storyTime
    [null, 0],
    [2.7, 2],      // fractional → integer
    ['nonsense', 0],
    [undefined, 0],
  ];

  for (const [scene, expected] of cases) {
    const parsed = parseExtractorResponse(
      response({
        scenes: [],
        facts: [
          {
            entity: 'Maya', aliases: ['Maya'], attribute: 'current_location',
            type: 'stateful', valueRaw: 'the office', scene,
            transition: null, evidence: 'the office',
          },
        ],
        knowledgeEvents: [
          {
            knower: 'Jay', factEntity: 'Maya', factAttribute: 'current_location',
            factValueNorm: 'the office', kind: 'use', source: 'reference',
            scene, evidence: 'he went there',
          },
        ],
      }),
      BASE,
    );

    for (const got of [parsed.facts[0], parsed.knowledge[0]]) {
      const label = `${JSON.stringify(scene)} (${'aliases' in got ? 'fact' : 'knowledge'})`;
      assert.equal(typeof got.scene, 'number', `${label}: scene is a number`);
      assert.equal(typeof got.storyTime, 'number', `${label}: storyTime is a number`);
      assert.ok(Number.isInteger(got.storyTime), `${label}: storyTime is an integer`);
      assert.equal(got.scene, expected, `${label}: scene`);
      assert.equal(got.storyTime, BASE + expected, `${label}: storyTime`);
      assert.ok(
        got.storyTime >= BASE && got.storyTime < BASE + 1000,
        `${label}: storyTime inside the chapter band`,
      );
    }
  }
});

test('scene indexes still clamp to the scene list when scenes are present', () => {
  const parsed = parseExtractorResponse(
    response({
      scenes: [
        { timeLabel: 'morning', canonical: true },
        { timeLabel: 'night', canonical: false },
      ],
      facts: [
        {
          entity: 'Maya', aliases: ['Maya'], attribute: 'current_location', type: 'stateful',
          valueRaw: 'the office', scene: 9, transition: null, evidence: 'the office',
        },
      ],
      knowledgeEvents: [
        {
          knower: 'Jay', factEntity: 'Maya', factAttribute: 'current_location',
          factValueNorm: 'the office', kind: 'use', source: 'reference',
          scene: 9, evidence: 'he went there',
        },
      ],
    }),
    1000,
  );
  assert.equal(parsed.facts[0].scene, 1);
  assert.equal(parsed.facts[0].timeLabel, 'night');
  assert.equal(parsed.facts[0].canonical, false);
  assert.equal(parsed.knowledge[0].scene, 1);
  assert.equal(parsed.knowledge[0].canonical, false);
});

test('the normaliser is idempotent', () => {
  const samples = [
    LOCATION,
    `${LOCATION}.`,
    '  Sixth  Floor,  West 22nd Street!  ',
    'Maya’s “red room” — upstairs.',
    'Ｒoom ２２',
    '',
    '...',
    '("the office").',
    '"',
    '""',
    '(())',
  ];
  for (const s of samples) {
    const once = normalizeFactValue(s);
    assert.equal(normalizeFactValue(once), once, JSON.stringify(s));
  }
});
