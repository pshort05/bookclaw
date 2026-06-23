# Publishing and Launch

## What it is

The publishing-and-launch suite is everything BookClaw does after the manuscript
is written: turning your finished prose into uploadable files, dressing it with a
cover and a blurb, and running the marketing campaign around release day. It spans
the whole last mile and beyond:

- **Format and export** — professional KDP-ready DOCX (trim sizes, front/back
  matter), valid EPUB3, KDP-compliant blurb HTML, and a Format Pro finisher.
- **Covers** — single covers, full multi-size cover sets, and title/author
  typography overlay.
- **Marketing copy** — blurbs formatted for the KDP description box, plus the
  BookBub-style editorial blurb.
- **Launch Orchestrator** — a 90-day launch state machine (metadata → keywords →
  pre-order → ARC → launch day → 30/60/90-day follow-ups).
- **Amazon Ads (AMS)** — campaign proposals and spend-capped optimization.
- **BookBub** — a Featured Deal submission draft.
- **Release Calendar** — dated milestones, a price-pulse planner, and iCal export.
- **Website Builder** — a static author site with per-book pages and a blog.
- **Translation pipeline** — DeepL + post-edit planning and a foreign-rights pitch.

The single most important rule across all of it: **BookClaw never executes an
irreversible external action on its own.** Every publish, send, submit, upload,
ad-spend change, and site deploy is routed through the **confirmation gate** —
you see a dry-run diff and approve it before anything leaves the building. See
[../SECURITY.md](../SECURITY.md) for the gate's contract.

## Why it matters

Writing the book is half the job; shipping it well is the other half, and it is
the half most authors skimp on. The last mile is full of fiddly,
easy-to-get-wrong, hard-to-undo steps — a malformed EPUB Amazon rejects, a blurb
with tags KDP strips, a pre-order set up too late, an ad campaign that quietly
burns your budget. This suite makes each of those steps repeatable and reviewable,
and it puts a hard safety rail in front of every action you cannot take back.

It is also deliberately **propose-and-approve, not auto-pilot.** BookClaw drafts
the metadata, harvests the keywords, builds the campaign templates, and assembles
the launch timeline — but it stops at the edge of every external platform and
hands you a confirmation request with the exact payload, the estimated cost, and
the rollback steps. You stay in control of money and of anything a reader will see.

## How to use it

### Format and export

A project compiles to all three primary formats in one call. The compile route
collects your completed chapter/step output, builds a combined manuscript, and
writes Markdown, DOCX, and EPUB side by side (DOCX/EPUB generation is non-fatal —
if one fails, the others still produce).

- `POST /api/projects/:id/compile` — compile the project into `manuscript.md` +
  `manuscript.docx` + `manuscript.epub` (deep-revision projects compile the final
  revised manuscript, with the diagnostic passes saved as a separate
  `revision-report.md`). If your book is bound to a world, eligible world
  documents are rendered automatically as back-matter appendixes (see
  [world-repository.md](./world-repository.md)).
- `POST /api/projects/:id/export-docx` — convert a single source `.md` file to a
  professional DOCX.
- `GET /api/projects/:id/download/:filename` — download any compiled file.

The DOCX exporter (`docx-export.ts`) produces a KDP-ready interior: title page,
copyright, dedication, chapter headings with page breaks, scene breaks, and back
matter (author bio, also-by, newsletter CTA, world appendix). It supports KDP
**trim sizes** `5x8`, `5.5x8.5`, and `6x9`, each with the correct margins. The
EPUB exporter (`epub-export.ts`) emits a valid **EPUB3** zip with proper
manifest/spine, optional cover image, and the same appendix back-matter.

**Format Pro** is the external finisher — it runs the manuscript through the
sibling Format Pro tool to produce a polished DOCX/EPUB/PDF/MD:

- `POST /api/projects/:id/format-pro` — body `{ outputFormat, trimSize, author }`
  where `outputFormat` is `docx|epub|pdf|md`.

