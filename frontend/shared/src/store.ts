import { create } from 'zustand';
import { api } from './api.js';
import type { BookSummary, Status } from './types.js';

/** Active-book detail from GET /api/books/active: { active: { slug, book, status } | null } */
interface ActiveBookResponse {
  active: { slug: string; status: string } | null;
}

interface StoreState {
  status?: Status;
  books: BookSummary[];
  activeSlug?: string;
  /** true once loadBooks() has resolved successfully — lets callers tell
   *  "not fetched yet" apart from "fetched, no active book". */
  booksLoaded: boolean;
  loadStatus: () => Promise<void>;
  loadBooks: () => Promise<void>;
}

export const useStore = create<StoreState>((set) => ({
  books: [],
  booksLoaded: false,

  loadStatus: async () => {
    const status = await api<Status>('/api/status');
    set({ status });
  },

  // The books list and the active-book pointer are independent reads — fetch in parallel.
  loadBooks: async () => {
    const [r, a] = await Promise.all([
      api<{ books: BookSummary[] }>('/api/books'),
      api<ActiveBookResponse>('/api/books/active').catch(() => ({ active: null } as ActiveBookResponse)),
    ]);
    set({
      books: r.books ?? [],
      // active.slug is the slug field nested under the active wrapper object
      activeSlug: a.active?.slug ?? undefined,
      booksLoaded: true,
    });
  },
}));

/** All books in library order (newest first). */
export const useBooks = () => useStore((s) => s.books);

/** true once the books list has loaded at least once (vs. not yet fetched). */
export const useBooksLoaded = () => useStore((s) => s.booksLoaded);

/** The full BookSummary for the active book, or undefined if none is set. */
export const useActiveBook = () =>
  useStore((s) => s.books.find((b) => b.slug === s.activeSlug));
