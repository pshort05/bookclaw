// tests/unit/dialogue-parser.test.ts
//
// Ported from the AuthorAgent fork's dialogue-parser.test.ts (vitest) to this
// repo's node:test/node:assert convention. Covers the pure extraction /
// attribution primitives shared by character-voices.ts and audiobook-prep.ts.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SPEECH_VERBS,
  splitParagraphs,
  startsWithQuote,
  extractSpokenText,
  buildExplicitTagRegex,
  buildReverseTagRegex,
  matchSpeakerTag,
  buildNameLookup,
  escapeRegex,
} from '../../gateway/src/services/dialogue-parser.js';

describe('splitParagraphs', () => {
  test('splits on a single blank line', () => {
    const text = 'Para one.\n\nPara two.';
    assert.deepEqual(splitParagraphs(text), ['Para one.', 'Para two.']);
  });

  test('splits on multiple blank lines / extra whitespace between', () => {
    const text = 'Para one.\n\n\n   \nPara two.';
    assert.deepEqual(splitParagraphs(text), ['Para one.', 'Para two.']);
  });

  test('filters out empty/whitespace-only paragraphs', () => {
    const text = '\n\nPara one.\n\n\n\nPara two.\n\n   \n\n';
    assert.deepEqual(splitParagraphs(text), ['Para one.', 'Para two.']);
  });

  test('returns a single-element array for text with no blank lines', () => {
    const text = 'Just one paragraph with no breaks.';
    assert.deepEqual(splitParagraphs(text), [text]);
  });

  test('returns an empty array for empty input', () => {
    assert.deepEqual(splitParagraphs(''), []);
  });
});

describe('startsWithQuote', () => {
  test('detects a straight double quote', () => {
    assert.equal(startsWithQuote('"Hello," she said.'), true);
  });

  test('detects a curly opening quote (U+201C)', () => {
    assert.equal(startsWithQuote('“Hello,” she said.'), true);
  });

  test('detects a curly closing-style quote used as opener (U+201D)', () => {
    assert.equal(startsWithQuote('”Hello.'), true);
  });

  test('returns false for narration with no leading quote', () => {
    assert.equal(startsWithQuote('She walked to the door.'), false);
  });

  test('returns false when the quote is not the first character', () => {
    assert.equal(startsWithQuote('She said, "Hello."'), false);
  });
});

describe('extractSpokenText', () => {
  test('extracts a single quoted segment, stripping the quote marks', () => {
    assert.equal(extractSpokenText('"Hello there," she said.'), 'Hello there,');
  });

  test('extracts and joins multiple quoted segments in one paragraph', () => {
    const para = '"Hello," she said. "How are you?"';
    assert.equal(extractSpokenText(para), 'Hello, How are you?');
  });

  test('handles curly quotes', () => {
    const para = '“Hello there,” she said.';
    assert.equal(extractSpokenText(para), 'Hello there,');
  });

  test('returns empty string when there is no quoted text', () => {
    assert.equal(extractSpokenText('She walked to the door.'), '');
  });

  test('does not let a leading empty-quote pair swallow the next real line', () => {
    // Regression guard: extractSpokenText requires a non-space, non-quote
    // char between the quotes, so the whitespace-only pair `"  "` no longer
    // matches and consumes the opening quote of the following real line.
    const para = '""  "Real line."';
    assert.equal(extractSpokenText(para), 'Real line.');
  });

  test('filters out an empty quoted segment when it is the only segment', () => {
    const para = '""';
    assert.equal(extractSpokenText(para), '');
  });
});

