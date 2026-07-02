/**
 * Unit test for LessonStore write serialization (gateway/src/services/lessons.ts).
 *
 * Regression for bug L19: addLesson() appended to improvement-log.jsonl while
 * buildContext()/adjustConfidence() concurrently truncate-and-rewrote the same
 * file with no serialization. Overlapping fs writes on the single event loop
 * could drop the appended lesson, duplicate a line, or tear a JSONL line.
 *
 * This test fires many concurrent addLesson() calls interleaved with
 * buildContext(), then reloads the persisted file with a fresh LessonStore and
 * asserts every added lesson survives exactly once with no torn lines.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { LessonStore } from '../../gateway/src/services/lessons.js';

describe('LessonStore concurrent write serialization', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bc-lessons-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('concurrent addLesson + buildContext never drops, dupes, or tears a line', async () => {
    const store = new LessonStore(dir);
    await store.initialize();

    const total = 200;
    const ops: Promise<unknown>[] = [];
    for (let i = 0; i < total; i++) {
      ops.push(
        store.addLesson({
          timestamp: new Date().toISOString(),
          category: 'general',
          lesson: `lesson number ${i}`,
          source: 'user-feedback',
          confidence: 0.9,
        }),
      );
      // Interleave full-file rewrites via buildContext (fire-and-forget inside).
      store.buildContext();
    }
    await Promise.all(ops);
    // Give any fire-and-forget rewrites time to settle.
    await new Promise((r) => setTimeout(r, 100));

    // Reload from disk with a fresh store — this is what a restart would see.
    const reloaded = new LessonStore(dir);
    await reloaded.initialize();
    const all = reloaded.getAll();

    // No lesson dropped and none torn (torn lines are silently skipped on load).
    assert.equal(all.length, total, 'reloaded lesson count must equal the number added');

    // Every added id appears exactly once (no drops, no dupes).
    const ids = all.map((l) => l.id);
    assert.equal(new Set(ids).size, total, 'every lesson id must be unique after reload');
  });
});
