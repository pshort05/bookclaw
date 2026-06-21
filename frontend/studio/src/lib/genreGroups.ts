// Publishing-standard buckets for the genre pickers (New Book + Library).
// Slugs match the `groups` arrays written into each genre's meta.json; the
// order here is the display order. Shared so the taxonomy has one source.
export const GENRE_GROUPS: { slug: string; label: string }[] = [
  { slug: 'romance', label: 'Romance' },
  { slug: 'fantasy', label: 'Fantasy' },
  { slug: 'science-fiction', label: 'Science Fiction' },
  { slug: 'mystery-crime', label: 'Mystery & Crime' },
  { slug: 'thriller-suspense', label: 'Thriller & Suspense' },
  { slug: 'horror', label: 'Horror' },
  { slug: 'western', label: 'Western' },
  { slug: 'historical', label: 'Historical' },
  { slug: 'action-adventure', label: 'Action & Adventure' },
  { slug: 'speculative-dystopian', label: 'Speculative & Dystopian' },
  { slug: 'literary', label: 'Literary & Upmarket' },
  { slug: 'comedy-satire', label: 'Comedy & Satire' },
];
