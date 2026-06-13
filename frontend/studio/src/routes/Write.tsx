import { useCallback, useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api, useStore, useActiveBook, useBooksLoaded, type BookManifest, type Project } from '@bookclaw/shared';
import { OutlinePane } from '../components/write/OutlinePane.js';
import { ChatThread } from '../components/write/ChatThread.js';
import { PipelineRail } from '../components/write/PipelineRail.js';
import styles from './Write.module.css';

export function Write() {
  const { slug: paramSlug } = useParams();
  const active = useActiveBook();
  const booksLoaded = useBooksLoaded();
  const loadBooks = useStore((s) => s.loadBooks);
  const [book, setBook] = useState<BookManifest | null>(null);
  // No book↔project link yet (Phase 8); the rail shows the book's pipeline plan
  // and tracks only a project started in this session. Do not auto-bind [0].
  const [project, setProject] = useState<Project | undefined>(undefined);
  const [ready, setReady] = useState(false);
  const [activationError, setActivationError] = useState<string | null>(null);
  const slug = paramSlug || active?.slug;

  // Stable callback so PipelineRail's poll effect doesn't re-fire on re-renders.
  const handleProjectChange = useCallback((p: Project) => { setProject(p); }, []);

  // Deep-linking /write (no :slug) needs the store's first fetch to resolve before
  // we can tell "no active book" apart from "not fetched yet" — kick it off if idle.
  useEffect(() => { if (!booksLoaded) loadBooks().catch(() => {}); }, [booksLoaded, loadBooks]);

  useEffect(() => {
    let cancelled = false;
    if (!slug) return;
    setReady(false);
    setActivationError(null);
    (async () => {
      // If a slug was provided via the route param and it differs from the active book,
      // await activation + store refresh before rendering panes so they read the
      // correct book's pipeline rather than the previously-active book's.
      if (paramSlug && paramSlug !== active?.slug) {
        let activationFailed = false;
        await api('/api/books/active', { method: 'POST', body: JSON.stringify({ slug: paramSlug }) })
          .catch((e) => { activationFailed = true; if (!cancelled) setActivationError(String(e)); });
        if (activationFailed) return;
        await loadBooks().catch(() => {});
      }
      const d = await api<{ book: BookManifest }>(`/api/books/${encodeURIComponent(slug)}`).catch(() => null);
      if (cancelled) return;
      if (d) setBook(d.book);
      // Only reveal the panes once activation + book fetch are complete AND the
      // resolved active book matches the target slug (guards superseded effects).
      setReady(true);
    })();
    return () => { cancelled = true; };
  }, [slug, paramSlug, active?.slug, loadBooks]);

  if (!slug) {
    // Don't flash "No active book" before the first books fetch resolves.
    if (!booksLoaded) return <div className={styles.empty}>Loading…</div>;
    return (
      <div className={styles.empty}>
        No active book. <Link to="/">Open one from the Board.</Link>
      </div>
    );
  }

  if (activationError) {
    return (
      <div className={styles.empty}>
        Couldn't open this book for writing — {activationError}.{' '}
        <Link to="/">Back to the Board.</Link>
      </div>
    );
  }

  if (!ready) {
    return <div className={styles.empty}>Loading…</div>;
  }

  return (
    <div className={styles.writer}>
      <OutlinePane
        title={book?.title ?? slug}
        subtitle={book?.pulledFrom?.genre?.name ?? undefined}
        projectId={project?.id}
      />
      <ChatThread />
      <PipelineRail
        slug={slug}
        activeProject={project}
        onProjectChange={handleProjectChange}
      />
    </div>
  );
}
