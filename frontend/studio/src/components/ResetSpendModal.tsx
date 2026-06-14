import { useEffect, useState } from 'react';
import { api, Button, useBooks, useCosts, useStore, money } from '@bookclaw/shared';
import styles from './DeleteBooksModal.module.css';

// Typed-confirmation phrase — must be entered EXACTLY (trimmed) to enable the
// final reset. A high-friction gate for an irreversible odometer wipe.
const CONFIRM_PHRASE = 'RESET MY TOTAL SPEND';

/**
 * Danger-zone "reset total spend" dialog (Settings → Danger zone). Stage 1:
 * optionally select per-book buckets to also zero (the lifetime total is always
 * reset). Stage 2: type the confirmation phrase. POSTs /api/costs/reset-total,
 * then refreshes the cost store. Mirrors DeleteBooksModal's structure/classes.
 */
export function ResetSpendModal({ onClose }: { onClose: () => void }) {
  const books = useBooks();
  const costs = useCosts();
  const loadBooks = useStore((s) => s.loadBooks);
  const loadCosts = useStore((s) => s.loadCosts);
  const [stage, setStage] = useState<'select' | 'confirm'>('select');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [unattributed, setUnattributed] = useState(false);
  const [phrase, setPhrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  // Settings doesn't otherwise load the book list — fetch it on open.
  useEffect(() => { loadBooks().catch(() => {}); }, [loadBooks]);

  // Esc closes (except mid-reset, so a slow POST isn't abandoned half-done).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const phraseOk = phrase.trim() === CONFIRM_PHRASE;
  const byBook = costs?.byBook ?? {};
  const unattributedSpend = byBook['unattributed'] ?? 0;
  const bucketCount = selected.size + (unattributed ? 1 : 0);

  const toggle = (slug: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug); else next.add(slug);
      return next;
    });

  const doReset = async () => {
    if (!phraseOk || busy) return;
    setBusy(true);
    try {
      await api('/api/costs/reset-total', {
        method: 'POST',
        body: JSON.stringify({ books: [...selected], unattributed }),
      });
      await loadCosts().catch(() => {});
      setResult('Lifetime total reset.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className={`${styles.scrim} ${styles.on}`} onClick={() => { if (!busy) onClose(); }} />
      <div className={styles.modal} role="dialog" aria-modal="true" aria-label="Reset total spend">
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
            <h2 className={styles.h2}>Reset total spend</h2>
            <p className={styles.dim}>
              This resets your <strong>lifetime total</strong> to $0. Optionally also zero individual book totals below.
            </p>
            <div className={styles.list}>
              {books.map((b) => (
                <label key={b.slug} className={styles.row}>
                  <input type="checkbox" checked={selected.has(b.slug)} onChange={() => toggle(b.slug)} />
                  <span className={styles.title}>{b.title}</span>
                  <span className={styles.phase}>{money(byBook[b.slug] ?? 0)}</span>
                </label>
              ))}
              <label className={styles.row}>
                <input type="checkbox" checked={unattributed} onChange={(e) => setUnattributed(e.target.checked)} />
                <span className={styles.title}>Unattributed (free chat / planning)</span>
                <span className={styles.phase}>{money(unattributedSpend)}</span>
              </label>
            </div>
            <div className={styles.foot}>
              <Button variant="secondary" onClick={onClose}>Cancel</Button>
              <Button variant="primary" onClick={() => setStage('confirm')}>Continue…</Button>
            </div>
          </>
        ) : (
          <>
            <h2 className={styles.h2}>Reset total spend</h2>
            <p className={styles.warn}>
              This permanently zeroes your lifetime total{bucketCount > 0 ? ` and ${bucketCount} per-book bucket${bucketCount === 1 ? '' : 's'}` : ''}. There is no undo.
            </p>
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
              <Button variant="primary" onClick={doReset} disabled={!phraseOk || busy}>
                {busy ? 'Resetting…' : 'Reset total spend'}
              </Button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