In the Studio, compile and download live on the project/book view; Format Pro and
the trim-size picker are surfaced alongside the export controls. See
[book-format-and-structure.md](./book-format-and-structure.md) for how trim size
and structure are declared at book creation.

### Covers and cover sets

Covers are generated from a visual brief (description plus optional genre, mood,
era, setting, key imagery, palette, and avoid-list) through your configured image
provider.

- `GET /api/images/providers` — list available image providers.
- `GET /api/images/cover-variants` — the standard cover-size specs.
- `POST /api/images/book-cover` — generate one cover (`description` required).
- `POST /api/images/cover-set` — generate the full **cohesive set** (ebook,
  print, audiobook, social) from one brief, so every size shares the same art.
- `POST /api/projects/:id/cover-set` — same, auto-filling title/author/genre/
  description from the project (using the linked persona's pen name for the
  author).
- `GET /api/images/:filename` — serve a generated image (path-traversal guarded).
- `POST /api/covers/apply-typography` — overlay title/author/subtitle/series
  badge onto a generated PNG (`imagePath` must be inside `workspace/`).

The image provider preference resolves per-call override → global
`ai.preferredImageProvider` setting → `auto`.

### Blurbs and marketing copy

- `POST /api/kdp/export-blurb` — body `{ blurb }`. Converts a Markdown-ish blurb
  into the **exact HTML subset KDP accepts** (`<b>`, `<i>`, `<p>`, `<ul>`, etc.),
  enforces the 4000-char limit, and returns a plain-text fallback plus a 400-char
  preview, with warnings for anything it couldn't auto-fix.
- `POST /api/projects/:id/export-blurb` — same, but pulls the blurb from the
  project's most recent completed `blurb`/`description` step if you don't pass one.

For the editorial-style blurb BookBub editors expect, see the BookBub section.

### Launch Orchestrator

The Launch Orchestrator (`launch-orchestrator.ts`) is a per-title state machine.
It tracks where a launch is in its lifecycle and builds the full 90-day timeline,
but it **creates a confirmation request for every external step** rather than
acting itself. The phases run:
`draft_ready → cover_done → metadata_drafted → keywords_chosen → pre_order_live
→ arc_seeded → launch_day → follow_up_30 → follow_up_60 → follow_up_90 → complete`.

The generated timeline includes, relative to your release date: draft KDP metadata,
harvest keywords from comp-title ASINs, set up the KDP pre-order, seed the ARC team
(BookFunnel + ESP), flip the pre-order live on launch day, send the launch email,
post launch-day social, kick off AMS campaigns, run the price-pulse, send
follow-up emails, review/optimize ads, and submit a BookBub Featured Deal if
eligible. Each step carries a risk level; anything above `low` requires
confirmation, and high-risk steps (KDP publish, ARC send, ad spend) come with a
dry-run diff and explicit rollback notes.

- `GET /api/launches` — list launches.
- `POST /api/launches` — create one (`projectId`, `bookTitle`, `authorName`,
  `targetReleaseDate`, optional `metadata`).
- `GET /api/launches/:id` — the launch plus its full computed `plan` (timeline +
  warnings, e.g. "KDP requires 7 keywords; have 3").
- `PATCH /api/launches/:id` — update launch metadata (blurb, keywords, categories,
  comps, price, price-pulse plan, ARC list size, pre-order lead days).
- `POST /api/launches/:id/acknowledge-disclosures` — body `{ scopes }`. Some
  steps require acknowledging AI-disclosure scopes (AI-generated text/art, reader
  data, financial action) before they can be proposed.
- `POST /api/launches/:id/propose-step` — body `{ phase, stepId? }`. Creates the
  confirmation request for that step (blocked until the required disclosures are
  acknowledged). Returns the `confirmationId` to approve.
- `DELETE /api/launches/:id` — delete a launch.

Once you approve a confirmation and the external action runs (typically through a
Claude-in-Chrome session you drive), the launch is moved forward in its state
machine.

### Amazon Ads (AMS)

