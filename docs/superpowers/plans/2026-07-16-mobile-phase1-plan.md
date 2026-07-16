# Mobile Phase 1 (Studio Responsive Shell) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the BookClaw v6 studio usable on a phone by collapsing the desktop two-column shell to a single full-width column below 768px and turning the nav Rail into a toggleable off-canvas drawer, so prose no longer wraps to one word per line.

**Architecture:** All changes are gated inside a single `@media (max-width: 768px)` block per stylesheet so desktop rendering is unchanged. The shell (`App.tsx`) gains one boolean state (`navOpen`) that drives: a mobile-only top bar with a hamburger toggle, a tap-to-dismiss backdrop scrim, and an `.open` class on the Rail. On mobile the Rail becomes `position: fixed` and translates off-screen by default (so it leaves the grid track entirely and `.main` gets the full column); toggling `navOpen` slides it in. Navigation and Escape close it. We mirror the existing off-canvas pattern already used by `BookDrawer` (scrim + `transform: translateX` + `.on` class) rather than inventing a new one, but implement it in the shell's own CSS modules because CSS-Module class names are file-scoped and cannot be shared across modules.

**Tech Stack:** React 18 + react-router-dom (`NavLink`/`Outlet`), Vite, CSS Modules, TypeScript (loaded via `tsx`; type-checked with `tsc`). No component-test harness — verification is `tsc --noEmit` + Vite build + a build-artifact assertion test (mirroring `tests/unit/studio-build.test.ts`) + a described manual served-bundle check.

## Global Constraints

- **Breakpoint is exactly `@media (max-width: 768px)`** — one value, used identically in every stylesheet this plan touches. Do not introduce a second breakpoint.
- **Desktop (width > 768px) rendered layout must be byte-identical to `main`.** Every new CSS rule that changes layout/visibility lives *inside* the media query. New DOM elements (top bar, scrim) default to `display: none` at the top level and are only revealed inside the media query.
- **Imports use `.js` extensions** even though source is `.ts`/`.tsx` (NodeNext resolution). Match this on every new/changed import.
- **CSS Modules:** class selectors are localized; reference them as `styles.foo`. Compose multiple classes with template strings (`` `${styles.a} ${styles.b}` ``), matching the existing Rail/BookDrawer pattern.
- **`--rail` token lives in `frontend/shared/src/tokens.css:30` (`--rail: 232px`).** Do not change it — the mobile drawer uses a fixed width independent of the desktop rail width.
- **`body { overflow: hidden }` already exists** (`frontend/shared/src/tokens.css:44`), so the document itself never scrolls horizontally; the mobile fix must not reintroduce page-level horizontal scroll via the shell grid or an off-screen fixed element.
- Type-check with `cd frontend/studio && npx tsc --noEmit`. Build with `npm run -w frontend/studio build` (from repo root). Full-frontend build: `npm run build:frontend`.

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `frontend/studio/src/App.tsx` | Shell: owns `navOpen` state, renders mobile top bar + hamburger + scrim, passes `open`/`onClose` to `Rail`, handles Escape. | Modify |
| `frontend/studio/src/App.module.css` | Shell grid. Add the `@media (max-width: 768px)` block that collapses to one column and styles the top bar, hamburger, and scrim (hidden by default). | Modify |
| `frontend/studio/src/Rail.tsx` | Nav rail. Accept `open`/`onClose` props, apply `.open` class on mobile, close the drawer when any nav item is clicked. | Modify |
| `frontend/studio/src/Rail.module.css` | Add the `@media (max-width: 768px)` block that makes the rail a fixed off-canvas drawer (`transform: translateX(-100%)`), and `.open` to slide it in. | Modify |
| `tests/unit/mobile-shell.test.ts` | Build-artifact assertion: the media query ships in the built CSS and the hamburger control ships in the built JS. | Create |

**Reused pattern:** the off-canvas approach (fixed scrim with an `.on`/opacity toggle + a `transform: translateX` drawer with an `.on` slide-in) is copied conceptually from `frontend/studio/src/components/BookDrawer.module.css` (`.scrim`, `.drawer`, `.on`). We do **not** reuse the `BookDrawer` component itself (it is a book-detail dialog anchored right); the Rail is a distinct left-anchored nav. The scrim gets its own class in `App.module.css`.

**Where drawer state lives:** a single `useState<boolean>` named `navOpen` in `App.tsx` (the shell). It is the only new state. `App` renders the scrim and hamburger; `Rail` is a controlled child (`open` + `onClose` props). No global store, no context — the toggle is shell-local UI state.

---

### Task 1: Collapse the shell to one column + add the mobile top bar, hamburger, and scrim

