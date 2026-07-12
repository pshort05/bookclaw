// tests/unit/character-voices.test.ts
//
// Characterization tests for CharacterVoicesService — the local (no-AI)
// dialogue extraction + speaker attribution + drift scoring. The parsing
// core (extractDialogue/canonicalize) is private, so we drive it through the
// public ingestChapter()/detectDrift(), wired with a real StyleCloneService
// and a throwaway temp workspace dir.
//
// Conventions exercised here (from extractDialogue):
//   - Paragraphs are split on blank lines; only those starting with a quote
//     are considered dialogue. Pure narration paragraphs are skipped.
//   - Explicit tag ("said Alice")  → confidence 0.9.
//   - Reverse tag ("replied Bob")  → confidence 0.85 (verb-then-name form).
//   - Bare quoted line after a known speaker → turn-taking, confidence 0.5.
//   - A tagged name NOT in the character list → confidence 0.3 (dropped at the
//     0.4 ingest/score threshold).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { readFile, writeFile } from 'fs/promises';
import { CharacterVoicesService } from '../../gateway/src/services/character-voices.js';
import { StyleCloneService } from '../../gateway/src/services/style-clone.js';

async function freshService(): Promise<{ svc: CharacterVoicesService; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'cv-test-'));
  const svc = new CharacterVoicesService(dir);
  svc.setStyleClone(new StyleCloneService());
  await svc.initialize();
  return { svc, dir };
}

function paras(...p: string[]): string {
  return p.join('\n\n');
}

// N copies of a tagged line for one speaker, period-terminated so the spoken
// text segments into sane sentences for the analyzer.
function repeated(n: number, spoken: string, who = 'Alice'): string {
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(`"${spoken}." said ${who}.`);
  return out.join('\n\n');
}

