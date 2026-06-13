import { useEffect, useMemo, useState } from 'react';
import { api, Button, useBooks, useStore } from '@bookclaw/shared';
import styles from './DeleteBooksModal.module.css';

// Typed-confirmation phrase — must be entered EXACTLY (trimmed) to enable the
// final delete. A high-friction gate for an irreversible, on-disk deletion.
const CONFIRM_PHRASE = 'DELETE MY BOOKS FROM DISK';

/**
 * Multi-select "delete books from disk" dialog (Settings → Danger zone).
 * Two stages: pick books, then type the confirmation phrase. Deletes via the
 * existing single DELETE /api/books/:slug (looped), then refreshes the store.
 */
export function DeleteBooksModal({ onClose }: { onClose: () => void }) {
  const books = useBooks();
  const loadBooks = useStore((s) => s.loadBooks);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [stage, setStage] = useState<'select' | 'confirm'>('select');
  const [phrase, setPhrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  // Settings doesn't otherwise load the book list — fetch it on open.
  useEffect(() => { loadBooks().catch(() => {}); }, [loadBooks]);

  // Esc closes (except mid-delete, so a slow loop isn't abandoned half-done).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const toggle = (slug: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug); else next.add(slug);
      return next;
    });

  // Selected books that still exist (a reload may have dropped some).
  const selectedBooks = useMemo(() => books.filter((b) => selected.has(b.slug)), [books, selected]);
  const phraseOk = phrase.trim() === CONFIRM_PHRASE;

  const doDelete = async () => {
    if (!phraseOk || busy || selectedBooks.length === 0) return;
    setBusy(true);
    let ok = 0; let failed = 0;
    // Sequential so one failure doesn't abort the rest; each is independent.
    for (const b of selectedBooks) {
      try {
        await api(`/api/books/${encodeURIComponent(b.slug)}`, { method: 'DELETE' });
        ok++;
      } catch { failed++; }
    }
    await loadBooks().catch(() => {});
    setBusy(false);
    setResult(`Deleted ${ok} book${ok === 1 ? '' : 's'}${failed ? `, ${failed} failed` : ''}.`);
  };

  return (
    <>
      <div className={`${styles.scrim} ${styles.on}`} onClick={() => { if (!busy) onClose(); }} />
      <div className={styles.modal} role="dialog" aria-modal="true" aria-label="Delete books from disk">
        {result ? (
          <>
            <h2 className={styles.h2}>Done</h2>
            <p className={styles.msg}>{result}</p>
            <div className={styles.foot}>
              <Button variant="primary" onClick={onClose}>Close</Button>
            </div>
          </>
        ) : stage === 'select' ? (
          <>
            <h2 className={styles.h2}>Delete books from disk</h2>
            <p className={styles.dim}>
              Select books to permanently delete. This removes the book folder under <code>workspace/books/</code> — use after a book is finished and pulled elsewhere, or to clean up test books.
            </p>
            <div className={styles.list}>
              {books.length === 0 && <p className={styles.dim}>No books to delete.</p>}
              {books.map((b) => (
                <label key={b.slug} className={styles.row}>
                  <input type="checkbox" checked={selected.has(b.slug)} onChange={() => toggle(b.slug)} />
                  <span className={styles.title}>{b.title}</span>
                  <span className={styles.phase}>{b.phase}</span>
                  <code className={styles.slug}>{b.slug}</code>
                </label>
              ))}
            </div>
            <div className={styles.foot}>
              <Button variant="secondary" onClick={onClose}>Cancel</Button>
              <Button variant="primary" onClick={() => setStage('confirm')} disabled={selected.size === 0}>
                Delete {selected.size || ''} selected…
              </Button>
            </div>
          </>
        ) : (
          <>
            <h2 className={styles.h2}>Confirm deletion</h2>
            <p className={styles.warn}>This permanently deletes {selectedBooks.length} book{selectedBooks.length === 1 ? '' : 's'} from disk. There is no undo.</p>
            <p className={styles.dim}>Deleting: {selectedBooks.map((b) => b.title).join(', ')}</p>
            <label className={styles.confirmLabel}>
              Type <code>{CONFIRM_PHRASE}</code> to confirm:
            </label>
            <input
              className={styles.phraseInput}
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              placeholder={CONFIRM_PHRASE}
              autoFocus
              disabled={busy}
              aria-label="Confirmation phrase"
            />
            <div className={styles.foot}>
              <Button variant="secondary" onClick={() => { setStage('select'); setPhrase(''); }} disabled={busy}>Back</Button>
              <Button variant="primary" onClick={doDelete} disabled={!phraseOk || busy}>
                {busy ? 'Deleting…' : 'Delete from disk'}
              </Button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
