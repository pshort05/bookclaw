import { useEffect, useState } from 'react';
import { api } from '@bookclaw/shared';
import styles from '../../routes/Write.module.css';

export function OutlinePane({
  title,
  subtitle,
  projectId,
  readyCount,
}: {
  title: string;
  subtitle?: string;
  projectId?: string;
  // Number of completed steps in the active project. The list is re-fetched
  // whenever this changes so newly-produced step outputs appear as the pipeline
  // advances — without it the pane fetched once (empty at start) and never
  // refreshed, so outputs only showed up in the Files screen.
  readyCount?: number;
}) {
  const [files, setFiles] = useState<{ name: string }[]>([]);

  useEffect(() => {
    if (!projectId) { setFiles([]); return; }
    let cancelled = false;
    api<{ files: { name: string }[] }>(`/api/projects/${encodeURIComponent(projectId)}/files`)
      .then((r) => { if (!cancelled) setFiles((r.files ?? []).filter((f) => f.name.endsWith('.md'))); })
      .catch(() => { if (!cancelled) setFiles([]); });
    return () => { cancelled = true; };
  }, [projectId, readyCount]);

  const label = (name: string) => name.replace(/^[^-]+-/, '').replace(/\.md$/, '').replace(/-/g, ' ');

  return (
    <div className={`${styles.wcol} ${styles.wleft}`}>
      <div className={styles.wtitle}>{title}</div>
      {subtitle && <div className={styles.wsub}>{subtitle}</div>}
      <div className={styles.sec}>Outline{files.length ? ` · ${files.length} files` : ''}</div>
      {files.length === 0 ? (
        <p className={styles.dimmed}>No outputs yet. Start the pipeline from the right.</p>
      ) : files.map((f, i) => (
        <div key={f.name} className={styles.chap}>
          <span className={styles.num}>{String(i + 1).padStart(2, '0')}</span>
          {label(f.name)}
        </div>
      ))}
    </div>
  );
}