**Files:**
- Modify: `frontend/studio/src/App.tsx` (whole file, currently 7 lines)
- Modify: `frontend/studio/src/App.module.css` (append a media-query block; existing rules unchanged)
- Modify: `frontend/studio/src/Rail.tsx` (accept `open`/`onClose`, apply `.open`, close on nav click)
- Modify: `frontend/studio/src/Rail.module.css` (append a media-query block; existing rules unchanged)

**Interfaces:**
- Produces: `Rail` becomes `function Rail({ open, onClose }: { open: boolean; onClose: () => void })`. `App` owns `const [navOpen, setNavOpen] = useState(false)`.
- Consumes: existing `styles.app` / `styles.main` (App.module.css) and `styles.rail` (Rail.module.css); the `--rail` token; the BookDrawer scrim/transform pattern.

- [ ] **Step 1: Add the mobile media query to `App.module.css`**

Append to `frontend/studio/src/App.module.css` (do not edit lines 1–16). The default (desktop) rules for `.topbar`, `.hamburger`, and `.scrim` set `display: none` so they add zero desktop layout; everything visual is inside the media query.

```css

/* --- mobile top bar + scrim: hidden on desktop, no layout impact --- */
.topbar { display: none; }
.hamburger { display: none; }
.scrim { display: none; }

/* --- Mobile Phase 1: collapse the desktop two-column shell -----------
   Below 768px the Rail leaves the grid (it becomes position:fixed in
   Rail.module.css), so the single 1fr column is entirely the content pane
   and prose reflows normally instead of wrapping to one word per line. */
@media (max-width: 768px) {
  .app {
    grid-template-columns: 1fr;
    /* Reserve the top bar's height as the first grid row so content starts
       below it; the bar itself is position:fixed so it never scrolls away. */
    grid-template-rows: 52px 1fr;
  }

  .main {
    /* content pane owns vertical scroll; never allow horizontal overflow */
    overflow-x: hidden;
  }

  .topbar {
    display: flex;
    align-items: center;
    gap: 12px;
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: 52px;
    z-index: 30;
    padding: 0 14px;
    background: linear-gradient(180deg, var(--bg-2), var(--bg));
    border-bottom: 1px solid var(--line);
  }

  .topbarTitle {
    font-family: 'Fraunces', serif;
    font-weight: 600;
    font-size: 17px;
    letter-spacing: -.02em;
  }

  .topbarTitle b { color: var(--ember); font-weight: 600; }

  .hamburger {
    display: grid;
    place-items: center;
    width: 38px;
    height: 38px;
    border-radius: var(--r-s);
    border: 1px solid var(--line);
    background: transparent;
    color: var(--text);
    cursor: pointer;
  }

  .hamburger svg { width: 20px; height: 20px; }

  /* backdrop behind the open drawer — mirrors BookDrawer .scrim */
  .scrim {
    display: block;
    position: fixed;
    inset: 0;
    z-index: 40;
    background: rgba(8,5,2,.55);
    backdrop-filter: blur(2px);
    opacity: 0;
    pointer-events: none;
    transition: .3s;
  }

  .scrim.scrimOn {
    opacity: 1;
    pointer-events: auto;
  }
}
```

- [ ] **Step 2: Add the mobile media query to `Rail.module.css`**

Append to `frontend/studio/src/Rail.module.css` (do not edit lines 1–248). This turns the existing `.rail` into an off-canvas drawer *only* under the breakpoint. `.railOpen` is the slide-in state.

```css

/* --- Mobile Phase 1: Rail becomes an off-canvas drawer ---------------
   Off-canvas by default (translateX(-100%)) so it leaves the grid flow and
   the content column is full width; slides in when .railOpen is applied.
   Pattern mirrors components/BookDrawer.module.css (.drawer / .on). */
@media (max-width: 768px) {
  .rail {
    position: fixed;
    top: 0;
    left: 0;
    bottom: 0;
    width: min(84vw, 300px);
    z-index: 41;
    transform: translateX(-100%);
    transition: transform .32s var(--ease);
    box-shadow: 30px 0 80px -30px rgba(0,0,0,.7);
  }

  .railOpen {
    transform: none;
  }
}
```

- [ ] **Step 3: Make `Rail` a controlled drawer in `Rail.tsx`**

Change the signature and the root `<aside>`, and close the drawer on any nav click. Only three edits — the rest of the file is unchanged.

Edit the import + signature (lines 6):

```tsx
export function Rail({ open, onClose }: { open: boolean; onClose: () => void }) {
```

Edit the root element (line 36) to add the conditional `.railOpen` class:

```tsx
    <aside className={open ? `${styles.rail} ${styles.railOpen}` : styles.rail}>
```

