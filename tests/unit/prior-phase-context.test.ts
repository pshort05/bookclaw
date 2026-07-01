/**
 * Cross-phase handoff (run-review #3, 2026-06-30). Each book phase is a separate
 * project chained by pipelineId; the bible phase saw none of the planning phase's
 * output, so it re-invented the protagonist (June Chen → June Eleanor Harper, new
 * family/age/hometown). formatPriorPhaseContext summarizes prior-phase outputs to
 * inject into a later phase, with an explicit "expand, do not replace" instruction
 * so the bible builds on the planning profile instead of overwriting it.
 *
 * Run: node --import tsx --test tests/unit/prior-phase-context.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatPriorPhaseContext } from '../../gateway/src/services/projects.js';

test('formatPriorPhaseContext summarizes prior-phase outputs with an expand-not-replace rule', () => {
  const block = formatPriorPhaseContext([
    {
      label: 'My Book — Planning',
      steps: [
        { label: 'Character profiles', result: 'Protagonist: June Chen, 28, surgical nurse.' },
        { label: 'Chapter outline', result: 'Ch1: meet-cute at the market.' },
      ],
    },
  ]);
  assert.match(block, /PRIOR PHASE/i);
  assert.match(block, /June Chen/);
  assert.match(block, /meet-cute at the market/);
  assert.match(block, /Character profiles/);
  // the key instruction: build on these, don't rename/re-invent
  assert.match(block, /(build on|expand|do not (replace|rename|re-?invent)|reuse)/i);
});

test('formatPriorPhaseContext returns empty when there are no prior phases or no content', () => {
  assert.equal(formatPriorPhaseContext([]), '');
  assert.equal(formatPriorPhaseContext([{ label: 'Empty', steps: [] }]), '');
  assert.equal(formatPriorPhaseContext([{ label: 'Empty', steps: [{ label: 's', result: '' }] }]), '');
});

test('formatPriorPhaseContext caps very long results so the prompt stays bounded', () => {
  const huge = 'x '.repeat(20000);
  const block = formatPriorPhaseContext([{ label: 'P', steps: [{ label: 'big', result: huge }] }]);
  assert.ok(block.length < 20000, 'long prior-phase result is truncated');
});

test('formatPriorPhaseContext enforces a total cap across many steps (no prompt balloon)', () => {
  const steps = Array.from({ length: 60 }, (_, i) => ({ label: `s${i}`, result: 'y '.repeat(3000) }));
  const block = formatPriorPhaseContext([{ label: 'Production-ish', steps }]);
  // 60 steps × ~4000 capped would be ~240k without a total ceiling; stays bounded.
  assert.ok(block.length < 30000, `total content is capped, got ${block.length}`);
});
