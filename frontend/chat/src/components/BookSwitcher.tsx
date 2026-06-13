import { useBooks, useActiveBook, useBooksLoaded, useStore, api } from '@bookclaw/shared';
import styles from '../App.module.css';

export function BookSwitcher() {
  const books = useBooks();
  const activeBook = useActiveBook();
  const booksLoaded = useBooksLoaded();
  const loadBooks = useStore((s) => s.loadBooks);

  async function setActive(slug: string) {
    try {
      await api<void>('/api/books/active', {
        method: 'POST',
        body: JSON.stringify({ slug }),
      });
      await loadBooks();
    } catch { /* ignore — gateway may not be up yet */ }
  }

  if (books.length === 0) {
    return (
      <>
        <div className={styles.lbl}>Your books</div>
        <div style={{ padding: '8px 12px', fontSize: '12.5px', color: 'var(--faint)' }}>
          {/* Don't show the empty-state copy before the first fetch resolves. */}
          {booksLoaded ? 'No books yet. Start one with the button above.' : 'Loading…'}
        </div>
      </>
    );
  }

  return (
    <>
      <div className={styles.lbl}>Your books</div>
      {books.map((book) => {
        const isActive = book.slug === activeBook?.slug;
        return (
          <div
            key={book.slug}
            className={`${styles.book} ${isActive ? styles.bookOn : ''}`}
            onClick={() => setActive(book.slug)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter') setActive(book.slug); }}
          >
            <div className={styles.cv} />
            <div className={styles.bookMeta}>
              <div className={styles.bookTitle}>{book.title}</div>
              <div className={styles.bookPhase}>{book.phase}</div>
              {book.genre && <div className={styles.bookByline}>{book.genre}</div>}
            </div>
          </div>
        );
      })}
    </>
  );
}
