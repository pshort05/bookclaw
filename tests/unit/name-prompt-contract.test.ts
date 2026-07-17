/**
 * Unit tests for the draft-prompt manifest contract + roster injection (Task 8):
 * writeChapterPrompt mandates a sentinel-delimited manifest (empty allowed) and
 * injectRoster appends the roster (no-op when empty).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeChapterPrompt, injectRoster } from '../../gateway/src/services/projects.js';

test('draft prompt mandates a sentinel-delimited manifest, empty allowed', () => {
  const p = writeChapterPrompt(3, 'Two Months of Summer', 3000);
  assert.match(p, /<!--BOOKCLAW:MANIFEST/);
  assert.match(p, /\/MANIFEST-->/);
  assert.match(p, /always.*present|even.*empty|CHARACTERS:\s*none/i);
});

test('injectRoster appends the roster; empty roster is a no-op', () => {
  const base = 'Write Chapter 3.';
  assert.equal(injectRoster(base, ''), base);
  assert.match(injectRoster(base, 'ESTABLISHED SUPPORTING CAST — reuse these:\n- Rosa — regular'), /Rosa — regular/);
});
