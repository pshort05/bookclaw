import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ManuscriptHubService } from '../../gateway/src/services/manuscript-hub.js';

// ─────────────────────────────────────────────────────────────────────────────
// Bug #23: the daily aggregation counted BOTH `file_saved` and `step_completed`
// for word count AND step count. Because a single step completion emits one
// `file_saved` and one `step_completed` that carry the SAME `wordCount`, both
// totals inflated ~2x, doubling daily-goal / streak pace.
//
// Fix: count each logical step ONCE — word count comes from `file_saved` only
// (the actual saved manuscript words); step count comes from `step_completed`
// only (so a non-saving step with no paired file_saved is still counted once).
// ─────────────────────────────────────────────────────────────────────────────

const svc = new ManuscriptHubService();
const todayISO = new Date().toISOString().split('T')[0];

function stubLog(entries: any[]) {
  return {
    log() {},
    getRecent(_count?: number) { return entries; },
  };
}

test('bug #23: paired file_saved + step_completed per step counts words + steps ONCE', async () => {
  const now = new Date().toISOString();
  // 3 step completions, each emitting a file_saved (1000) AND a step_completed
  // (1000) for the SAME step on the SAME day — the real emission pattern.
  const entries: any[] = [];
  for (let i = 0; i < 3; i++) {
    entries.push({ type: 'file_saved', timestamp: now, metadata: { fileName: `ch${i}.md`, wordCount: 1000 } });
    entries.push({ type: 'step_completed', timestamp: now, metadata: { fileName: `ch${i}.md`, wordCount: 1000 } });
  }

  const rep = await svc.build([], stubLog(entries), 1000);
  const today = rep.recent.find(d => d.date === todayISO)!;

  // NOT 6000 (double-counted) — file_saved words counted once per step.
  assert.equal(today.wordCount, 3000);
  // NOT 6 — one step per step_completed.
  assert.equal(today.stepsCompleted, 3);
});

test('bug #23: a non-saving step_completed (no paired file_saved) is counted once as a step, 0 words', async () => {
  const now = new Date().toISOString();
  // A step that completed without saving a manuscript file (e.g. a planning
  // step): only a step_completed, no file_saved. It carries a wordCount but
  // produced no saved manuscript words → 1 step, 0 words toward velocity.
  const entries = [
    { type: 'step_completed', timestamp: now, metadata: { wordCount: 1000 } },
  ];

  const rep = await svc.build([], stubLog(entries), 1000);
  const today = rep.recent.find(d => d.date === todayISO)!;

  assert.equal(today.stepsCompleted, 1);
  assert.equal(today.wordCount, 0);
});
