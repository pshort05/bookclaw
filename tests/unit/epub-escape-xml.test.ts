/**
 * Unit tests for gateway/src/services/epub-export.ts escapeXml — the sole
 * sanitizer applied to every field written into the EPUB's OPF and XHTML.
 * XML 1.0 forbids C0 control characters except tab/LF/CR (and they cannot be
 * expressed as numeric character references), so escapeXml must strip them or
 * the emitted document is not well-formed and readers/validators reject it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeXml } from '../../gateway/src/services/epub-export.js';

test('strips XML-illegal C0 control characters (NUL, form feed)', () => {
  assert.equal(escapeXml('a\x00b\x0cc'), 'abc');
});

test('preserves XML-legal whitespace (tab, LF, CR)', () => {
  assert.equal(escapeXml('x\ty\nz\r'), 'x\ty\nz\r');
});

test('still escapes the five XML metacharacters', () => {
  assert.equal(escapeXml('a & b < c'), 'a &amp; b &lt; c');
  assert.equal(escapeXml('"x" > \'y\''), '&quot;x&quot; &gt; &apos;y&apos;');
});

test('strips vertical tab and other C0 controls but keeps surrounding text', () => {
  assert.equal(escapeXml('hello\x0bworld\x01!'), 'helloworld!');
});
