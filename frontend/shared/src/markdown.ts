import { marked } from 'marked';
import DOMPurify from 'dompurify';

/**
 * Render Markdown to sanitized HTML — the single source of truth for Markdown
 * preview across the studio (asset prose preview, file preview) and the chat app
 * (assistant replies).
 *
 * Always sanitized: callers feed the result to `dangerouslySetInnerHTML`, so
 * unsanitized HTML must never leave this function. Parsing is synchronous
 * (`async: false`) so the result is a plain string, not a Promise.
 */
export function renderMarkdown(md: string): string {
  return DOMPurify.sanitize(marked.parse(md ?? '', { async: false }) as string);
}
