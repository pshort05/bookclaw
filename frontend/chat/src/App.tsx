import { useEffect } from 'react';
import { useStore, apiBase } from '@bookclaw/shared';
import { BookSwitcher } from './components/BookSwitcher.js';
import { ChatPane } from './components/ChatPane.js';
import { Stats } from './components/Stats.js';
import { MadeList } from './components/MadeList.js';
import { HelpBubble } from './components/HelpBubble.js';
import styles from './App.module.css';

export function App() {
  const loadBooks = useStore((s) => s.loadBooks);

  useEffect(() => {
    loadBooks().catch(() => {});
  }, [loadBooks]);

  // Derive studio link: same host, gateway port 3847.
  // The gateway serves the studio at its own port (3847); the chat app is on 3848.
  const studioOrigin = apiBase() || `${location.protocol}//${location.hostname}:3847`;

  return (
    <>
      <div className={styles.app}>
        {/* Left: book list + stats */}
        <aside className={styles.left}>
          {/* Brand */}
          <div className={styles.brand}>
            <span className={styles.mark}>
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M5 19c3-1 5-5 5-10 0 5 3 8 6 8M9 4c.5 3 2 5 4 6M14 3c.3 2.5 1.6 4.3 3.4 5.6" stroke="#1a0f08" strokeWidth="1.7" strokeLinecap="round"/>
              </svg>
            </span>
            <div>
              <div className={styles.brandName}>Book<b>Claw</b></div>
              <div className={styles.brandSub}>write together</div>
            </div>
          </div>

          {/* Start a new book → studio /new-book */}
          <a
            href={`${studioOrigin}/new-book`}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.newbtn}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <path d="M12 5v14M5 12h14"/>
            </svg>
            Start a new book
          </a>

          <BookSwitcher />

          <div className={styles.spacer} />

          {/* Open the Studio link */}
          <a
            href={studioOrigin}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.studioLink}
            title="Open the full Studio in a new window"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="9" rx="1.5"/>
              <rect x="14" y="3" width="7" height="5" rx="1.5"/>
              <rect x="14" y="12" width="7" height="9" rx="1.5"/>
              <rect x="3" y="16" width="7" height="5" rx="1.5"/>
            </svg>
            Open the Studio
            <svg className={styles.ext} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 17L17 7M9 7h8v8"/>
            </svg>
          </a>

          <Stats />
        </aside>

        {/* Center: chat */}
        <ChatPane />

        {/* Right: what you've made */}
        <MadeList />
      </div>

      {/* Fixed help bubble */}
      <HelpBubble />
    </>
  );
}
