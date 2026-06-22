import type { LibraryKind } from '@bookclaw/shared';
import styles from '../../routes/AssetStudio.module.css';

interface Props {
  kind: LibraryKind;
  onKind: (k: LibraryKind) => void;
}

const KINDS: Array<{ id: LibraryKind; label: string; svg: React.ReactNode }> = [
  {
    id: 'author', label: 'Authors',
    svg: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 00-8 0v2M12 11a4 4 0 100-8 4 4 0 000 8z"/></svg>,
  },
  {
    id: 'voice', label: 'Voices',
    svg: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 10v4M7 6v12M11 3v18M15 7v10M19 10v4"/></svg>,
  },
  {
    id: 'genre', label: 'Genres',
    svg: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 5h16M4 12h16M4 19h10"/></svg>,
  },
  {
    id: 'pipeline', label: 'Pipelines',
    svg: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="5" cy="6" r="2"/><circle cx="5" cy="18" r="2"/><path d="M5 8v8M7 6h7a3 3 0 013 3 3 3 0 01-3 3H7"/></svg>,
  },
  {
    id: 'sequence', label: 'Sequences',
    svg: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6h11M4 12h16M4 18h11"/><path d="M19 4l3 2-3 2M19 14l3 2-3 2"/></svg>,
  },
  {
    id: 'section', label: 'Sections',
    svg: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16v5H4zM4 13h16v7H4z"/></svg>,
  },
  {
    id: 'skill', label: 'Skills',
    svg: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L3 14h7l-1 8 10-12h-7z"/></svg>,
  },
  {
    id: 'editor', label: 'Editors',
    svg: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/></svg>,
  },
  {
    id: 'prompt', label: 'Prompts',
    svg: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 17l6-6-6-6M12 19h8"/></svg>,
  },
  {
    id: 'world', label: 'Worlds',
    svg: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.5 3.8 5.7 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.7-3.8-9S9.5 5.5 12 3z"/></svg>,
  },
];

export function KindRail({ kind, onKind }: Props) {
  return (
    <div className={styles.kinds}>
      <div className={styles.lbl}>Asset kinds</div>
      {KINDS.map((k) => (
        <div
          key={k.id}
          className={`${styles.kind}${kind === k.id ? ' ' + styles.on : ''}`}
          onClick={() => onKind(k.id)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onKind(k.id); }}
        >
          {k.svg}
          {k.label}
        </div>
      ))}
    </div>
  );
}
