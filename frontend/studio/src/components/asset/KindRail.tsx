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
    id: 'section', label: 'Sections',
    svg: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16v5H4zM4 13h16v7H4z"/></svg>,
  },
  {
    id: 'skill', label: 'Skills',
    svg: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L3 14h7l-1 8 10-12h-7z"/></svg>,
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
