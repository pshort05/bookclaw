import { create } from 'zustand';
import { api } from './api.js';
import type { BookSummary, Status, Costs, ActivityEntry, ConfirmationRequest } from './types.js';

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
  costs?: Costs;
  /** Most-recent-first activity buffer (capped). */
  activity: ActivityEntry[];
  confirmations: ConfirmationRequest[];
  loadCosts: () => Promise<void>;
  /** Loads the recent backlog (newest first). */
  loadActivity: (count?: number) => Promise<void>;
  /** Prepend a live entry (from the SSE stream); caps the buffer at 200. */
  pushActivity: (entry: ActivityEntry) => void;
  loadConfirmations: () => Promise<void>;
}

export const useStore = create<StoreState>((set) => ({
  books: [],
  booksLoaded: false,
  activity: [],
  confirmations: [],

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

  loadCosts: async () => {
    const costs = await api<Costs>('/api/costs');
    set({ costs });
  },

  // GET /api/activity returns { entries } oldest→newest; reverse to newest-first for the feed.
  loadActivity: async (count = 100) => {
    const r = await api<{ entries: ActivityEntry[] }>(`/api/activity?count=${count}`);
    set({ activity: (r.entries ?? []).slice().reverse() });
  },

  pushActivity: (entry) =>
    set((s) =>
      s.activity.some((e) => e.timestamp === entry.timestamp && e.message === entry.message)
        ? s
        : { activity: [entry, ...s.activity].slice(0, 200) },
    ),

  loadConfirmations: async () => {
    const r = await api<{ requests: ConfirmationRequest[] }>('/api/confirmations?status=pending');
    set({ confirmations: r.requests ?? [] });
  },
}));

/** All books in library order (newest first). */
export const useBooks = () => useStore((s) => s.books);

/** true once the books list has loaded at least once (vs. not yet fetched). */
export const useBooksLoaded = () => useStore((s) => s.booksLoaded);

/** The full BookSummary for the active book, or undefined if none is set. */
export const useActiveBook = () =>
  useStore((s) => s.books.find((b) => b.slug === s.activeSlug));

/** Current spend/limits, or undefined until loadCosts() resolves. */
export const useCosts = () => useStore((s) => s.costs);

/** Activity entries, newest first. */
export const useActivity = () => useStore((s) => s.activity);

/** Pending confirmation requests (the approvals queue). */
export const usePendingConfirmations = () => useStore((s) => s.confirmations);
