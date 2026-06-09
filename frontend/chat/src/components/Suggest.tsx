import { useState, useEffect } from 'react';
import { useActiveBook, api } from '@bookclaw/shared';
import type { NextStep } from '@bookclaw/shared';
import styles from '../App.module.css';

interface SuggestProps {
  onSend: (text: string) => void;
}

export function Suggest({ onSend }: SuggestProps) {
  const activeBook = useActiveBook();
  const [next, setNext] = useState<NextStep | null>(null);

  useEffect(() => {
    if (!activeBook) { setNext(null); return; }
    let cancelled = false;
    // Fix D: the route returns { next: NextStep } — unwrap before storing so that
    // next.hint / next.label are defined and "Do it" sends the correct label string.
    api<{ next: NextStep | null }>(`/api/books/${activeBook.slug}/next`)
      .then((r) => { if (!cancelled) setNext(r.next); })
      .catch(() => { if (!cancelled) setNext(null); });
    return () => { cancelled = true; };
  }, [activeBook?.slug]);

  if (!next) return null;

  return (
    <div className={styles.suggest}>
      <div className={styles.suggestLb}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 18h6M10 22h4M12 2a7 7 0 00-4 12c.7.7 1 1.3 1 2h6c0-.7.3-1.3 1-2a7 7 0 00-4-12z"/>
        </svg>
      </div>
      <div className={styles.suggestTxt}>
        <div className={styles.suggestKey}>Suggested next step</div>
        <div className={styles.suggestMsg}>
          {next.hint || next.label}
        </div>
      </div>
      <button className={styles.suggestDo} onClick={() => onSend(next.label)}>
        Do it
      </button>
    </div>
  );
}