describe('buildExplicitTagRegex / buildReverseTagRegex / matchSpeakerTag', () => {
  test('matches an explicit tag: quote then Name said', () => {
    const para = '"I refuse," Sarah said.';
    const result = matchSpeakerTag(para);
    assert.deepEqual(result, { name: 'Sarah', matchedVia: 'explicit' });
  });

  test('matches an explicit tag with a two-word name', () => {
    const para = '"I refuse," Sarah Connor said.';
    const result = matchSpeakerTag(para);
    assert.deepEqual(result, { name: 'Sarah Connor', matchedVia: 'explicit' });
  });

  test('matches an explicit tag using a non-"said" verb from the default list', () => {
    const para = '"Get down!" John shouted.';
    const result = matchSpeakerTag(para);
    assert.deepEqual(result, { name: 'John', matchedVia: 'explicit' });
  });

  test('matches a reverse tag: said Name, when no explicit tag is present', () => {
    const para = 'From across the room, said Marcus, unheard by anyone.';
    const result = matchSpeakerTag(para);
    // No quote-adjacent explicit tag exists here, so reverse tag should fire.
    assert.deepEqual(result, { name: 'Marcus', matchedVia: 'reverse' });
  });

  test('prefers explicit over reverse when both could plausibly match', () => {
    const para = '"Wait," Alice said. Bob then whispered something back.';
    const result = matchSpeakerTag(para);
    assert.equal(result?.matchedVia, 'explicit');
    assert.equal(result?.name, 'Alice');
  });

  test('returns null when neither explicit nor reverse tag matches', () => {
    const para = 'The room was silent and empty.';
    assert.equal(matchSpeakerTag(para), null);
  });

  test('respects a custom speechVerbs option', () => {
    const para = '"Onward!" Rex declared.';
    // "declared" is not in DEFAULT_SPEECH_VERBS, so default matching should fail...
    assert.equal(matchSpeakerTag(para), null);
    // ...but succeed once we pass it as a custom verb.
    const result = matchSpeakerTag(para, { speechVerbs: ['declared'] });
    assert.deepEqual(result, { name: 'Rex', matchedVia: 'explicit' });
  });

  test('reverseQuoteAnchored refuses to attribute a spoken line to a later addressee', () => {
    // Marcus is the ADDRESSEE, not the speaker; the speech verb "said" is not
    // quote-adjacent. Unanchored reverse matching mis-attributes the line to
    // Marcus; the quote-anchored mode (character-voices) must not. Explicit
    // matching fails here (no capitalized name + speech verb after the quote).
    const para = '"Enough." She frowned, then said Marcus should leave.';
    const unanchored = matchSpeakerTag(para);
    assert.equal(unanchored?.matchedVia, 'reverse');
    assert.ok(unanchored?.name?.includes('Marcus'), 'unanchored reverse grabs the addressee Marcus');
    const anchored = matchSpeakerTag(para, { reverseQuoteAnchored: true });
    assert.ok(!anchored?.name?.includes('Marcus'), 'quote-anchored mode must not attribute to the addressee');
  });

  test('reverseQuoteAnchored still matches a genuine post-quote reverse tag', () => {
    const para = '"Run," whispered Sarah.';
    const anchored = matchSpeakerTag(para, { reverseQuoteAnchored: true });
    assert.deepEqual(anchored, { name: 'Sarah', matchedVia: 'reverse' });
  });

  test('buildExplicitTagRegex embeds all default speech verbs', () => {
    const re = buildExplicitTagRegex();
    for (const verb of DEFAULT_SPEECH_VERBS) {
      assert.ok(re.source.includes(verb));
    }
  });

  test('buildReverseTagRegex embeds all default speech verbs', () => {
    const re = buildReverseTagRegex();
    for (const verb of DEFAULT_SPEECH_VERBS) {
      assert.ok(re.source.includes(verb));
    }
  });
});

describe('buildNameLookup', () => {
  test('maps lowercase names to their canonical form', () => {
    const lookup = buildNameLookup(['Sarah', 'Bob']);
    assert.equal(lookup.get('sarah'), 'Sarah');
    assert.equal(lookup.get('bob'), 'Bob');
  });

  test('trims whitespace for both the lookup KEY and the stored canonical VALUE', () => {
    // Regression guard: buildNameLookup stores the trimmed canonical name,
    // so a name with stray whitespace is reachable by its trimmed lowercase
    // key AND returns the clean canonical name to callers.
    const lookup = buildNameLookup(['  Sarah  ']);
    assert.equal(lookup.get('sarah'), 'Sarah');
  });

  test('skips empty names', () => {
    const lookup = buildNameLookup(['', '   ', 'Bob']);
    assert.equal(lookup.size, 1);
    assert.equal(lookup.get('bob'), 'Bob');
  });

  test('adds aliases mapped to their canonical name', () => {
    const lookup = buildNameLookup(['Sarah'], { Sarah: ['Sar', 'Sarah Connor'] });
    assert.equal(lookup.get('sar'), 'Sarah');
    assert.equal(lookup.get('sarah connor'), 'Sarah');
    assert.equal(lookup.get('sarah'), 'Sarah');
  });

  test('handles multiple characters with multiple aliases each', () => {
    const lookup = buildNameLookup(
      ['Sarah', 'Bob'],
      { Sarah: ['Sar'], Bob: ['Bobby', 'Robert'] },
    );
    assert.equal(lookup.get('sar'), 'Sarah');
    assert.equal(lookup.get('bobby'), 'Bob');
    assert.equal(lookup.get('robert'), 'Bob');
  });
});

describe('escapeRegex', () => {
  test('escapes regex special characters', () => {
    assert.equal(escapeRegex('a.b*c?d'), 'a\\.b\\*c\\?d');
  });

  test('leaves plain alphanumeric text unchanged', () => {
    assert.equal(escapeRegex('plainText123'), 'plainText123');
  });

  test('produces a string usable as a literal match in a RegExp', () => {
    const raw = '1 + 1 = 2?';
    const re = new RegExp(escapeRegex(raw));
    assert.ok(re.test(`prefix ${raw} suffix`));
  });
});
