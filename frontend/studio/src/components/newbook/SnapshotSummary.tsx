import { Button } from '@bookclaw/shared';
import styles from '../../routes/NewBook.module.css';

export function SnapshotSummary({ title, author, voice, genre, world, pipeline, sectionCount, skills, canCreate, busy, onCreate }: {
  title: string; author?: string; voice?: string; genre?: string | null; world?: string | null; pipeline?: string;
  sectionCount: number; skills: string[]; canCreate: boolean; busy: boolean; onCreate: () => void;
}) {
  return (
    <aside className={styles.summary}>
      <div className={styles.scard}>
        <div className={styles.cover}>
          <div className={styles.ct}>{title || 'Untitled'}</div>
          <div className={styles.cs}>{genre || '—'}</div>
        </div>
        <div className={styles.slabel}>This book will contain</div>
        <div className={styles.srow}><span>Author</span><b>{author || '—'}</b></div>
        <div className={styles.srow}><span>Voice</span><b>{voice || '—'}</b></div>
        <div className={styles.srow}><span>Genre</span><b>{genre || '—'}</b></div>
        <div className={styles.srow}><span>World</span><b>{world || '—'}</b></div>
        <div className={styles.srow}><span>Pipeline</span><b>{pipeline || '—'}</b></div>
        <div className={styles.srow}><span>Sections</span><b>{sectionCount}</b></div>
        <div className={styles.srow}><span>Skills</span><b>{skills.length ? `${skills.length} (from pipeline)` : '—'}</b></div>
        {skills.length > 0 && (
          <div className={styles.snote}>Skills come with the pipeline: {skills.join(', ')}.</div>
        )}
        <div className={styles.snote}>A copy of these templates is frozen into the book at creation; edit them per-book in the Asset Studio.</div>
        <Button variant="primary" onClick={onCreate} disabled={!canCreate}>
          {busy ? 'Creating…' : 'Create book'}
        </Button>
      </div>
    </aside>
  );
}
