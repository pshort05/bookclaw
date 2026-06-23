import { NavLink } from 'react-router-dom';
import { useStore, useCosts, usePendingConfirmations, useBooks, useStatus, money, chatPort } from '@bookclaw/shared';
import { useEffect } from 'react';
import styles from './Rail.module.css';

export function Rail() {
  // The Chat app runs on BOOKCLAW_CHAT_PORT, injected into the studio HTML at
  // serve time. Empty means chat is disabled — hide the link rather than point
  // at a dead port.
  const chatHref = chatPort() ? `${location.protocol}//${location.hostname}:${chatPort()}/` : '';
  const costs = useCosts();
  const pending = usePendingConfirmations();
  const books = useBooks();
  const status = useStatus();
  const generating = books.filter((b) => b.live).length;
  const idle = books.length - generating;
  const loadCosts = useStore((s) => s.loadCosts);
  const loadConfirmations = useStore((s) => s.loadConfirmations);
  const loadStatus = useStore((s) => s.loadStatus);
  useEffect(() => {
    loadCosts().catch(() => {});
    loadConfirmations().catch(() => {});
    loadStatus().catch(() => {});
  }, [loadCosts, loadConfirmations, loadStatus]);

  return (
    <aside className={styles.rail}>
      {/* Brand */}
      <div className={styles.brand}>
        <span className={styles.mark} title="BookClaw">
          <svg viewBox="0 0 24 24" fill="none">
            <path d="M5 19c3-1 5-5 5-10 0 5 3 8 6 8M9 4c.5 3 2 5 4 6M14 3c.3 2.5 1.6 4.3 3.4 5.6" stroke="#1a0f08" strokeWidth="1.7" strokeLinecap="round"/>
          </svg>
        </span>
        <div>
          <div className={styles.name}>Book<b>Claw</b></div>
          <div className={styles.ver}>{status?.version ? `${status.version} · studio` : 'studio'}</div>
        </div>
      </div>

      {/* Nav */}
      <nav className={styles.nav}>
        <div className={styles.lbl}>Studio</div>

        {/* Book Board — the only live route in 6a */}
        <NavLink
          to="/"
          end
          className={({ isActive }) => isActive ? `${styles.navLink} ${styles.active}` : styles.navLink}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
            <rect x="3" y="3" width="7" height="9" rx="1.5"/>
            <rect x="14" y="3" width="7" height="5" rx="1.5"/>
            <rect x="14" y="12" width="7" height="9" rx="1.5"/>
            <rect x="3" y="16" width="7" height="5" rx="1.5"/>
          </svg>
          Book Board <span className={styles.count}>{books.length}</span>
        </NavLink>

        {/* Write — live route */}
        <NavLink
          to="/write"
          className={({ isActive }) => isActive ? `${styles.navLink} ${styles.active}` : styles.navLink}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
            <path d="M4 20l3-1 11-11-2-2L5 17l-1 3z"/>
            <path d="M14 5l3 3"/>
          </svg>
          Write
        </NavLink>

        {/* New Book — Easy: the 3-click Starter-Bundle wizard */}
        <NavLink
          to="/start"
          className={({ isActive }) => isActive ? `${styles.navLink} ${styles.active}` : styles.navLink}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3v18M3 12h18"/>
            <path d="M19 5l.8 1.7L21.5 7.5l-1.7.8L19 10l-.8-1.7L16.5 7.5l1.7-.8z"/>
          </svg>
          New (Easy)
        </NavLink>

        {/* Chat — external link to the standalone Chat app on BOOKCLAW_CHAT_PORT
            (injected at serve time). Hidden when chat is disabled (port unset). */}
        {chatHref && (
          <a
            href={chatHref}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.navLink}
            title="Open the Chat app"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12a8 8 0 01-11.5 7.2L4 20l1-4.3A8 8 0 1121 12z"/>
            </svg>
            Chat
            <svg className={styles.ext} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 17L17 7M9 7h8v8"/>
            </svg>
          </a>
        )}

        {/* Series — live route */}
        <NavLink
          to="/series"
          className={({ isActive }) => isActive ? `${styles.navLink} ${styles.active}` : styles.navLink}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 19V6a2 2 0 012-2h5v15H6a2 2 0 00-2 2z"/>
            <path d="M20 19V6a2 2 0 00-2-2h-5v15h5a2 2 0 012 2z"/>
          </svg>
          Series
        </NavLink>

        {/* Activity — live route */}
        <NavLink
          to="/activity"
          className={({ isActive }) => isActive ? `${styles.navLink} ${styles.active}` : styles.navLink}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 12h4l2 6 4-14 2 8h6"/>
          </svg>
          Activity
        </NavLink>

        <div className={styles.lbl}>Make</div>

        {/* Library — Asset Studio */}
        <NavLink
          to="/library"
          className={({ isActive }) => isActive ? `${styles.navLink} ${styles.active}` : styles.navLink}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 7l9-4 9 4-9 4-9-4z"/>
            <path d="M3 7v6l9 4 9-4V7"/>
          </svg>
          Library
        </NavLink>

        {/* Files — document + book-output explorer */}
        <NavLink
          to="/files"
          className={({ isActive }) => isActive ? `${styles.navLink} ${styles.active}` : styles.navLink}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 5a2 2 0 012-2h4l2 3h6a2 2 0 012 2v9a2 2 0 01-2 2H6a2 2 0 01-2-2z"/>
          </svg>
          Files
        </NavLink>

        {/* Prompt Runner — run a writing-craft prompt against a book file */}
        <NavLink
          to="/prompt-runner"
          className={({ isActive }) => isActive ? `${styles.navLink} ${styles.active}` : styles.navLink}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 17l6-6-6-6M12 19h8"/>
          </svg>
          Prompt Runner
        </NavLink>

        {/* Consistency — post-writing consistency auditor */}
        <NavLink
          to="/consistency"
          className={({ isActive }) => isActive ? `${styles.navLink} ${styles.active}` : styles.navLink}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 11l3 3L22 4"/>
            <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
          </svg>
          Consistency
        </NavLink>

        {/* Structure & Length — per-book format review */}
        <NavLink
          to="/structure-length"
          className={({ isActive }) => isActive ? `${styles.navLink} ${styles.active}` : styles.navLink}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 3v18h18"/>
            <path d="M7 16l4-6 4 3 4-7"/>
          </svg>
          Structure &amp; Length
        </NavLink>

        {/* Insights — live route */}
        <NavLink
          to="/insights"
          className={({ isActive }) => isActive ? `${styles.navLink} ${styles.active}` : styles.navLink}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
            <path d="M4 18V9M9 18V5M14 18v-6M19 18v-9"/>
          </svg>
          Insights
        </NavLink>

        {/* Settings — live route */}
        <NavLink
          to="/settings"
          className={({ isActive }) => isActive ? `${styles.navLink} ${styles.active}` : styles.navLink}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 15a3 3 0 100-6 3 3 0 000 6z"/>
            <path d="M19 12a7 7 0 00-.1-1l2-1.6-2-3.4-2.3 1a7 7 0 00-1.7-1l-.4-2.5H9.5L9 5.4a7 7 0 00-1.7 1l-2.3-1-2 3.4L5 11a7 7 0 000 2l-2 1.6 2 3.4 2.3-1a7 7 0 001.7 1l.4 2.5h4.9l.4-2.5a7 7 0 001.7-1l2.3 1 2-3.4-2-1.6c.1-.3.1-.6.1-1z"/>
          </svg>
          Settings
        </NavLink>

        <div className={styles.lbl}>Approvals</div>

        {/* Confirmations — live route with badge */}
        <NavLink
          to="/confirmations"
          className={({ isActive }) => isActive ? `${styles.navLink} ${styles.active}` : styles.navLink}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2l8 4v5c0 5-3.4 8.5-8 11-4.6-2.5-8-6-8-11V6l8-4z"/>
            <path d="M9 12l2 2 4-4"/>
          </svg>
          Confirmations {pending.length > 0 && <span className={styles.badge}>{pending.length}</span>}
        </NavLink>
      </nav>

      <div className={styles.spacer}></div>

      {/* Status/spend footer — static visual for 6a */}
      <div className={styles.status}>
        <div className={styles.row}>
          <span className={`${styles.dot} ${styles.dotGen}`}></span>
          Generating <span className={styles.v}>{generating} {generating === 1 ? 'book' : 'books'}</span>
        </div>
        <div className={styles.row}>
          <span className={styles.dot}></span>
          Idle <span className={styles.v}>{idle} {idle === 1 ? 'book' : 'books'}</span>
        </div>
        <div className={styles.budget}>
          <div className={styles.cap}>
            <span>AI spend · today</span>
            <b>{money(costs?.daily ?? 0)} / ${(costs?.dailyLimit ?? 0).toFixed(2)}</b>
          </div>
          <div className={styles.bar}>
            <i style={{ width: `${costs && costs.dailyLimit > 0 ? Math.min(100, (costs.daily / costs.dailyLimit) * 100) : 0}%` }} />
          </div>
          <div className={styles.cap}>
            <span>AI spend · lifetime</span>
            <b>{money(costs?.total ?? 0)}</b>
          </div>
        </div>
      </div>
    </aside>
  );
}