Edit the `<nav>` opening tag (line 51) to close the drawer whenever a link inside it is activated (SPA navigation does not reload, so we close explicitly):

```tsx
      <nav className={styles.nav} onClick={onClose}>
```

Rationale for `onClick={onClose}` on the `<nav>` container: every interactive child is a `NavLink`/`<a>`; a single delegated handler closes the drawer on navigation without wiring `onClick` onto ~14 links. Clicking dead space inside `<nav>` (labels) also closes it, which is acceptable and matches "closes on navigation" intent. `onClose` is stable enough for this (no `useCallback` needed — it is passed fresh each render but only invoked on click).

- [ ] **Step 4: Wire the shell in `App.tsx`**

Replace the whole file (currently 7 lines) with:

```tsx
import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Rail } from './Rail.js';
import styles from './App.module.css';

export function App() {
  const [navOpen, setNavOpen] = useState(false);

  // Close the mobile nav drawer on Escape (matches BookDrawer's affordance).
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setNavOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navOpen]);

  return (
    <div className={styles.app}>
      {/* Mobile-only top bar; display:none on desktop so layout is unchanged. */}
      <header className={styles.topbar}>
        <button
          className={styles.hamburger}
          aria-label="Open navigation"
          aria-expanded={navOpen}
          onClick={() => setNavOpen(true)}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
        <span className={styles.topbarTitle}>Book<b>Claw</b></span>
      </header>

      <Rail open={navOpen} onClose={() => setNavOpen(false)} />

      {/* Tap-to-dismiss backdrop; visible only when the drawer is open (mobile). */}
      <div
        className={navOpen ? `${styles.scrim} ${styles.scrimOn}` : styles.scrim}
        onClick={() => setNavOpen(false)}
      />

      <main className={styles.main}><Outlet /></main>
    </div>
  );
}
```

Note on grid ordering: `.topbar`, `.rail`, `.scrim`, and `.main` are all children of `.app`. On desktop the grid is `var(--rail) 1fr` and `.topbar`/`.scrim` are `display:none` (removed from grid flow), so the visual result is exactly today's Rail + main. On mobile `.rail` and `.scrim` are `position:fixed` (also out of grid flow), `.topbar` is `position:fixed` occupying the reserved 52px row, and `.main` is the sole in-flow grid item filling `1fr`.

- [ ] **Step 5: Type-check**

Run: `cd frontend/studio && npx tsc --noEmit`
Expected: no output, exit code 0. (Catches a prop-shape mismatch between `App` and `Rail`.)

- [ ] **Step 6: Build the studio bundle**

Run (from repo root): `npm run -w frontend/studio build`
Expected: Vite build completes; `frontend/studio/dist/index.html` and hashed assets under `frontend/studio/dist/assets/` are (re)written, no errors.

- [ ] **Step 7: Manual served-bundle / responsive check**

Serve the built dashboard (any of): run the gateway (`npm start`) and open `http://localhost:3847/`, or `npm run -w frontend/studio preview`. Then, in the browser devtools device toolbar:
1. Set viewport to a phone width (e.g. 390×844). Expected: single full-width column; the top bar with a hamburger is visible; the Rail is hidden; a content route (open **Write** or any prose view) reflows normally — **no one-word-per-line wrapping**.
2. Tap the hamburger. Expected: Rail slides in from the left over a dimmed backdrop.
3. Tap the backdrop, press Escape, and tap a nav item. Each expected to close the drawer (the nav item also navigates).
4. Confirm there is **no horizontal page scroll** at 390px and at 768px.
5. Set viewport to desktop (e.g. 1440px). Expected: identical to `main` — two-column shell, no top bar, no hamburger, no scrim.

- [ ] **Step 8: Commit**

```bash
git add frontend/studio/src/App.tsx frontend/studio/src/App.module.css \
        frontend/studio/src/Rail.tsx frontend/studio/src/Rail.module.css
git commit -m "feat(studio): mobile Phase 1 — collapse shell to one column + off-canvas nav drawer"
```

---

### Task 2: Build-artifact assertion test

**Files:**
- Create: `tests/unit/mobile-shell.test.ts`

**Interfaces:**
- Consumes: the built dist from Task 1 (`frontend/studio/dist/`). Mirrors the on-demand-build pattern in `tests/unit/studio-build.test.ts` and `tests/unit/adaptive-interview-bundle.test.ts`.
- Produces: nothing consumed by later tasks. Runs via `npm run test:unit` (which runs `npm run build:frontend` first).

Rationale: there is no component-test harness, but the repo has a build-artifact assertion convention. Two cheap, high-signal assertions catch regressions: (a) the `max-width:768px` media query survived into the built CSS (proves the responsive rules shipped, not just the source), and (b) the hamburger control's `aria-label` shipped in the built JS (proves the shell wiring shipped). Vite minifies CSS to `max-width:768px` (no space); assert on that exact form.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/mobile-shell.test.ts`:

