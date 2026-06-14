/**
 * Unit tests for the file-explorer preview helper: whether a file is previewable
 * as text (served text/plain inline) vs. forced to a download attachment. The
 * allowlist also doubles as the XSS guard — active types (html/svg/…) are NOT
 * previewable, so they're never served with an active MIME on-origin.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPreviewableText } from '../../gateway/src/services/file-preview.js';

test('isPreviewableText: true for inert text files (case-insensitive)', () => {
  assert.equal(isPreviewableText('a.md'), true);
  assert.equal(isPreviewableText('a.txt'), true);
  assert.equal(isPreviewableText('a.json'), true);
  assert.equal(isPreviewableText('manuscript.extracted.txt'), true);
  assert.equal(isPreviewableText('UPPER.MD'), true);
});

test('isPreviewableText: false for binary AND active/unknown types', () => {
  assert.equal(isPreviewableText('b.docx'), false);
  assert.equal(isPreviewableText('b.epub'), false);
  assert.equal(isPreviewableText('noext'), false);
  // Active MIME types must NOT be previewable (would be servable inline on-origin).
  assert.equal(isPreviewableText('evil.html'), false);
  assert.equal(isPreviewableText('evil.svg'), false);
});
