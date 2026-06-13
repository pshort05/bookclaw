# Delete Books — design (2026-06-13)

## Purpose

A studio UI to permanently delete one or more books from disk — for cleaning up
test books, or after a finished book has been pulled into another directory.
There is no delete-book affordance in the studio today (only the smoke tests
call the API).

## Decisions

- **Placement:** Settings → a new "Danger zone" card with a `Delete books…` button.
- **Backend:** reuse the existing `DELETE /api/books/:slug` (looped client-side).
  No new endpoint — it already exists, is smoke-covered, and re-seeds the active
  book server-side.
- **Confirmation:** a two-stage modal. Stage 1 multi-selects books; clicking the
  "Delete N selected…" button reveals Stage 2, which requires typing the exact
  phrase `DELETE MY BOOKS FROM DISK` (trimmed, case-sensitive) before the final
  "Delete from disk" button enables.

## Components

- `frontend/studio/src/components/DeleteBooksModal.tsx` (+ `.module.css`) — a
  centered modal over a scrim (matches the `BookDrawer` scrim + design tokens).
  - Reads the book list from the store (`useBooks()`), calling `loadBooks()` on
    open (Settings doesn't otherwise load books) and again after deletion.
  - Stage `select`: checkbox row per book (title, phase, slug); `Delete N…`
    disabled until ≥1 selected.
  - Stage `confirm`: warning + selected titles + the typed-phrase gate; final
    button disabled until `phrase.trim() === 'DELETE MY BOOKS FROM DISK'`.
  - Delete loop is sequential and fault-tolerant (a failed book is counted, the
    rest proceed); shows a `Deleted X, Y failed` result, then Close.
  - Esc closes except mid-delete.
- `Settings.tsx` — Danger-zone card + `showDelete` state opening the modal.

## Scope (YAGNI)

No bulk backend endpoint, no select-all, no soft-delete/undo. Just multi-select
+ typed-phrase delete.

## Verification

No React component-test runner exists in this repo, so verification is
`npm run build:frontend` (tsc + Vite) plus a manual click-through after deploy.
The underlying `DELETE /api/books/:slug` is already covered by the smoke tests.
