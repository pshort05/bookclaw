import { useNavigate } from 'react-router-dom';
import styles from './NewHub.module.css';

// The "New Book" hub: the single entry point for every way to start a book.
// Both the Rail "New" item and the Book Board's "New book" card route here.
// Layout mirrors the Romance Workflow design's entry taxonomy
// (docs/superpowers/specs/2026-07-08-romance-workflow-design.md, decision 2):
//   New ▸ Easy (quick start / full setup)  ·  Advanced (romance seed modes).
// From a premise file, Guided, and Adaptive are all live.
type Option = { icon: string; title: string; tag: string; to?: string; soon?: boolean };

const EASY: Option[] = [
  { icon: '⚡', title: 'Quick start', tag: 'Describe it in a sentence, pick a starter bundle, and it plans itself.', to: '/start' },
  { icon: '🎛️', title: 'Full setup', tag: 'Choose every template yourself — author, voice, genre, pipeline sequence and format.', to: '/new-book' },
];

const ADVANCED: Option[] = [
  { icon: '📄', title: 'From a premise file', tag: 'Seed a romance novel from a free-form premise document — review the extracted seeds, grounded setting and gaps, then create.', to: '/premise' },
  { icon: '🧭', title: 'Guided', tag: 'A step-by-step form that collects the romance seeds (arc, characters, setting, heat) and builds the book.', to: '/guided' },
  { icon: '💬', title: 'Adaptive', tag: 'An AI-led conversational interview that draws the story out of you, then converges on the same seeds.', to: '/adaptive' },
];

export function NewHub() {
  const navigate = useNavigate();

  const card = (o: Option) => (
    <button
      key={o.title}
      type="button"
      className={`${styles.card} ${o.soon ? styles.soon : ''}`}
      disabled={o.soon}
      onClick={() => o.to && navigate(o.to)}
    >
      <span className={styles.icon} aria-hidden>{o.icon}</span>
      <span className={styles.cardTitle}>
        {o.title}
        {o.soon && <span className={styles.badge}>Coming soon</span>}
      </span>
      <span className={styles.cardTag}>{o.tag}</span>
    </button>
  );

  return (
    <div className={styles.wrap}>
      <h1 className={styles.h1}>New <em>book</em></h1>
      <p className={styles.sub}>How do you want to start? Everything is configurable later.</p>

      <h2 className={styles.section}>Easy</h2>
      <div className={styles.grid}>{EASY.map(card)}</div>

      <h2 className={styles.section}>Advanced <span className={styles.sectionNote}>· romance seed modes</span></h2>
      <div className={styles.grid}>{ADVANCED.map(card)}</div>
    </div>
  );
}
