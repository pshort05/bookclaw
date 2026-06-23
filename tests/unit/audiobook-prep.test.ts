import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AudiobookPrepService,
  PronunciationDictionary,
} from '../../gateway/src/services/audiobook-prep.js';

const svc = new AudiobookPrepService();

// ── cleanupScript ──

test('cleanupScript normalizes dashes, ellipses, symbols, and abbreviations and counts changes', () => {
  const r = svc.cleanupScript('Wait—stop. He said 50% of it... Mr. Smith & Co.');
  assert.equal(r.cleanedText, 'Wait — stop. He said 50 percent of it…  Mister Smith and Co.');
  // 5 transformations: em-dash, ellipsis, %->percent, &->and, Mr.->Mister.
  assert.equal(r.changes, 5);
});

test('cleanupScript flags a long parenthetical for human review', () => {
  const para = 'Some text (this is a very long parenthetical aside that runs well past thirty characters).';
  const r = svc.cleanupScript(para);
  assert.ok(r.flaggedPassages.some(p => /Long parenthetical/.test(p.reason)));
});

test('cleanupScript flags same-gender pronoun ambiguity with 2+ proper nouns', () => {
  const para = 'He saw Marcus. He told Aldric something. He waited there in silence.';
  const r = svc.cleanupScript(para);
  assert.ok(r.flaggedPassages.some(p => /same-gender pronouns/.test(p.reason)));
});

// ── buildPronunciationDictionary ──

test('buildPronunciationDictionary drops common names, keeps uncommon, counts appearances, sorts desc', () => {
  const entities = [
    { name: 'John', type: 'character', aliases: [], description: 'common' },
    { name: 'Zhang Wei', type: 'character', aliases: ['Wei'], description: 'a hero of the realm here' },
    { name: 'Aldebaran', type: 'location', aliases: [], description: '' },
  ];
  const fullText = 'Aldebaran Aldebaran Aldebaran Zhang Wei John John John John';
  const dict = svc.buildPronunciationDictionary('p1', entities, fullText);

  // 'John' is common => excluded. Remaining sorted by appearance count desc.
  assert.deepEqual(
    dict.entries.map(e => [e.name, e.appearances]),
    [['Aldebaran', 3], ['Zhang Wei', 1]],
  );
  assert.equal(dict.projectId, 'p1');
});

test('buildPronunciationDictionary coerces an unknown entity type to "item"', () => {
  const dict = svc.buildPronunciationDictionary(
    'p1',
    [{ name: 'Vornak', type: 'weird-type', aliases: [], description: '' }],
    'Vornak',
  );
  assert.equal(dict.entries[0].type, 'item');
});

// ── buildSSML ──

test('buildSSML estimates duration at 150 wpm and includes the AI-disclosure comment when disclosed', () => {
  const words = Array(300).fill('word').join(' ');
  const r = svc.buildSSML(
    [{ number: 1, title: 'Start & End', text: words }],
    { projectId: 'p', generatedAt: 'x', entries: [] },
    true,
  );
  assert.equal(r.chapters[0].approxDurationSec, 120); // 300 / 150 * 60
  assert.equal(r.totalDurationSec, 120);
  assert.equal(r.disclosureIncluded, true);
  assert.ok(r.chapters[0].ssml.startsWith('<!-- This audiobook uses AI-generated narration.'));
  // Chapter title is XML-escaped.
  assert.ok(r.chapters[0].ssml.includes('Chapter 1. Start &amp; End.'));
});

test('buildSSML emits the reference-only comment when AI narration is NOT disclosed', () => {
  const r = svc.buildSSML(
    [{ number: 1, title: 'X', text: 'hello there' }],
    { projectId: 'p', generatedAt: 'x', entries: [] },
    false,
  );
  assert.equal(r.disclosureIncluded, false);
  assert.ok(r.chapters[0].ssml.startsWith('<!-- Reference SSML.'));
});

