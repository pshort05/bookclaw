import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Rail } from './Rail.js';
import styles from './App.module.css';

export function App() {
  const [navOpen, setNavOpen] = useState(false);

  // Close the mobile nav drawer on Escape (matches BookDrawer's affordance).
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setNavOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navOpen]);

  return (
    <div className={styles.app}>
      {/* Mobile-only top bar; display:none on desktop so layout is unchanged. */}
      <header className={styles.topbar}>
        <button
          className={styles.hamburger}
          aria-label="Open navigation"
          aria-expanded={navOpen}
          onClick={() => setNavOpen(true)}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
        <span className={styles.topbarTitle}>Book<b>Claw</b></span>
      </header>

      <Rail open={navOpen} onClose={() => setNavOpen(false)} />

      {/* Tap-to-dismiss backdrop; visible only when the drawer is open (mobile). */}
      <div
        className={navOpen ? `${styles.scrim} ${styles.scrimOn}` : styles.scrim}
        onClick={() => setNavOpen(false)}
      />

      <main className={styles.main}><Outlet /></main>
    </div>
  );
}
