import { useState, useEffect } from 'react';
import { useActiveBook, api } from '@bookclaw/shared';
import type { BookDetail, LibraryPipeline } from '@bookclaw/shared';
import styles from '../App.module.css';

export function MadeList() {
  const activeBook = useActiveBook();
  const [detail, setDetail] = useState<BookDetail | null>(null);
  const [pipeline, setPipeline] = useState<LibraryPipeline | null>(null);

  useEffect(() => {
    if (!activeBook) { setDetail(null); setPipeline(null); return; }
    let cancelled = false;

    api<BookDetail>(`/api/books/${activeBook.slug}`)
      .then((r) => { if (!cancelled) setDetail(r); })
      .catch(() => { if (!cancelled) setDetail(null); });

    // Fix C: the correct route is GET /api/books/active/templates/pipeline (no slug,
    // no /templates/pipeline sub-path on the slug route). Response is { content, wired }
    // where content is the raw JSON string of the LibraryPipeline; pipeline key does not
    // exist. Parse content and read .steps for the pipeline plan display.
    api<{ content: string; wired: boolean }>('/api/books/active/templates/pipeline')
      .then((r) => {
        if (cancelled) return;
        try {
          const parsed: LibraryPipeline = JSON.parse(r.content);
          setPipeline(parsed);
        } catch { setPipeline(null); }
      })
      .catch(() => { if (!cancelled) setPipeline(null); });

    return () => { cancelled = true; };
  }, [activeBook?.slug]);

  if (!activeBook) {
    return (
      <aside className={styles.right}>
        <h3 className={styles.rtitle}>What you've made</h3>
        <div className={styles.rsub}>Select a book to see its assets.</div>
      </aside>
    );
  }

  const book = detail?.book;
  const descriptions = detail?.descriptions ?? {};

  // Build asset rows from the book's pulled references (author/voice/genre/pipeline)
  const assets: Array<{ label: string; sub: string }> = [];

  if (book?.pulledFrom) {
    const { author, voice, genre, pipeline: pipelineRef } = book.pulledFrom;
    if (author) {
      assets.push({
        label: `Author: ${author.name}`,
        sub: descriptions.author || author.source,
      });
    }
    if (voice) {
      assets.push({
        label: `Voice: ${voice.name}`,
        sub: descriptions.voice || voice.source,
      });
    }
    if (genre) {
      assets.push({
        label: `Genre: ${genre.name}`,
        sub: descriptions.genre || genre.source,
      });
    }
    if (pipelineRef) {
      assets.push({
        label: `Pipeline: ${pipelineRef.name}`,
        sub: pipelineRef.source,
      });
    }
    if (book.pulledFrom.sections?.length) {
      assets.push({
        label: `Sections`,
        sub: book.pulledFrom.sections.join(', '),
      });
    }
  }

  return (
    <aside className={styles.right}>
      <h3 className={styles.rtitle}>What you've made</h3>
      <div className={styles.rsub}>Everything for this book.</div>

      {/* Book assets (author/voice/genre/pipeline — what the book is built from) */}
      {assets.map((a) => (
        <div key={a.label} className={styles.asset}>
          <div className={`${styles.assetIcon} ${styles.assetIconOk}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6L9 17l-5-5"/>
            </svg>
          </div>
          <div className={styles.assetInfo}>
            <div className={styles.assetName}>{a.label}</div>
            <div className={styles.assetSub}>{a.sub}</div>
          </div>
        </div>
      ))}

      {/* Pipeline plan steps */}
      {pipeline && pipeline.steps && pipeline.steps.length > 0 && (
        <div className={styles.planSection}>
          <div className={styles.planTitle}>Pipeline plan</div>
          {pipeline.steps.map((step, i) => (
            <div key={i} className={styles.planStep}>
              <span className={styles.planStepDot} />
              {step.label}
            </div>
          ))}
        </div>
      )}

      {/* NOTE: A richer "what you've made" list (actual output files) needs a
          GET /api/books/:slug/files endpoint that doesn't exist yet. The above
          shows real book assets and the pipeline plan instead of fabricated rows. */}
    </aside>
  );
}
