import { useCallback, useEffect, useState } from 'react';
import { useParams, useSearchParams, useLocation, Link } from 'react-router-dom';
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

  // Easy Button hand-off: ?autostart=1 (+ optional premise in navigation state)
  // tells PipelineRail to start the pipeline once. Capture both on first render,
  // then strip the query param so a refresh doesn't restart generation.
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const [autoStart] = useState(() => searchParams.get('autostart') === '1');
  const [autoStartPremise] = useState<string | undefined>(
    () => (location.state as { premise?: string } | null)?.premise,
  );
  useEffect(() => {
    if (searchParams.get('autostart')) setSearchParams({}, { replace: true });
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      // Reveal the panes now that activation + book fetch are complete. Activation
      // already succeeded server-side above, so reveal even if the store mirror
      // (activeSlug) hasn't caught up — a failed loadBooks() would otherwise leave
      // the page stuck on "Loading…" forever. Superseded effects are handled by
      // the `cancelled` guard, not the slug comparison.
      setReady(true);
    })();
    return () => { cancelled = true; };
  }, [slug, paramSlug, active?.slug, loadBooks]);

  // Bind the book's current/frontier project (the chained pipeline's active phase)
  // so the rail shows live steps/progress and its run actions target the existing
  // project instead of creating a new one. Skipped under ?autostart=1 — the Easy
  // Button hand-off owns project creation for a brand-new book.
  useEffect(() => {
    if (autoStart || !slug) return;
    let cancelled = false;
    (async () => {
      const r = await api<{ project: Project | null }>(
        `/api/books/${encodeURIComponent(slug)}/current-project`,
      ).catch(() => null);
      if (!cancelled && r?.project) setProject(r.project);
    })();
    return () => { cancelled = true; };
  }, [slug, autoStart]);

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
        readyCount={project?.steps?.filter((s) => s.status === 'completed').length ?? 0}
      />
      <ChatThread />
      <PipelineRail
        slug={slug}
        activeProject={project}
        onProjectChange={handleProjectChange}
        autoStart={autoStart}
        autoStartPremise={autoStartPremise}
      />
    </div>
  );
}