test('attributes explicit, reverse, and turn-taking speakers; skips unknown + narration', async () => {
  const { svc, dir } = await freshService();
  try {
    const chapter = paras(
      '"Hello there, my friend," said Alice.',          // explicit → Alice (0.9)
      '"And a fine morning to you," replied Bob.',      // reverse  → Bob (0.85)
      '"Did you sleep well at all?"',                   // bare → turn-taking to lastSpeaker (Bob, 0.5)
      '"Not really, no," said Alice.',                  // explicit → Alice
      'The narrator describes the room without quotes.',// narration → skipped entirely
      '"Quite the storm," murmured Mallory.',           // tagged but NOT in list → 0.3, dropped
    );
    const r = await svc.ingestChapter({
      projectId: 'p1',
      chapterNumber: 1,
      chapterText: chapter,
      characterNames: ['Alice', 'Bob'],
    });

    // 5 quoted paragraphs become lines (narration excluded); Mallory's line is
    // a line but is dropped from corpora by the <0.4 confidence filter.
    assert.equal(r.linesIngested, 5);
    assert.deepEqual(r.charactersTouched.sort(), ['Alice', 'Bob']);

    const store = await svc.getProjectVoices('p1');
    assert.deepEqual(Object.keys(store.characters).sort(), ['Alice', 'Bob']);
    // Alice: two explicit lines.
    assert.deepEqual(store.characters['Alice'].dialogueCorpus,
      ['Hello there, my friend,', 'Not really, no,']);
    // Bob: his explicit line + the bare turn-taking line.
    assert.deepEqual(store.characters['Bob'].dialogueCorpus,
      ['And a fine morning to you,', 'Did you sleep well at all?']);
    // Mallory never created (unknown name).
    assert.equal(store.characters['Mallory'], undefined);
    assert.equal(store.lastChapterAnalyzed, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('ingestChapter is idempotent on (projectId, chapterNumber)', async () => {
  const { svc, dir } = await freshService();
  try {
    const chapter = '"Once," said Alice.';
    const first = await svc.ingestChapter({
      projectId: 'idem', chapterNumber: 1, chapterText: chapter, characterNames: ['Alice'],
    });
    assert.equal(first.linesIngested, 1);
    // Re-running the same (or any <= last) chapter is a no-op.
    const second = await svc.ingestChapter({
      projectId: 'idem', chapterNumber: 1, chapterText: chapter, characterNames: ['Alice'],
    });
    assert.equal(second.linesIngested, 0);
    assert.deepEqual(second.charactersTouched, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('no fingerprint is built below the 300-word minimum', async () => {
  const { svc, dir } = await freshService();
  try {
    // ~6 words * 10 lines = 60 words — well under MIN_WORDS_FOR_FINGERPRINT.
    await svc.ingestChapter({
      projectId: 'small', chapterNumber: 1,
      chapterText: repeated(10, 'A short calm line of speech here'),
      characterNames: ['Alice'],
    });
    const store = await svc.getProjectVoices('small');
    assert.ok(store.characters['Alice'].dialogueWordCount < 300);
    assert.equal(store.characters['Alice'].fingerprint, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a fingerprint is built once dialogue crosses the 300-word threshold', async () => {
  const { svc, dir } = await freshService();
  try {
    // 13 words/line * 30 lines = 390 words ⇒ over the 300 minimum.
    const base = 'I walked along the quiet road and watched the calm grey morning light';
    await svc.ingestChapter({
      projectId: 'fp', chapterNumber: 1,
      chapterText: repeated(30, base), characterNames: ['Alice'],
    });
    const v = (await svc.getProjectVoices('fp')).characters['Alice'];
    assert.equal(v.dialogueWordCount, 390);
    assert.ok(v.fingerprint, 'expected a fingerprint to be built');
    assert.equal(v.fingerprintBuiltAtWordCount, 390);
    // Baseline markers are contraction-free and period-segmented.
    assert.equal(v.fingerprint!.markers.contractionRate, 0);
    assert.equal(v.fingerprint!.markers.avgSentenceLength, 13);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('detectDrift flags markers that exceed 2x tolerance and scores the chapter', async () => {
  const { svc, dir } = await freshService();
  try {
    // Baseline: calm, contraction-free, no internal punctuation.
    const base = 'I walked along the quiet road and watched the calm grey morning light';
    await svc.ingestChapter({
      projectId: 'd', chapterNumber: 1,
      chapterText: repeated(30, base), characterNames: ['Alice'],
    });

    // Drift chapter: contraction-heavy, short fragments, adverb. Same line x8 so
    // the resulting score is deterministic. ~15 words/line * 8 = 120 words (>50).
    const driftLine = "I can't and I won't and you shouldn't either honestly. It's wrong. Don't you dare.";
    const driftChapter = (() => {
      const o: string[] = [];
      for (let i = 0; i < 8; i++) o.push(`"${driftLine}" said Alice.`);
      return o.join('\n\n');
    })();

    const rep = await svc.detectDrift({
      projectId: 'd', chapterNumber: 2,
      chapterText: driftChapter, characterNames: ['Alice'],
    });

    assert.equal(rep.characters.length, 1);
    const c = rep.characters[0];
    assert.equal(c.name, 'Alice');
    assert.equal(c.wordsInChapter, 120);
    // Three markers blow past 2σ: contraction use, adverb use, sentence fragments.
    const flagged = c.flags.map(f => f.marker).sort();
    assert.deepEqual(flagged, ['adverb use', 'contraction use', 'sentence fragments']);
    // Drift score is a deterministic function of the per-marker z-sum.
    assert.equal(c.driftScore, 41);
    assert.equal(rep.overallDriftScore, 41);
    assert.equal(rep.summary, 'Chapter 2: 3 drift flags across 1 character.');
    // Each flag carries the baseline (expected) vs chapter (actual) values + an excerpt.
    const contractionFlag = c.flags.find(f => f.marker === 'contraction use')!;
    assert.equal(contractionFlag.expected, 0);
    assert.ok(contractionFlag.actual > 0);
    assert.ok(contractionFlag.zScore > 2);
    assert.ok(contractionFlag.excerpt.startsWith('"I can\'t'), contractionFlag.excerpt);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('detectDrift returns zero drift when the chapter matches the baseline', async () => {
  const { svc, dir } = await freshService();
  try {
    const base = 'I walked along the quiet road and watched the calm grey morning light';
    await svc.ingestChapter({
      projectId: 'nd', chapterNumber: 1,
      chapterText: repeated(30, base), characterNames: ['Alice'],
    });
    // Feed the same style back (6 lines ≈ 78 words, over the 50-word gate).
    const rep = await svc.detectDrift({
      projectId: 'nd', chapterNumber: 2,
      chapterText: repeated(6, base), characterNames: ['Alice'],
    });
    assert.equal(rep.characters[0].driftScore, 0);
    assert.equal(rep.characters[0].flags.length, 0);
    assert.equal(rep.overallDriftScore, 0);
    assert.match(rep.summary, /No significant voice drift in chapter 2/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('detectDrift skips scoring when chapter dialogue is under 50 words', async () => {
  const { svc, dir } = await freshService();
  try {
    const base = 'I walked along the quiet road and watched the calm grey morning light';
    await svc.ingestChapter({
      projectId: 'tiny', chapterNumber: 1,
      chapterText: repeated(30, base), characterNames: ['Alice'],
    });
    // Single short line — below the 50-word comparison floor.
    const rep = await svc.detectDrift({
      projectId: 'tiny', chapterNumber: 2,
      chapterText: '"I can\'t!" said Alice.', characterNames: ['Alice'],
    });
    assert.equal(rep.characters.length, 1);
    assert.ok(rep.characters[0].wordsInChapter < 50);
    assert.equal(rep.characters[0].driftScore, 0);
    assert.equal(rep.characters[0].flags.length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('detectDrift reports a character with no baseline fingerprint as zero-drift', async () => {
  const { svc, dir } = await freshService();
  try {
    // Bob has never been ingested → no fingerprint, even with plenty of dialogue.
    const base = 'I walked along the quiet road and watched the calm grey morning light';
    const rep = await svc.detectDrift({
      projectId: 'nofp', chapterNumber: 1,
      chapterText: repeated(8, base, 'Bob'), characterNames: ['Bob'],
    });
    assert.equal(rep.characters.length, 1);
    assert.equal(rep.characters[0].name, 'Bob');
    assert.ok(rep.characters[0].wordsInChapter > 50);
    assert.equal(rep.characters[0].driftScore, 0);
    assert.equal(rep.characters[0].flags.length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('alias dialogue is attributed to the canonical character', async () => {
  const { svc, dir } = await freshService();
  try {
    const chapter = paras(
      '"That is settled," said Lizzy.',   // alias of Elizabeth
      '"Agreed," said Elizabeth.',        // canonical
    );
    const r = await svc.ingestChapter({
      projectId: 'alias', chapterNumber: 1,
      chapterText: chapter,
      characterNames: ['Elizabeth'],
      characterAliases: { Elizabeth: ['Lizzy'] },
    });
    assert.deepEqual(r.charactersTouched, ['Elizabeth']);
    const store = await svc.getProjectVoices('alias');
    assert.deepEqual(Object.keys(store.characters), ['Elizabeth']);
    assert.deepEqual(store.characters['Elizabeth'].dialogueCorpus,
      ['That is settled,', 'Agreed,']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('ingest persists to disk and survives a fresh service instance', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cv-persist-'));
  try {
    const svc1 = new CharacterVoicesService(dir);
    svc1.setStyleClone(new StyleCloneService());
    await svc1.initialize();
    await svc1.ingestChapter({
      projectId: 'pers', chapterNumber: 1,
      chapterText: '"Saved to disk," said Alice.', characterNames: ['Alice'],
    });

    // New instance, same dir — must read the persisted store (not the cache).
    const svc2 = new CharacterVoicesService(dir);
    svc2.setStyleClone(new StyleCloneService());
    await svc2.initialize();
    const store = await svc2.getProjectVoices('pers');
    assert.equal(store.lastChapterAnalyzed, 1);
    assert.deepEqual(store.characters['Alice'].dialogueCorpus, ['Saved to disk,']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// #16 regression: a character name with stray whitespace (e.g. from a sloppy
// entity list) used to be silently dropped by canonicalize()'s untrimmed
// comparison — the whole dialogue line was lost. buildNameLookup (shared
// dialogue-parser) trims both the lookup key and the stored canonical value,
// so the line is now attributed and the character record is created.
test('a character name with trailing whitespace still attributes dialogue (untrimmed-name bug fix)', async () => {
  const { svc, dir } = await freshService();
  try {
    const r = await svc.ingestChapter({
      projectId: 'trim', chapterNumber: 1,
      chapterText: '"Hello there," said Sarah.',
      characterNames: ['Sarah '],
    });
    assert.equal(r.linesIngested, 1);
    assert.deepEqual(r.charactersTouched, ['Sarah']);
    const store = await svc.getProjectVoices('trim');
    assert.deepEqual(Object.keys(store.characters), ['Sarah']);
    assert.deepEqual(store.characters['Sarah'].dialogueCorpus, ['Hello there,']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// M2: the CharacterVoice record now has a `profanity` field (schema-present;
// population UI is a later sub-project). It must round-trip through the same
// JSON persist/load path as every other field on the record.
test('profanity round-trips through persist/load like any other CharacterVoice field', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cv-profanity-'));
  try {
    const svc1 = new CharacterVoicesService(dir);
    svc1.setStyleClone(new StyleCloneService());
    await svc1.initialize();
    await svc1.ingestChapter({
      projectId: 'prof', chapterNumber: 1,
      chapterText: '"Set the trait," said Rook.', characterNames: ['Rook'],
    });

    // Simulate the (not-yet-built) population UI setting the trait directly
    // on the persisted store file.
    const storePath = join(dir, 'character-voices', 'prof.json');
    const raw = JSON.parse(await readFile(storePath, 'utf-8'));
    raw.characters['Rook'].profanity = { level: 8, contexts: ['angry'], register: 'crude street slang' };
    await writeFile(storePath, JSON.stringify(raw, null, 2));

    const svc2 = new CharacterVoicesService(dir);
    svc2.setStyleClone(new StyleCloneService());
    await svc2.initialize();
    const store = await svc2.getProjectVoices('prof');
    assert.deepEqual(store.characters['Rook'].profanity, { level: 8, contexts: ['angry'], register: 'crude street slang' });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
