import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runChunkedDeAiSweep } from '../../gateway/src/services/deai/sweep.js';
import { parseBannedCsv } from '../../gateway/src/services/deai/banned-terms.js';
import { applyDeAiEdits, type DeAiEdit } from '../../gateway/src/services/deterministic-apply.js';

const skill = readFileSync(fileURLToPath(new URL(
  '../../skills/author/romance-deai-audit/SKILL.md', import.meta.url)), 'utf8');

// --- Task 9: taxonomy presence ---

test('taxonomy names aphoristic-button and generalizing-second-person', () => {
  assert.match(skill, /aphoristic-button|sententious/i);
  assert.match(skill, /generalizing-second-person/i);
});

// --- Task 10: ch1 fixture regression (mechanics) ---

const ch1 = readFileSync(fileURLToPath(new URL('./fixtures/deai-ch1.md', import.meta.url)), 'utf8');
const RULE_OF_THREE = /\b\w+, \w+, and \w+\b/g;

test('two passes drive rule-of-three lists and leak-#2 buttons to 0 in the fixture', async () => {
  const before = (ch1.match(RULE_OF_THREE) || []).length;
  assert.ok(before >= 3, 'fixture seeds several rule-of-three lists');

  // Canned auditor: pass 1 flags HALF the rule-of-three + both buttons + the
  // second-person pair (top-N leak); pass 2 (second reader) flags the residue.
  const flagThree = (text: string, take: number): DeAiEdit[] =>
    Array.from(text.matchAll(RULE_OF_THREE)).slice(0, take).map(m => ({
      op: 'swap' as const, find: m[0], replace: m[0].replace(/, and /, ' and ').replace(/, \w+ and/, ' and'),
    }));
  const auditWindow = async ({ windowText, pass }: { windowText: string; pass: 1 | 2 }): Promise<DeAiEdit[]> => {
    const all = Array.from(windowText.matchAll(RULE_OF_THREE)).map(m => m[0]);
    const half = Math.ceil(all.length / 2);
    const edits = pass === 1 ? flagThree(windowText, half) : flagThree(windowText, all.length);
    if (pass === 1) {
      if (windowText.includes("That's the thing about Fran."))
        edits.push({ op: 'rewrite', find: "That's the thing about Fran.", instruction: 'ground in the beat' });
      if (windowText.includes('You pull dough.'))
        edits.push({ op: 'rewrite', find: 'You pull dough.', instruction: 'return to first person' });
    }
    return edits;
  };
  const rewriteFn = async (span: string) => span.replace(/^That's.*/, 'She wiped her hands.').replace(/^You pull dough\.$/, 'I pull dough.');
  const applyEdits = (base: string, edits: DeAiEdit[]) => applyDeAiEdits(base, edits, rewriteFn);

  const res = await runChunkedDeAiSweep({ draft: ch1, banned: parseBannedCsv('find,replace'), deps: { auditWindow, applyEdits } });
  assert.equal((res.text.match(RULE_OF_THREE) || []).length, 0, 'no rule-of-three survives 2 passes');
  assert.ok(!res.text.includes("That's the thing about Fran."), 'aphoristic button removed');
  assert.equal(res.passes, 2);
  // dialogue line preserved
  assert.ok(res.text.includes('"That\'s as close to praying as I get,"'), 'dialogue untouched');
});
