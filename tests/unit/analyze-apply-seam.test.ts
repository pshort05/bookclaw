/**
 * Integration-seam tests for `resolveAnalyzeApplyBlock` (gateway/src/api/routes/_shared.ts) —
 * wires Task 3's `analyzeChapter`/`describeFindings` into a book-production
 * "Polish Chapter N" step, mirroring the `resolveIntimacyRouting`/
 * `resolveGroundingBlock` testing pattern (fake `services`, no Express).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAnalyzeApplyBlock } from '../../gateway/src/api/routes/_shared.js';
import { CraftCriticService } from '../../gateway/src/services/craft-critic.js';
import { DialogueAuditor } from '../../gateway/src/services/dialogue-auditor.js';

const TELLING_TEXT = 'Sarah was sad about the news. She felt scared walking home. Her friend was angry too, ' +
  'and she was nervous about the exam. Sarah was sad again the next morning, still felt scared of what might come.';
const CLEAN_TEXT = 'A short chapter with no craft problems, just plain narrative prose that moves from scene to scene without incident.';

function realServices() {
  return { craftCritic: new CraftCriticService(), dialogueAuditor: new DialogueAuditor() };
}

function polishStep(chapterNumber: number) {
  return { id: 'polish-1', phase: 'polish', skill: 'revise', chapterNumber };
}

function projectWithWriteStep(chapterNumber: number, result: string, continuityFlags?: any[]) {
  return {
    id: 'p1',
    steps: [
      { id: 'write-1', skill: 'write', chapterNumber, status: 'completed', result, continuityFlags },
    ],
  };
}

test('resolveAnalyzeApplyBlock: returns findings naming the telling issue for a matching write step', () => {
  const services = realServices();
  const project = projectWithWriteStep(3, TELLING_TEXT);
  const block = resolveAnalyzeApplyBlock({ services, project, step: polishStep(3) });
  assert.match(block, /telling/i);
});

test('resolveAnalyzeApplyBlock: returns "" for a clean write step (nothing to fix)', () => {
  const services = realServices();
  const project = projectWithWriteStep(3, CLEAN_TEXT);
  const block = resolveAnalyzeApplyBlock({ services, project, step: polishStep(3) });
  assert.equal(block, '');
});

test('resolveAnalyzeApplyBlock: no-op for a non-polish step', () => {
  const services = realServices();
  const project = projectWithWriteStep(3, TELLING_TEXT);
  const block = resolveAnalyzeApplyBlock({ services, project, step: { id: 'x', phase: 'writing', skill: 'write', chapterNumber: 3 } });
  assert.equal(block, '');
});

test('resolveAnalyzeApplyBlock: no-op when no matching completed write step exists for this chapter', () => {
  const services = realServices();
  const project = projectWithWriteStep(2, TELLING_TEXT); // chapter 2, but polish step asks for chapter 3
  const block = resolveAnalyzeApplyBlock({ services, project, step: polishStep(3) });
  assert.equal(block, '');
});

test('resolveAnalyzeApplyBlock: no-op when the critic services are not wired', () => {
  const project = projectWithWriteStep(3, TELLING_TEXT);
  const block = resolveAnalyzeApplyBlock({ services: {}, project, step: polishStep(3) });
  assert.equal(block, '');
});

test('resolveAnalyzeApplyBlock: carries forward Plan 3 continuityFlags stored on the write step', () => {
  const services = realServices();
  const project = projectWithWriteStep(3, CLEAN_TEXT, [{ kind: 'contradiction', detail: 'Eye color changed from blue to brown.' }]);
  const block = resolveAnalyzeApplyBlock({ services, project, step: polishStep(3) });
  assert.match(block, /Eye color changed from blue to brown/);
});

// ── L2 (code-review): the OTHER book-production generator tags its chapter-
// level revise steps with role 'rewrite'/'editorial' + a chapterNumber under
// a phase name OTHER than 'polish' — the gate must still match this shape. ──
test('resolveAnalyzeApplyBlock: matches a code-generated rewrite step (role: "rewrite", non-polish phase)', () => {
  const services = realServices();
  const project = projectWithWriteStep(3, TELLING_TEXT);
  const step = { id: 'rewrite-1', phase: 'revision', skill: 'revise', role: 'rewrite', chapterNumber: 3 };
  const block = resolveAnalyzeApplyBlock({ services, project, step });
  assert.match(block, /telling/i);
});

test('resolveAnalyzeApplyBlock: matches a code-generated editorial step (role: "editorial", non-polish phase)', () => {
  const services = realServices();
  const project = projectWithWriteStep(3, TELLING_TEXT);
  const step = { id: 'editorial-1', phase: 'revision', skill: 'revise', role: 'editorial', chapterNumber: 3 };
  const block = resolveAnalyzeApplyBlock({ services, project, step });
  assert.match(block, /telling/i);
});

test('resolveAnalyzeApplyBlock: still no-op for a non-polish step with no chapterNumber and no rewrite/editorial role', () => {
  const services = realServices();
  const project = projectWithWriteStep(3, TELLING_TEXT);
  const step = { id: 'x', phase: 'revision', skill: 'revise' };
  const block = resolveAnalyzeApplyBlock({ services, project, step });
  assert.equal(block, '');
});

// ── Mis-wire detection: a fake craftCritic that THROWS unless it receives the
// real chapter-array shape catches an arg-shape mistake at the seam. ──
test('resolveAnalyzeApplyBlock: a critic error degrades to "" without throwing', () => {
  const services = {
    craftCritic: { analyze() { throw new Error('mis-wire: wrong shape'); } },
    dialogueAuditor: new DialogueAuditor(),
  };
  const project = projectWithWriteStep(3, TELLING_TEXT);
  const block = resolveAnalyzeApplyBlock({ services, project, step: polishStep(3) });
  assert.equal(block, '');
});
