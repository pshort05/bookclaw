import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCanonSheet, formatCanonSheet, collectCanonNouns, flagNewProperNouns, checkPovTense,
} from '../../gateway/src/services/pipeline/canon-sheet.js';

const JSON_SHEET = `Here is the sheet:
\`\`\`json
{
  "characters": [
    { "name": "Gia Ferraro", "aliases": ["Gia"], "age": 29, "role": "baker", "relationships": "sister of Francesca" },
    { "name": "Cole Kessler", "age": "31", "role": "café owner" }
  ],
  "povTense": "third-person limited, past tense",
  "places": ["Surf City", "Ferraro's Bakery"],
  "timeline": ["mid-June to Labor Day"]
}
\`\`\``;

test('parseCanonSheet extracts fenced JSON, keeps names/ages/places; fail-soft on junk', () => {
  const s = parseCanonSheet(JSON_SHEET)!;
  assert.equal(s.characters.length, 2);
  assert.equal(s.characters[0].name, 'Gia Ferraro');
  assert.equal(s.characters[0].age, '29');
  assert.deepEqual(s.characters[0].aliases, ['Gia']);
  assert.equal(s.povTense, 'third-person limited, past tense');
  assert.deepEqual(s.places, ['Surf City', "Ferraro's Bakery"]);
  assert.equal(parseCanonSheet('not json'), null);
  assert.equal(parseCanonSheet('{"characters": []}'), null); // no characters -> null
});

test('formatCanonSheet renders a compact, injectable block', () => {
  const block = formatCanonSheet(parseCanonSheet(JSON_SHEET)!);
  assert.match(block, /POV \/ tense: third-person limited, past tense/);
  assert.match(block, /Gia Ferraro, age 29, baker/);
  assert.match(block, /also: Gia/);
  assert.match(block, /Places: Surf City; Ferraro's Bakery/);
});

test('collectCanonNouns includes full names, tokens, and places (lowercased)', () => {
  const nouns = collectCanonNouns(parseCanonSheet(JSON_SHEET)!);
  for (const n of ['gia ferraro', 'gia', 'ferraro', 'cole', 'kessler', 'surf city', 'surf']) {
    assert.ok(nouns.has(n), `expected canon noun "${n}"`);
  }
});

test('checkPovTense flags a clear present→past slip, passes matching tense, ignores when no rule', () => {
  const past = 'I walked to the pond. He said nothing. She had left already. We were alone, and I felt the cold. He turned away. They looked back.';
  const present = 'I walk to the pond. He says nothing. She has left already. We are alone, and I feel the cold. He turns away. They look back.';
  assert.match(checkPovTense(past, 'first-person present tense')!, /PAST tense/);
  assert.equal(checkPovTense(present, 'first-person present tense'), null);
  assert.equal(checkPovTense(past, 'third-person limited, past tense'), null); // past text, past rule → ok
  assert.equal(checkPovTense(past, undefined), null); // no rule → null
});

test('flagNewProperNouns flags invented characters, not canon ones or sentence starters', () => {
  const canon = collectCanonNouns(parseCanonSheet(JSON_SHEET)!);
  const chapter = [
    'Cole watched Gia frost the cake.',            // Cole, Gia -> canon
    'Denny Alvarez walked in from the back.',       // multi-word new -> flag
    'The Millers had approached Cole about the sale.', // "The Millers" -> flag "Millers"
    'Later, Gia introduced Deja to the new hire in Surf City.', // "Later" sentence-initial -> skip; Deja mid-sentence -> flag; Surf City canon
  ].join(' ');
  const flags = flagNewProperNouns(chapter, canon);
  assert.ok(flags.includes('Denny Alvarez'), 'Denny Alvarez flagged');
  assert.ok(flags.includes('Millers'), 'Millers flagged (leading "The" trimmed)');
  assert.ok(flags.includes('Deja'), 'Deja flagged (mid-sentence)');
  assert.ok(!flags.some((f) => /Gia|Cole|Surf/.test(f)), 'no canon names flagged');
  assert.ok(!flags.includes('Later'), 'sentence-initial "Later" not flagged');
});

test('flagNewProperNouns ignores common Title-Case greetings/interjections (#4)', () => {
  const canon = collectCanonNouns(parseCanonSheet(JSON_SHEET)!);
  const chapter = 'Cole grinned. Good Morning, he said. Happy Birthday to you. Then Denny Alvarez walked in.';
  const flags = flagNewProperNouns(chapter, canon);
  assert.ok(!flags.includes('Good Morning'), '"Good Morning" not flagged');
  assert.ok(!flags.includes('Happy Birthday'), '"Happy Birthday" not flagged');
  assert.ok(flags.includes('Denny Alvarez'), 'a real new name is still flagged');
});
