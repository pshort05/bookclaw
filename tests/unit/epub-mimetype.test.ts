/**
 * Regression test for VERIFIED High bug #11: exported EPUBs were OCF-spec-invalid
 * on two grounds — (1) adm-zip DEFLATE-compresses every non-empty entry by
 * default, but OCF requires the `mimetype` entry to be STORED (uncompressed),
 * and (2) `new AdmZip()` with no options re-sorts entries alphabetically at
 * compress time, so `META-INF/container.xml` displaces `mimetype` from the
 * required first position (byte offset 38). epubcheck fails and KDP/Apple/Kobo
 * may reject the upload.
 *
 * This test drives the real EPUB generator (generateEpubBuffer) and reads the
 * produced zip back with adm-zip to assert the mimetype entry is both first
 * and STORED.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import AdmZip from 'adm-zip';
import { generateEpubBuffer } from '../../gateway/src/services/epub-export.js';

test('mimetype entry is the first entry in the produced zip', async () => {
  const buffer = await generateEpubBuffer({
    title: 'Test Book',
    author: 'Test Author',
    content: '# Chapter One\n\nSome text.',
  });

  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();

  assert.equal(entries[0].entryName, 'mimetype');
});

test('mimetype entry is STORED (uncompressed), not DEFLATED', async () => {
  const buffer = await generateEpubBuffer({
    title: 'Test Book',
    author: 'Test Author',
    content: '# Chapter One\n\nSome text.',
  });

  const zip = new AdmZip(buffer);
  const mimetypeEntry = zip.getEntry('mimetype');

  assert.ok(mimetypeEntry, 'mimetype entry must exist');
  assert.equal(mimetypeEntry.header.method, 0); // 0 === Constants.STORED
});

test('mimetype entry content is exactly "application/epub+zip"', async () => {
  const buffer = await generateEpubBuffer({
    title: 'Test Book',
    author: 'Test Author',
    content: '# Chapter One\n\nSome text.',
  });

  const zip = new AdmZip(buffer);
  const mimetypeEntry = zip.getEntry('mimetype');

  assert.ok(mimetypeEntry, 'mimetype entry must exist');
  assert.equal(mimetypeEntry.getData().toString('utf-8'), 'application/epub+zip');
});
