// tests/unit/dialogue-auditor.test.ts
//
// Characterization tests for DialogueAuditor's local (no-AI) dialogue
// extraction + speaker/tag attribution. The parsing core
// (parseDialogueParagraph) is private; we exercise it through the public
// extractLines(), which surfaces text/tag/tagVerb/speaker per line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DialogueAuditor } from '../../gateway/src/services/dialogue-auditor.js';

const auditor = new DialogueAuditor();

// Paragraphs are split on blank lines (/\n\s*\n/), so fixtures join with "\n\n".
function para(...paras: string[]): string {
  return paras.join('\n\n');
}

test('extracts a quoted line and attributes a subject-before-verb tag', () => {
  const lines = auditor.extractLines(para('"Hello there," said Alice.'));
  assert.equal(lines.length, 1);
  const l = lines[0];
  assert.equal(l.text, 'Hello there,');
  assert.equal(l.fullLine, '"Hello there," said Alice.');
  assert.equal(l.tagVerb, 'said');
  // "said Alice" — verb is the first word of the remainder (verbIdx===0), so the
  // subject-before branch can't fire; the verb-first branch takes the next word.
  assert.equal(l.speaker, 'Alice');
  assert.equal(l.tag, 'said Alice.');
  assert.equal(l.paragraphIndex, 0);
});

test('attributes a subject-before-verb tag ("Alice said")', () => {
  const lines = auditor.extractLines(para('"Hello there," Alice said.'));
  assert.equal(lines.length, 1);
  assert.equal(lines[0].tagVerb, 'said');
  assert.equal(lines[0].speaker, 'Alice');
  assert.equal(lines[0].tag, 'Alice said.');
});

test('a quoted line with no tag has null tag/tagVerb/speaker', () => {
  const lines = auditor.extractLines(para('"Just a line with nothing after it."'));
  assert.equal(lines.length, 1);
  assert.equal(lines[0].text, 'Just a line with nothing after it.');
  assert.equal(lines[0].tag, null);
  assert.equal(lines[0].tagVerb, null);
  assert.equal(lines[0].speaker, null);
});

test('an adverb tag ("said Alice quietly") still resolves the verb and speaker', () => {
  const lines = auditor.extractLines(para('"Careful now," said Alice quietly.'));
  assert.equal(lines.length, 1);
  assert.equal(lines[0].tagVerb, 'said');
  // extractProperNoun grabs the first capitalized token after the verb.
  assert.equal(lines[0].speaker, 'Alice');
  assert.equal(lines[0].tag, 'said Alice quietly.');
});

test('a non-tag verb after the quote is NOT treated as a dialogue tag', () => {
  // "walked" is not in TAG_VERBS, so tagVerb stays null and no speaker is set,
  // even though the remainder is non-empty.
  const lines = auditor.extractLines(para('"Come with me," Alice walked to the door.'));
  assert.equal(lines.length, 1);
  assert.equal(lines[0].tagVerb, null);
  assert.equal(lines[0].speaker, null);
  // The remainder is still captured as the tag text.
  assert.equal(lines[0].tag, 'Alice walked to the door.');
});

test('a leading pronoun is rejected as a proper noun ("said he")', () => {
  const lines = auditor.extractLines(para('"Indeed," said he.'));
  assert.equal(lines.length, 1);
  assert.equal(lines[0].tagVerb, 'said');
  // extractProperNoun rejects He/She/They/It/I/We/You.
  assert.equal(lines[0].speaker, null);
});

test('curly-quoted dialogue is parsed the same as straight quotes', () => {
  const lines = auditor.extractLines(para('“Well met,” said Bob.'));
  assert.equal(lines.length, 1);
  assert.equal(lines[0].text, 'Well met,');
  assert.equal(lines[0].tagVerb, 'said');
  assert.equal(lines[0].speaker, 'Bob');
});

test('paragraphs not starting with a quote are skipped (narration)', () => {
  const lines = auditor.extractLines(
    para(
      'The room was silent for a long moment.',
      '"At last," said Alice.',
      'She turned away.',
    ),
  );
  assert.equal(lines.length, 1);
  assert.equal(lines[0].speaker, 'Alice');
  // paragraphIndex reflects the ORIGINAL paragraph position, not the line index.
  assert.equal(lines[0].paragraphIndex, 1);
});

test('the tag verb is matched case-insensitively but normalized to lowercase', () => {
  const lines = auditor.extractLines(para('"What?" Asked Bob.'));
  assert.equal(lines.length, 1);
  assert.equal(lines[0].tagVerb, 'asked');
  assert.equal(lines[0].speaker, 'Bob');
});

test('a two-word capitalized name is captured by the proper-noun heuristic', () => {
  const lines = auditor.extractLines(para('"Over here," said Mary Jane.'));
  assert.equal(lines.length, 1);
  assert.equal(lines[0].speaker, 'Mary Jane');
});

test('audit() reports totals and attribution counts across a passage', () => {
  const report = auditor.audit(
    para(
      '"One," said Alice.',
      '"Two," said Bob.',
      '"Three with no tag at all here."',
      'Plain narration paragraph.',
    ),
  );
  assert.equal(report.totalLines, 3);     // 3 quoted paras (narration excluded)
  assert.equal(report.attributed, 2);     // Alice + Bob; untagged line is unattributed
  assert.equal(report.unattributed, 1);
  // Fewer than 3 lines per speaker → no fingerprints, no flags.
  assert.equal(report.fingerprints.length, 0);
  assert.equal(report.flags.length, 0);
});

test('buildFingerprints needs >=3 lines per speaker and computes rate features', () => {
  // Give Alice 3 attributed lines; compute the expected fingerprint fields.
  const lines = auditor.extractLines(
    para(
      '"I can\'t do this," said Alice.',     // contraction, declarative
      '"Are you sure about that?" said Alice.', // question
      '"This is amazing!" said Alice.',         // exclamation
    ),
  );
  assert.equal(lines.length, 3);
  const fps = auditor.buildFingerprints(lines);
  assert.equal(fps.length, 1);
  const fp = fps[0];
  assert.equal(fp.speaker, 'Alice');
  assert.equal(fp.lineCount, 3);
  // text fields (quotes stripped): "I can't do this," / "Are you sure about that?" / "This is amazing!"
  // questionRate = 1 of 3 lines end with '?', exclamationRate = 1 of 3 end with '!'.
  assert.equal(fp.questionRate, 0.33);
  assert.equal(fp.exclamationRate, 0.33);
  // wordCount: "I can't do this," (4) + "Are you sure about that?" (5) + "This is amazing!" (3) = 12.
  assert.equal(fp.wordCount, 12);
  // One contraction ("can't") over 12 words → 0.083 rounded to 3 dp.
  assert.equal(fp.contractionRate, 0.083);
  // avgLineLength = round(12 / 3) = 4.
  assert.equal(fp.avgLineLength, 4);
});

test('signature phrases require a 3-gram used 3+ times by exactly one speaker', () => {
  // Alice repeats "as you know" 3x; nobody else uses it → it becomes a signature.
  const lines = auditor.extractLines(
    para(
      '"As you know we must leave," said Alice.',
      '"And as you know I am right," said Alice.',
      '"But as you know nothing changes," said Alice.',
    ),
  );
  const fps = auditor.buildFingerprints(lines);
  assert.equal(fps.length, 1);
  assert.ok(fps[0].signaturePhrases.includes('as you know'),
    `expected "as you know" in ${JSON.stringify(fps[0].signaturePhrases)}`);
});