test('buildSSML wraps a name with a supplied IPA in a <phoneme> tag', () => {
  const dict: PronunciationDictionary = {
    projectId: 'p',
    generatedAt: 'x',
    entries: [
      { name: 'Aldric', type: 'character', aliases: [], appearances: 1, suggestedIPA: 'ˈɔːldrɪk' },
    ],
  };
  const r = svc.buildSSML([{ number: 1, title: 'C', text: 'Then Aldric spoke.' }], dict, false);
  assert.ok(r.chapters[0].ssml.includes('<phoneme alphabet="ipa" ph="ˈɔːldrɪk">Aldric</phoneme>'));
});

// ── attributeMultiVoice ──

test('attributeMultiVoice routes narration to narrator and attributes explicit/reverse tags', () => {
  const text = [
    'The room was dark.',
    '"Get out," Sarah whispered.',
    '"No," said Marcus.',
  ].join('\n\n');
  const r = svc.attributeMultiVoice({
    chapterNumber: 1,
    title: 'C1',
    text,
    characterNames: ['Sarah', 'Marcus'],
    voiceMap: { narratorVoice: 'narr', characterVoices: { Sarah: 'vs', Marcus: 'vm' } },
  });
  assert.equal(r.segments[0].speaker.kind, 'narrator');
  assert.equal(r.segments[0].voiceId, 'narr');
  assert.deepEqual(r.segments[1].speaker, { kind: 'character', name: 'Sarah' });
  assert.equal(r.segments[1].voiceId, 'vs');
  assert.equal(r.segments[1].inferred, false);
  assert.deepEqual(r.segments[2].speaker, { kind: 'character', name: 'Marcus' });
  assert.equal(r.segments[2].voiceId, 'vm');
});

test('attributeMultiVoice gives bare dialogue to the previous speaker, flagged as inferred', () => {
  const text = ['"No," said Marcus.', '"Why not?"'].join('\n\n');
  const r = svc.attributeMultiVoice({
    chapterNumber: 1,
    title: 'C',
    text,
    characterNames: ['Marcus'],
    voiceMap: { narratorVoice: 'narr', characterVoices: { Marcus: 'vm' } },
  });
  const bare = r.segments[1];
  assert.deepEqual(bare.speaker, { kind: 'character', name: 'Marcus' });
  assert.equal(bare.inferred, true);
});

test('attributeMultiVoice keeps an off-list speaker literal, flags inferred, and reports it unmapped', () => {
  const r = svc.attributeMultiVoice({
    chapterNumber: 1,
    title: 'C',
    text: '"Hi," Bob said.',
    characterNames: ['Sarah'],
    voiceMap: { narratorVoice: 'narr', characterVoices: { Sarah: 'vs' } },
  });
  assert.deepEqual(r.segments[0].speaker, { kind: 'character', name: 'Bob' });
  assert.equal(r.segments[0].inferred, true);
  // No default voice => falls back to narrator voice; still recorded as unmapped.
  assert.equal(r.segments[0].voiceId, 'narr');
  assert.deepEqual(r.unmappedSpeakers, ['Bob']);
});

// ── buildDefaultVoiceMap ──

test('buildDefaultVoiceMap assigns voices alphabetically, excluding the narrator voice', () => {
  const vm = svc.buildDefaultVoiceMap({
    characterNames: ['Zoe', 'Adam', 'Mike'],
    presetVoiceIds: ['v1', 'v2', 'v3', 'narr'],
    narratorVoice: 'narr',
  });
  assert.deepEqual(vm.characterVoices, { Adam: 'v1', Mike: 'v2', Zoe: 'v3' });
  assert.equal(vm.narratorVoice, 'narr');
  assert.equal(vm.defaultCharacterVoice, 'v1');
});

test('buildDefaultVoiceMap honors customVoices overrides and skips their voice ids', () => {
  const vm = svc.buildDefaultVoiceMap({
    characterNames: ['Adam', 'Mike'],
    presetVoiceIds: ['v1', 'v2', 'narr'],
    narratorVoice: 'narr',
    customVoices: { Adam: 'v2' },
  });
  assert.equal(vm.characterVoices.Adam, 'v2');
  // Mike takes the first available voice that isn't narrator and isn't already used (v2).
  assert.equal(vm.characterVoices.Mike, 'v1');
});
