/**
 * Pure helpers for the `/editor` chat command: turn the argument string into an
 * intent (parseEditorCommand) and render the numbered selection menu
 * (buildEditorMenu). Kept free of gateway state so the index.ts handler is a thin
 * adapter and the parsing/menu logic is unit-testable in isolation.
 */
import type { EditorMode } from './editor-prompt.js';

export type ParsedEditorCommand =
  | { kind: 'show' }
  | { kind: 'off' }
  | { kind: 'need-mode'; name: string; withBook: boolean }
  | { kind: 'enter'; name: string; mode: EditorMode; withBook: boolean };

const MODE_SYNONYMS: Record<string, EditorMode> = {
  brainstorm: 'brainstorm', bs: 'brainstorm', ideas: 'brainstorm', idea: 'brainstorm',
  critique: 'critique', edit: 'critique', review: 'critique', critic: 'critique',
};

/** Map a token to an editor mode, or null if it isn't a mode word. */
export function resolveMode(token: string): EditorMode | null {
  return MODE_SYNONYMS[token.trim().toLowerCase()] ?? null;
}

/**
 * After the menu is shown, a bare numeric reply (e.g. "7") selects that editor.
 * Returns the editor name for a 1-based number within range, else null. Pure so
 * the gateway just pairs it with the per-channel "menu just shown" state.
 */
export function editorNumberSelection(orderedNames: string[], text: string): string | null {
  const m = (text || '').trim().match(/^#?(\d{1,3})$/);
  if (!m) return null;
  const i = parseInt(m[1], 10) - 1;
  return i >= 0 && i < orderedNames.length ? orderedNames[i] : null;
}

/** Parse the `/editor` argument string into an intent. */
export function parseEditorCommand(args: string): ParsedEditorCommand {
  const trimmed = (args || '').trim();
  if (!trimmed) return { kind: 'show' };

  const tokens = trimmed.split(/\s+/);
  const first = tokens[0].toLowerCase();
  if (first === 'off' || first === 'none' || first === 'exit') return { kind: 'off' };

  const name = first;
  const rest = tokens.slice(1).map((t) => t.toLowerCase());
  const withBook = rest.includes('book');
  // First non-`book` token after the name, if any, is the candidate mode.
  const modeToken = rest.find((t) => t !== 'book');
  const mode = modeToken ? resolveMode(modeToken) : null;
  if (!mode) return { kind: 'need-mode', name, withBook };
  return { kind: 'enter', name, mode, withBook };
}

interface MenuEditor { name: string; label?: string; description?: string; specialty?: string }

/** Em-dash / en-dash / hyphen — the label separator between name and specialty. */
const LABEL_DASH = /[—–-]/;

/** Display name = the label text before its dash, else the bare name. */
function displayName(e: MenuEditor): string {
  if (e.label) {
    const head = e.label.split(LABEL_DASH)[0].trim();
    if (head) return head;
  }
  return e.name;
}

/** Specialty tag = explicit specialty, else the label text after its dash, else a default. */
function specialtyOf(e: MenuEditor): string {
  if (e.specialty && e.specialty.trim()) return e.specialty.trim();
  if (e.label) {
    const parts = e.label.split(LABEL_DASH);
    if (parts.length > 1) {
      const tail = parts.slice(1).join('-').trim();
      if (tail) return tail;
    }
  }
  return 'developmental editor';
}

/** Render the numbered `/editor` selection menu. */
export function buildEditorMenu(
  editors: MenuEditor[],
  active: { editor: string; mode: EditorMode; label?: string } | null,
): string {
  if (!editors.length) return '_No editors available._';

  const lines: string[] = ['**Editors** — reply with a number, or a command:', ''];
  editors.forEach((e, i) => {
    lines.push(`${i + 1}. **${displayName(e)}** — ${specialtyOf(e)}`);
    lines.push(`   brainstorm: \`/editor ${e.name} brainstorm\` · critique: \`/editor ${e.name} critique\``);
  });
  lines.push('');
  lines.push('Add `book` to review your active book (e.g. `/editor maeve critique book`). `/editor off` to exit.');
  if (active) {
    lines.push('');
    lines.push(`_Currently with **${active.label || active.editor}** (${active.mode})._`);
  }
  return lines.join('\n');
}
