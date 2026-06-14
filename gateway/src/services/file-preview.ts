/**
 * File-explorer preview helper (shared by the documents + book-file read
 * endpoints). Pure: whether a file should be rendered inline as text in the
 * studio preview pane vs. served as a download.
 *
 * Security: the read endpoints serve previewable text as `text/plain` and force
 * everything else to an `application/octet-stream` attachment (+ `nosniff`), so
 * a user-supplied file is NEVER served with an active MIME type (e.g. text/html)
 * on the application origin — which would be a stored-XSS vector. Hence an
 * allowlist of inert text extensions here, not a content-type map.
 */

/** Extensions the studio renders inline as text (served as text/plain). */
const PREVIEWABLE = new Set(['md', 'markdown', 'txt', 'text', 'log', 'csv', 'json']);

/** Lowercased final extension, or '' if none. */
function extOf(filename: string): string {
  const i = filename.lastIndexOf('.');
  return i >= 0 ? filename.slice(i + 1).toLowerCase() : '';
}

/** True when the file should be fetched + rendered as text rather than downloaded. */
export function isPreviewableText(filename: string): boolean {
  return PREVIEWABLE.has(extOf(filename));
}
