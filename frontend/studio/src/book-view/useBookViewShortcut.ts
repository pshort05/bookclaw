import { useEffect } from 'react';

/**
 * The `b` accelerator (design §9) — the studio's first keyboard shortcut.
 *
 * Bare key, deliberately: `Cmd/Ctrl+B` is the browser's bookmarks sidebar. The
 * guard is the part that must not be improvised, so it lives in one pure
 * predicate that is unit-tested (`tests/unit/book-view-shortcut.test.ts`)
 * without booting React: typing "b" in the raw editor or a chat box must never
 * open a board.
 */

/** The parts of a KeyboardEvent the guard reads. */
export interface ShortcutKeyEvent {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  isComposing?: boolean;
}

/** The parts of the focused element the guard reads. */
export interface ShortcutTarget {
  tagName?: string;
  isContentEditable?: boolean;
}

/** True when focus sits somewhere that "b" is a character, not a command. */
export function isTextEntryTarget(target: ShortcutTarget | null | undefined): boolean {
  if (!target) return false;
  if (target.isContentEditable === true) return true;
  const tag = (target.tagName ?? '').toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select';
}

/** True only for a bare `b` pressed outside a text-entry field. */
export function opensBookView(e: ShortcutKeyEvent, target?: ShortcutTarget | null): boolean {
  if (e.key !== 'b' && e.key !== 'B') return false;
  if (e.metaKey || e.ctrlKey || e.altKey) return false;
  if (e.isComposing) return false;
  return !isTextEntryTarget(target);
}

/**
 * Binds `b` to open and Escape to close. Both handlers are optional so a mount
 * can take only the half it needs — `BookView` itself only closes.
 */
export function useBookViewShortcut(handlers: { onOpen?: () => void; onClose?: () => void }): void {
  const { onOpen, onClose } = handlers;
  useEffect(() => {
    if (!onOpen && !onClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (onClose && e.key === 'Escape') { onClose(); return; }
      // `e.target` is the focused element for a keydown; fall back to the
      // document's focus when the event was dispatched at the window.
      const target = (e.target as ShortcutTarget | null) ?? document.activeElement;
      if (onOpen && opensBookView(e, target)) { e.preventDefault(); onOpen(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onOpen, onClose]);
}
