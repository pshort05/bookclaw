# Research and Reader Intelligence

## What it is

Two complementary capabilities that bring outside facts and audience signal into your writing, without ever giving the agent unrestricted internet access:

- **The Research gate.** Constrained, sourced lookups. There are two layers:
  - A built-in **web search + content extraction** over an allowlisted set of domains (Wikipedia, Google Books, and a curated list of reference, publishing, and craft sites). This is the engine behind the `/research` command and the dashboard research box.
  - A **sourced lookup** that asks for verified, cited answers from a live-web research model (Perplexity Sonar Pro), plus five **marketing-research presets** that find literary agents, author podcasts, book reviewers, newsletters, and comparable authors in your genre.
- **Reader Intelligence.** A deterministic analyzer that turns a pile of reader reviews into actionable signal: which tropes readers are asking for, the most common complaints in your genre, a sentiment timeline, and trope-stance hints — with strict PII rails so no reviewer name or verbatim quote ever leaks into your marketing.

## Why it matters

Generic AI knowledge is frozen at training time and happily invents plausible-sounding citations. The Research gate forces real sourcing: the allowlist keeps lookups on reputable domains, the sourced-lookup path returns citations you can cross-check, and an SSRF guard means the agent can never be tricked into reaching your LAN or an internal admin panel.

Reader Intelligence answers the question every author returns to between books: *what do my readers actually want next?* It mines reviews you already have access to and surfaces patterns — "readers keep asking for more found family", "the sagging middle complaint shows up 14 times" — without you reading hundreds of reviews by hand, and without exposing any individual reviewer.

## How to use it

### Web research (allowlisted search + extraction)

- **Studio / dashboard:** use the research box. It runs a search, then fetches and extracts clean text from the top allowed results.
- **Telegram:** `/research medieval sword types` or `/research self-publishing trends 2026`. Results are summarized back to you; output also lands in `workspace/research/`.
- **API:**
  ```
  POST /api/research            { "query": "...", "maxResults": 5 }
  ```
  Returns `results` (each with `title`, `url`, `snippet`, and extracted `fullText`), plus a `blocked` list naming any results that fell outside the allowlist.

### Configuring research domains

The allowlist is yours to extend for your projects.

- **View:** `GET /api/research/domains` → `{ domains: [...] }`
- **Replace:** `POST /api/research/domains { "domains": ["en.wikipedia.org", "*.wikipedia.org", "loc.gov"] }`

Domains are normalized (lowercased, `www.` stripped) and persisted to `config/research-allowlist.json`. Wildcards are supported as `*.example.com` to allow any subdomain. The gate enforces a rate limit of 60 requests per hour and caps fetched page size, so a runaway loop can't hammer a source.

### Sourced research lookup (verified citations)

For facts you intend to put in a manuscript — a period detail, a forensic procedure, a citation — use the sourced lookup. It prefers a live-web research model and returns inline `[N]` citations with a Sources list:

```
POST /api/research/lookup     { "query": "...", "maxWords": 400 }
```

The response includes `answer`, `citations`, the `provider` that ran it, `hasVerifiedSources`, and an `estimatedCost`. Provider selection is automatic, in order:

1. **Direct Perplexity** if a `perplexity_api_key` is in the vault.
2. **Perplexity via OpenRouter** if an `openrouter_api_key` is present (cheapest path if you already use OpenRouter).
3. **Fallback LLM** — the active provider with no live web. In this case `hasVerifiedSources` is `false` and the answer is explicitly flagged as unverified. Treat its citations with skepticism and cross-check before publishing.

The service never fabricates sources: if the model can't verify a topic, it says so and returns an empty citation list.

### Marketing-research presets

Each preset builds a tightly-scoped, guard-railed query (recent sources only, no fabricated names, no invented contact info) and persists a markdown copy to `workspace/research/marketing/<topic>-<date>.md`. All take a `genre` (required) and optional `subgenre`:

```
POST /api/research/agents        { "genre": "fantasy", "subgenre": "romantasy", "titleAgePositioning": "adult" }
POST /api/research/podcasts      { "genre": "thriller" }
POST /api/research/reviewers     { "genre": "romance", "indieFriendly": true }
POST /api/research/newsletters   { "genre": "cozy mystery" }
POST /api/research/comp-authors  { "genre": "fantasy", "tone": "dark" }
```