The AMS service (`ams-ads.ts`) is **planning and analysis only** — it never
touches your Advertising Console. It proposes campaign templates and, given
performance data you paste in, recommends bid changes, all under a hard spend cap.

- `POST /api/ams/propose-campaigns` — body `{ bookTitle, genre, keywords,
  dailyBudgetCeilingUSD }`. Returns three templates (Sponsored Products Broad, SP
  Exact, and a Category campaign) with recommended bids and budgets split under
  your ceiling.
- `POST /api/ams/optimize` — body `{ performance, acosTargetPct,
  dailyBudgetCeilingUSD, currentDailySpendUSD }`. Returns per-keyword
  recommendations (pause, raise, cut, promote-to-exact, keep) with rationale and a
  dry-run summary.

Built-in guard rails: it never proposes a bid increase greater than 2x in one
pass, never escalates a keyword with ACoS over 100% (unless there's too little
data), pauses zero-sale keywords with meaningful spend, and — critically — if the
proposed changes would push daily spend over your ceiling, it **suppresses the bid
increases** to stay under the cap and warns you. Actually applying any change is
on you, via the confirmation gate.

### BookBub Featured Deal

- `POST /api/bookbub/draft` — body `{ title, authorName, genre, amazonBlurb }`
  (plus optional subgenre, suggested price, prior deals, review snippets).

The submitter (`bookbub-submitter.ts`) reformats your Amazon blurb into the
editorial, third-person, reader-benefit tone BookBub editors prefer (stripping
HTML, all-caps, and exclamation runs), normalizes the deal price to an accepted
point ($0.99 / $1.99 / $2.99), summarizes your prior-deal history (warning if it's
under the typical 6-month cooldown), and lists which trade outlets you still need
to pitch for review quotes. **It never fabricates review quotes** — unverified
snippets are flagged, and you must paste the final draft into the BookBub partner
form or run it through a confirmation-gated browser flow yourself.

### Release Calendar and price-pulse planner

The calendar (`release-calendar.ts`) renders launch milestones as dated, all-day
events you can export and import into Google/Apple/Outlook calendars for
anti-miss reminders.

- `GET /api/calendar` — list events (filter by `projectId`, `category`, `from`,
  `to`); also returns `atRisk` (upcoming high/critical events within 7 days).
- `POST /api/calendar` — create an event.
- `PATCH /api/calendar/:id` / `DELETE /api/calendar/:id` — update / remove.
- `POST /api/calendar/price-pulse-plan` — body `{ projectId, bookTitle,
  releaseDate, launchPrice?, tailPrice? }`. Generates and stores a standard
  price-pulse schedule (e.g. $0.99 launch → bump day 7 → bump day 30 → tail price
  day 60).
- `GET /api/calendar/export.ics` — download a valid iCalendar file (with 7-day,
  1-day, and 4-hour reminder alarms baked into each event).

### Website Builder and publisher

The website builder (`website-builder.ts`) generates a complete static author
site to `workspace/website/<slug>/` — home, books index, per-book landing pages,
a blog, about, contact, RSS feed, sitemap, and robots.txt. It deploys to any
static host (Netlify, Vercel, Cloudflare Pages, GitHub Pages, S3). The site
registry (`site.routes.ts`) is the management layer over it.

- `GET /api/sites` / `GET /api/sites/:siteId` — list / fetch sites.
- `POST /api/sites` — create a site (config, linked projects, deploy target).
- `POST /api/sites/:siteId/link-project` / `unlink-project` — auto-add or remove
  a book from the site by project.
- `POST /api/sites/:siteId/books` / `DELETE …/books/:bookSlug` — manage books
  directly.
- `POST /api/sites/:siteId/blog-posts` / `DELETE …/blog-posts/:postSlug` —
  manage blog posts; `POST /api/blog-posts/draft` drafts post content.
- `POST /api/sites/:siteId/render` — render the static files to disk (safe, local).
- `POST /api/sites/:siteId/deploy` and `POST /api/sites/:siteId/publish` — these
  are **Wave-3 irreversible external side effects**, so they only create a
  confirmation request. The actual deploy runs through
  `POST /api/sites/deploy/finalize` after you approve.
