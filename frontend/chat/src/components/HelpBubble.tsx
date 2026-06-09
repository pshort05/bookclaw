import { useState, useEffect, useRef } from 'react';
import { useActiveBook } from '@bookclaw/shared';
import styles from '../App.module.css';

export function HelpBubble() {
  const [open, setOpen] = useState(false);
  const helpRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const activeBook = useActiveBook();
  const phase = activeBook?.phase ?? '';

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        helpRef.current && !helpRef.current.contains(e.target as Node) &&
        btnRef.current && !btnRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        className={styles.helpbtn}
        onClick={() => setOpen((v) => !v)}
        title="Help"
        aria-label="Help"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9"/>
          <path d="M9.5 9a2.5 2.5 0 015 0c0 1.7-2.5 2-2.5 4"/>
          <path d="M12 17h.01"/>
        </svg>
      </button>

      <div ref={helpRef} className={`${styles.help} ${open ? styles.helpOn : ''}`}>
        <h4 className={styles.helpH4}>What now?</h4>
        <p className={styles.helpP}>
          This tip changes with where you are in your book.
          {phase ? ` Right now you're in the ${phase} phase.` : ' Select a book to get started.'}
        </p>

        <div className={styles.helpRec}>
          <div className={styles.helpRecKey}>Recommended</div>
          <div className={styles.helpRecMsg}>
            {phase === 'draft' || phase === 'writing'
              ? 'Say "write the next chapter" to keep the draft moving.'
              : phase === 'revision' || phase === 'editing'
              ? 'Say "revise this chapter" and paste or reference the chapter you want improved.'
              : phase === 'planning' || phase === 'outline'
              ? 'Say "plan the next section" or ask BookClaw to build out the outline.'
              : 'Start by telling BookClaw what you want to work on today.'}
          </div>
        </div>

        <div className={styles.helpTtl}>Other things you can say</div>
        <button className={styles.helpSay} onClick={() => setOpen(false)}>
          <b>"write the next chapter"</b> — draft the next scene
        </button>
        <button className={styles.helpSay} onClick={() => setOpen(false)}>
          <b>"make a cover"</b> — design the book cover
        </button>
        <button className={styles.helpSay} onClick={() => setOpen(false)}>
          <b>"read it back to me"</b> — hear the chapter aloud
        </button>
        <button className={styles.helpSay} onClick={() => setOpen(false)}>
          <b>"I'm done — make my book file"</b> — export to ePub/Word
        </button>
      </div>
    </>
  );
}
