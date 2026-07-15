import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

for (const file of ['romance-sweet-deterministic.json', 'romance-spicy-deterministic.json']) {
  test(`${file}: setting bible precedes character bible, with Gate A + Gate B inserted`, () => {
    const p = JSON.parse(readFileSync(join(ROOT, 'library', 'pipelines', file), 'utf8'));
    const labels: string[] = p.steps.map((s: any) => s.label);
    const iSetting = labels.indexOf('Setting');
    const iChar = labels.indexOf('Character Bible');
    const iOutline = labels.indexOf('Chapter Outline');
    assert.ok(iSetting >= 0 && iChar >= 0 && iOutline >= 0, 'all three canon steps present');
    assert.ok(iSetting < iChar, 'Setting generates BEFORE Character Bible');
    assert.ok(iChar < iOutline, 'Character Bible still before the outline');

    // Gate A: a canon-audit + canon-drift-apply pair after Setting, before Character Bible.
    const gateA = p.steps.slice(iSetting + 1, iChar);
    assert.ok(gateA.some((s: any) => s.skill === 'romance-canon-audit'), 'Gate A audit after Setting');
    assert.ok(gateA.some((s: any) => s.skill === 'canon-drift-apply'), 'Gate A apply after Setting');

    // Gate B: a canon-audit + canon-drift-apply pair after Character Bible, before the outline.
    const gateB = p.steps.slice(iChar + 1, iOutline);
    assert.ok(gateB.some((s: any) => s.skill === 'romance-canon-audit'), 'Gate B audit after Character Bible');
    assert.ok(gateB.some((s: any) => s.skill === 'canon-drift-apply'), 'Gate B apply after Character Bible');

    // The character bible template must now reference the SETTING (reorder correctness).
    const charStep = p.steps[iChar];
    assert.match(charStep.promptTemplate, /setting/i, 'character bible now uses the setting in context');
  });
}