```ts
/**
 * Build-artifact test for Mobile Phase 1 (studio responsive shell). The Vite
 * dist is gitignored, so this builds it on demand (first run / fresh checkout),
 * then asserts (a) the 768px media query survived into the built CSS and
 * (b) the hamburger control shipped in the built JS. Run via: npm run test:unit
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

const repo = process.cwd();
const assetsDir = join(repo, 'frontend/studio/dist/assets');

test('studio bundle carries the mobile responsive shell', { timeout: 180000 }, () => {
  if (!existsSync(assetsDir)) {
    try {
      execSync('npm run -w frontend/studio build', { cwd: repo, stdio: 'pipe' });
    } catch (err) {
      const e = err as { stdout?: Buffer; stderr?: Buffer };
      if (e.stdout) process.stderr.write(e.stdout);
      if (e.stderr) process.stderr.write(e.stderr);
      throw err;
    }
  }
  const files = readdirSync(assetsDir);
  const css = files.filter((f) => f.endsWith('.css'))
    .map((f) => readFileSync(join(assetsDir, f), 'utf-8')).join('\n');
  const js = files.filter((f) => f.endsWith('.js'))
    .map((f) => readFileSync(join(assetsDir, f), 'utf-8')).join('\n');

  assert.ok(css.includes('max-width:768px'), 'mobile breakpoint must survive into the built CSS');
  assert.ok(js.includes('Open navigation'), 'hamburger control (aria-label) must ship in the bundle');
});
```

- [ ] **Step 2: Run it to verify it passes against the Task 1 build**

Run (from repo root): `node --import tsx --test --experimental-test-isolation=none tests/unit/mobile-shell.test.ts`
Expected: 1 test, 1 pass. (If `dist` is stale/missing it rebuilds first.) If it fails on the CSS assertion, confirm Vite minified the query to exactly `max-width:768px`; if it fails on the JS assertion, confirm the `aria-label="Open navigation"` string is present in `App.tsx`.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/mobile-shell.test.ts
git commit -m "test(studio): assert mobile Phase 1 media query + hamburger ship in the bundle"
```

---

## Follow-ups (explicitly OUT of scope for Phase 1)

Phase 1 is deliberately the ~80% "make it usable" win. Do **not** implement these here; noted only so they are tracked:

- **Phase 2 — bottom tab bar:** replace/augment the hamburger with a fixed bottom tab bar for the 3–5 most-used destinations (Board, Write, New, Files).
- **Phase 3 — per-view responsive passes:** the routes that already carry their own media queries (`Write`, `NewBook`, `AdaptiveInterview`, `PremiseIntake`, `Guided`, `AssetStudio`) and those that do not (Board card grid, tables in Files/Reports/Consistency) need individual mobile layouts — horizontal-scroll containers for wide tables, single-column card stacks, touch-sized targets.
- **Phase 4 — full polish:** safe-area insets (notch), larger tap targets across the board, focus-trap + `inert` on the open drawer for a11y, reduced-motion handling, landscape tuning.

---

## Self-Review

- **Spec coverage:** single-column collapse (Task 1, App.module.css media query) ✓; Rail off-canvas drawer with backdrop + slide-in (Task 1, Rail.module.css + App/Rail wiring) ✓; hamburger top bar mobile-only (Task 1, App.tsx + App.module.css) ✓; closes on navigation (`onClick={onClose}` on `<nav>`) and Escape (App effect) and backdrop tap ✓; no horizontal scroll (`.main { overflow-x: hidden }` + `body{overflow:hidden}` + off-canvas fixed rail) ✓; content reading width — the content pane is now full `1fr` and prose reflows; per-view max-width is a route-level concern deferred to Phase 3 (the sliver, the actual bug, is fixed by the single-column collapse) ✓; desktop unchanged (all layout rules inside the media query; new elements `display:none` by default) ✓; verification (tsc + build + build-artifact test + manual) ✓; Phases 2–4 noted, not built ✓.
- **Placeholder scan:** every code/CSS step shows the exact content; no TBD/TODO.
- **Type consistency:** `Rail({ open, onClose })` prop shape is defined in Task 1 Step 3 and consumed identically in Task 1 Step 4 (`<Rail open={navOpen} onClose={() => setNavOpen(false)} />`). Class names `railOpen`, `scrimOn`, `topbar`, `topbarTitle`, `hamburger`, `scrim` are defined in the CSS steps and referenced by the same names in the TSX/CSS.

## Execution Handoff

Plan complete. Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks.
2. **Inline Execution** — execute in this session with checkpoints.
