import { useState, useEffect, useRef, useCallback } from 'react';
import { subscribeChat, sendChat, useActiveBook } from '@bookclaw/shared';
import { Suggest } from './Suggest.js';
import styles from '../App.module.css';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

const QUICK_CHIPS = [
  'write the next chapter',
  'make a cover',
  'read it back to me',
  'what happens next?',
];

export function ChatPane() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [waiting, setWaiting] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);
  const activeBook = useActiveBook();

  // Scroll to bottom when messages change
  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [messages, waiting]);

  // Subscribe to chat events once (socket stays alive for the session)
  useEffect(() => {
    const unsub = subscribeChat({
      onReply: (text) => {
        setMessages((prev) => [...prev, { role: 'assistant', content: text }]);
        setWaiting(false);
      },
      onError: (msg) => {
        setMessages((prev) => [...prev, { role: 'assistant', content: `[error] ${msg}` }]);
        setWaiting(false);
      },
      onDisconnect: () => {
        setWaiting(false);
      },
    });
    return unsub;
  }, []);

  const doSend = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed || waiting) return;
    setMessages((prev) => [...prev, { role: 'user', content: trimmed }]);
    setWaiting(true);
    setInput('');
    sendChat(trimmed);
  }, [waiting]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      doSend(input);
    }
  };

  const title = activeBook?.title ?? 'BookClaw';
  const phase = activeBook?.phase ?? '';

  return (
    <section className={styles.center}>
      {/* Header */}
      <header className={styles.chead}>
        <div className={styles.cheadTitle}>
          {title}
          {phase && <em> · {phase}</em>}
        </div>
        {phase && (
          <div className={styles.cheadPhase}>
            <span className={styles.cheadPhaseDot} />
            {phase}
          </div>
        )}
      </header>

      {/* Thread */}
      <div className={styles.thread} ref={threadRef}>
        {messages.length === 0 && (
          <div className={styles.msg}>
            <div className={`${styles.av} ${styles.avAi}`}>BC</div>
            <div className={styles.body}>
              <div className={styles.who}>BookClaw</div>
              <div className={`${styles.bubble} ${styles.bubbleAi}`}>
                {activeBook
                  ? `Welcome back. Ready to work on ${activeBook.title}. What would you like to do?`
                  : 'Welcome to BookClaw. Select a book from the left, or start a new one to begin.'}
              </div>
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`${styles.msg} ${msg.role === 'user' ? styles.msgMe : ''}`}>
            <div className={`${styles.av} ${msg.role === 'assistant' ? styles.avAi : styles.avMe}`}>
              {msg.role === 'assistant' ? 'BC' : 'You'}
            </div>
            <div className={styles.body}>
              <div className={styles.who}>{msg.role === 'assistant' ? 'BookClaw' : 'You'}</div>
              <div className={`${styles.bubble} ${msg.role === 'assistant' ? styles.bubbleAi : ''}`}>
                {msg.content}
              </div>
            </div>
          </div>
        ))}

        {waiting && (
          <div className={styles.msg}>
            <div className={`${styles.av} ${styles.avAi}`}>BC</div>
            <div className={styles.body}>
              <div className={styles.who}>BookClaw · thinking</div>
              <div className={styles.thinking}>
                <span className={styles.dot1} />
                <span className={styles.dot2} />
                <span className={styles.dot3} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Composer */}
      <div className={styles.composer}>
        <Suggest onSend={doSend} />

        <div className={styles.cbox}>
          <textarea
            className={styles.cboxInput}
            placeholder="Tell BookClaw what to write or change…"
            value={input}
            rows={1}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={waiting}
          />
          <div className={styles.chips}>
            {QUICK_CHIPS.map((chip) => (
              <span
                key={chip}
                className={styles.qc}
                role="button"
                tabIndex={0}
                onClick={() => doSend(chip)}
                onKeyDown={(e) => { if (e.key === 'Enter') doSend(chip); }}
              >
                {chip}
              </span>
            ))}
          </div>
          <div className={styles.crow}>
            <span className={styles.crowHint}>
              BookClaw writes one step at a time, so nothing runs away from you.
            </span>
            <button
              className={styles.send}
              onClick={() => doSend(input)}
              disabled={waiting || !input.trim()}
              aria-label="Send"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14M13 6l6 6-6 6"/>
              </svg>
            </button>
          </div>
        </div>

        <div className={styles.hintline}>
          Stuck? Tap the <b style={{ color: 'var(--ember)' }}>?</b> in the corner for help — the tip updates as your book grows.
        </div>
      </div>
    </section>
  );
}