- **agents** — active literary agents repping the genre, with agency, recent sales, open/closed status, and submission-page URLs.
- **podcasts** — author-interview podcasts, hosts, cadence, recent guests, and how to pitch.
- **reviewers** — bloggers / Bookstagram / BookTok accounts, platform, audience scale, and submission policy (set `indieFriendly` to prioritize indie-welcoming reviewers).
- **newsletters** — both paid-promo (BookBub, Freebooksy, etc.) and editorial newsletters, with pricing where listed.
- **comp-authors** — recent comparable authors selling well, useful for query letters and cover positioning.

These presets find and verify; they never generate an email, DM, or pitch on your behalf.

### Reader Intelligence

Collect reviews you have legitimate access to (your own product pages, exported review data) and submit them for analysis:

```
POST /api/reader-intel/analyze
{
  "reviews": [
    { "rating": 5, "text": "...", "date": "2026-01-12", "bookAsin": "B0..." }
  ]
}
```

The endpoint **sanitizes first, then analyzes**, returning `{ report, sanitizedCount }`. The report contains:

- **`clusters`** — frequent content-word signals with sentiment and category (praise / complaint / other).
- **`tropeSignals`** — known tropes (enemies-to-lovers, found family, dragons, magic school, etc.) detected in the reviews, with a `stanceHint` of `readers_want_more`, `readers_dislike`, or `neutral`.
- **`sentimentTimeline`** — average rating and count bucketed by month.
- **`readerRequestedNextStories`** — anonymized snippets of what readers asked for ("wish there was…", "needed more…").
- **`topComplaints`** — the most common complaint markers and how many reviews each appeared in.
- **`disclaimer`** — the standing reminder that this is aggregate signal only.

A note on input: only `rating`, `text`, `date`, and `bookAsin` are accepted. Reviewer name, profile URL, and avatar are **deliberately not accepted** — don't send them.

#### PII and safety rails (built in, not optional)

- Each review is hashed to an opaque stable ID (SHA-256 of `bookAsin` + text); names and profile metadata are never retained.
- **Verbatim review text is never exported.** Clusters and signals reference reviews by aggregate pattern, never quoted strings; reader-request snippets are length-capped and have any quoted phrases stripped.
- Review text that looks like a prompt-injection attempt (common in scraped data) is dropped before analysis.
- Quoting any review in marketing copy still requires explicit permission from that reviewer — the disclaimer says so on every report.

Scraping is your responsibility: route any fetching through the Research gate (allowlist + rate limit), and prefer official partner APIs over raw scraping.

## Under the hood

Key files:

- `gateway/src/services/research.ts` — `ResearchGate`: the allowlist, the SSRF guard (`isPrivateIpLiteral` rejects loopback / private / link-local IP literals even if allowlisted), rate limiting, Wikipedia + Google Books search, and HTML-to-text extraction.
- `gateway/src/services/research-lookup.ts` — `ResearchLookupService`: sourced lookup via Perplexity (direct or through OpenRouter) with LLM fallback, plus the five marketing-research presets.
- `gateway/src/services/reader-intel.ts` — `ReaderIntelService`: `sanitize()` (PII drop + hash + injection filter) and `analyze()` (keyword clustering, trope detection, timeline, requests, complaints).
- `config/research-allowlist.json` — the versioned default domain allowlist.
- `gateway/src/api/routes/media.routes.ts` — `/api/research`, `/api/research/domains` (GET/POST).
- `gateway/src/api/routes/knowledge.routes.ts` — `/api/research/lookup`, the marketing presets, and `/api/reader-intel/analyze`.
- Wiring: `init/phase-05-research-skills.ts` (gate), `init/phase-07-knowledge.ts` (lookup), `init/phase-09-export-wave.ts` (reader intel). The `/research` Telegram command is in `gateway/src/bridges/telegram.ts`.

The egress SSRF guard is regression-tested in `tests/unit/research-egress.test.ts`.

## Related

- [Surfaces](./surfaces.md) — where these features appear (Studio, Telegram, API).
- [Publishing and launch](./publishing-and-launch.md) — where marketing-research output feeds your launch and outreach planning.