- `GET /api/site-deploy/doctor` — diagnose the deploy toolchain.

Safety rails baked into the output: the FTC affiliate disclosure is added
automatically to any page with affiliate links, newsletter/analytics embeds are
author-supplied placeholders, the contact form is `mailto:`-only by default, and
all user input is HTML-escaped. A lower-level `POST /api/websites/build` and
`GET /api/websites` also exist for direct builds.

### Translation and foreign rights

The translation pipeline (`translation-pipeline.ts`) plans machine translation
(DeepL pass + Claude/GPT post-edit) and produces the rights-pitch documents you
need to license foreign editions. Planning is free; running a translation is
confirmation-gated and cost-estimated.

- `POST /api/translation/plan` — body `{ projectId, bookTitle, targetLangs,
  estimatedWordCount, sourceLang? }`. Returns per-language cost estimates, ROI
  rankings by market, a recommended order, and disclaimer lines.
- `POST /api/translation/propose` — body `{ projectId, bookTitle, targetLang,
  estimatedWordCount }`. Creates a confirmation request with the full cost, the
  mandatory AI-translation disclosure text, and the target market.
- `POST /api/translation/rights-pitch` — body `{ targetLang, bookTitle,
  authorName, genre, wordCountApprox, comps?, marketingAngle? }`. Generates a
  rights one-pager (Babelcube/Tektime/direct-pitch options).

Every translated export carries a **mandatory AI-assisted-translation disclosure**
in the file footer, and the service **refuses to output a French translation**
unless that disclosure is set, because French consumer law requires it.

## Under the hood

- `gateway/src/services/launch-orchestrator.ts` — 90-day launch state machine;
  builds plans, creates confirmations, tracks phase history.
- `gateway/src/services/ams-ads.ts` — AMS campaign proposals + spend-capped
  optimization (the 2x-cap and over-ceiling suppression live here).
- `gateway/src/services/bookbub-submitter.ts` — BookBub Featured Deal draft +
  blurb reformatter; never fabricates review quotes.
- `gateway/src/services/release-calendar.ts` — calendar CRUD, price-pulse plans,
  iCal/ICS export.
- `gateway/src/services/website-builder.ts` — static-site generator;
  `website-sites.ts` (registry) and `website-deploy.ts` (deploy execution).
- `gateway/src/services/translation-pipeline.ts` — translation planning, gated
  proposals, rights-pitch generator, market profiles.
- `gateway/src/services/docx-export.ts` — KDP-ready DOCX (trim sizes, front/back
  matter); `epub-export.ts` — valid EPUB3; `kdp-exporter.ts` — KDP blurb HTML.
- `gateway/src/services/image-gen.ts` — covers + cover sets;
  `cover-typography.ts` — title/author overlay.
- `gateway/src/api/routes/knowledge.routes.ts` — launches, AMS, BookBub,
  calendar, translation, and website-build routes.
- `gateway/src/api/routes/documents.routes.ts` — compile, export-docx, download.
- `gateway/src/api/routes/export.routes.ts` — KDP blurb, cover typography,
  Format Pro, manuscript hub.
- `gateway/src/api/routes/media.routes.ts` — image and cover-set routes.
- `gateway/src/api/routes/site.routes.ts` — site registry, render, gated
  deploy/publish/finalize.
- `gateway/src/services/confirmation-gate.ts` — the universal approval gate every
  irreversible external action passes through.

## Related

- [../SECURITY.md](../SECURITY.md) — the confirmation gate and Wave-3 safety model.
- [book-format-and-structure.md](./book-format-and-structure.md) — trim sizes,
  structure, and length declared at book creation.
- [world-repository.md](./world-repository.md) — world documents rendered as DOCX/
  EPUB back-matter appendixes on compile.
- [series.md](./series.md) — series-level price-drop and release coordination.
- [pipelines-and-sequences.md](./pipelines-and-sequences.md) — the production
  pipeline that feeds the manuscript into this suite.
