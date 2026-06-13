import { useEffect, useRef, useState } from 'react';
import { subscribeChat, sendChat, hhmm } from '@bookclaw/shared';
import styles from '../../routes/Write.module.css';

interface Msg { who: 'me' | 'ai'; text: string; t: string }

export function ChatThread() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState('');
  const [waiting, setWaiting] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  // Mirror `waiting` into a ref so the (once-only) subscription closure can read
  // the live value to drop a stale reply that lands after a reconnect.
  const waitingRef = useRef(false);
  waitingRef.current = waiting;

  useEffect(() => subscribeChat({
    onReply: (text) => { setMsgs((m) => [...m, { who: 'ai', text, t: hhmm() }]); setWaiting(false); },
    onError: (msg) => { setMsgs((m) => [...m, { who: 'ai', text: `⚠ ${msg}`, t: hhmm() }]); setWaiting(false); },
    // If the socket drops while waiting, unlock the composer so the user isn't stuck.
    onDisconnect: () => {
      setWaiting(false);
      setMsgs((m) => [...m, { who: 'ai', text: 'Disconnected — reconnecting…', t: hhmm() }]);
    },
    onNotice: (msg) => { setMsgs((m) => [...m, { who: 'ai', text: msg, t: hhmm() }]); },
    isWaiting: () => waitingRef.current,
  }), []);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs, waiting]);

  const send = () => {
    const text = draft.trim();
    if (!text || waiting) return;
    setMsgs((m) => [...m, { who: 'me', text, t: hhmm() }]);
    setDraft(''); setWaiting(true);
    sendChat(text);
  };

  return (
    <div className={styles.wmid}>
      <div className={styles.thread}>
        {msgs.map((m, i) => (
          <div key={i} className={`${styles.msg} ${m.who === 'me' ? styles.msgMe : ''}`}>
            <div className={`${styles.av} ${m.who === 'ai' ? styles.ai : styles.me}`}>{m.who === 'ai' ? 'BC' : 'P'}</div>
            <div className={styles.mbody}>
              <div className={styles.who}>{m.who === 'ai' ? 'BookClaw' : 'You'} · {m.t}</div>
              <div className={`${styles.mtext} ${m.who === 'ai' ? styles.aiText : ''}`}>{m.text}</div>
            </div>
          </div>
        ))}
        {waiting && (
          <div className={styles.msg}>
            <div className={`${styles.av} ${styles.ai}`}>BC</div>
            <div className={styles.mbody}>
              <div className={styles.who}>BookClaw</div>
              <div className={`${styles.mtext} ${styles.dimmed}`}>Thinking…</div>
            </div>
          </div>
        )}
        {msgs.length === 0 && !waiting && (
          <p className={styles.dimmed} style={{ textAlign: 'center' }}>
            Steer the draft, or ask for the next chapter.
          </p>
        )}
        <div ref={endRef} />
      </div>
      <div className={styles.composer}>
        <div className={styles.cbox}>
          <textarea
            className={styles.cinput}
            value={draft}
            placeholder="Steer the draft, or ask for the next chapter…"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            rows={2}
          />
          <div className={styles.crow}>
            <button className={styles.send} onClick={send} disabled={waiting || !draft.trim()} title="Send (Enter)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
