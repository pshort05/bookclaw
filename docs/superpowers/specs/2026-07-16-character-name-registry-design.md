# Character Name Registry — Design

**Date:** 2026-07-16
**Owner ask:** minor/transient character names drift across chapters (a recurring
"Dottie" vs canon "Rosa Marchetti", a "Caruso order" vs "Marchetti order"). Primary
and secondary characters are already seeded at intake, but tertiary and transient
characters — the named walk-ons that make a small town feel real — are introduced
mid-chapter and never captured into canon, so the writer model re-invents or
mis-names them later. Build a per-book **name registry** that captures every named
character deterministically, enforces the canonical name, and grows one chapter at a
time without bloating generation.

## Problem (observed on project-77 "Two Months of Summer")

- Ch1: the regular customer was "Dottie Marchetti, 71"; canon says "Rosa Marchetti,
  79". The LLM consistency audit caught it but the deterministic apply fixed only 2
  of 4 occurrences (single-occurrence limit).
- Ch3: "Rosa Marchetti" (line 121) and "Dottie Marchetti" (line 167) appear in the
  **same chapter** — and the consistency audit returned `[]`, missing it entirely.
- The 300-mini-sfogliatelle order is the "Caruso order" in Ch2 and the "Marchetti
  order/wedding" in Ch3.
- Root cause: there is no curated, per-book set of the story's actual character names
  (beyond the injected bible's primaries/secondaries), so tertiary/transient names
  have nothing to be enforced against, and the LLM consistency audit under-detects
  name drift.

## Design principles (settled during brainstorming)

1. **Determinism owns detect / strip / parse / enforce. It never decides
   "same person vs. two people"** — that is a story-dependent semantic judgment
   (small-town base rates, plot, authorial intent). The canon already contains two
   people who share a surname (Rosa Marchetti and Angela Marchetti, the bride), so a
   surname match must never auto-merge.
2. **Extraction rides the frontier chapter-writer** (`creative_writing`, e.g.
   `claude-opus-4.8`) — the strongest model in the pipeline, which just authored the
   chapter and knows what it introduced. Auxiliary models (de-AI Flash, consistency
   Haiku) never produce the manifest.
3. **Full character *profiles* are never injected; a compact recurring *roster*
   is.** The registry holds every named character (primary → transient) as light
   `name + role` rows. Full profiles (the character bible) stay out of most prompts,
   but a compact roster of *recurring* minors (name + one line each) IS injected into
   chapter generation so the writer **reuses established minors instead of inventing
   new ones** — prevention, not just cure. One-shot transients are excluded. This is
   what makes the difference between bloat (profiles) and cheap memory (a roster).
4. **A manifest that bleeds into the manuscript is catastrophic** — defense-in-depth
   is mandatory (learned from the Ch1 "Note on canon conflict" preamble that leaked).

## Design

### 1. The name registry (per-book, lightweight, never injected)
Storage: `workspace/books/<slug>/name-registry.json` (per-book; not in prompts).
Each entry is light — names and roles, never full profiles:

```
{
  "characters": [
    { "canonical": "Rosa Marchetti", "tier": "tertiary",
      "role": "regular customer; grandmother of the bride",
      "aliases": [], "driftMap": ["Dottie", "Dottie Marchetti"],
      "firstChapter": 1 }
  ],
  "locations": [ { "canonical": "Salt & Crumb", "role": "Cole's cafe", ... } ]
}
```

- **tier:** `primary | secondary | tertiary | transient`. Primary/secondary mirror
  the character bible; tertiary (recurring-capable minor) and transient (one-shot)
  grow per chapter.
- **canonical:** the enforced name.
- **aliases:** legitimate alternate references (titles, nicknames) that are NOT drift.
- **driftMap:** wrong spellings/names that must be auto-corrected to `canonical`
  (this is the deterministic-fix payload; feeds the AI-name-checker machinery).
- Keyed on **full identity + role**, never surname — so Rosa vs Angela Marchetti stay
  distinct.

### 2. Seeding (primary/secondary at intake)
At book create, seed the registry's `primary`/`secondary` characters from the
character bible (the intake already produces it). Optionally cross-reference the
`consistency/fact-store` character entities, but the registry is human-blessed, never
silently mutated by the (noisy) extractor.

### 3. Reuse — inject a compact recurring roster (prevention)
Detection + enforcement (below) is the *cure* for drift; injecting the roster is the
*prevention*. Without it, the writer has no memory of established minors and invents a
new name for the next counter scene — creating the very drift we then have to fix.

- **What is injected:** a compact roster of the registry's **recurring** characters
  (`tier` in {`primary`,`secondary`,`tertiary`}) as `name — one-line role`, added to
  the `creative_writing` (draft) prompt (and naturally to the scene-brief step, which
  already plans the chapter), under a directive: *"Established supporting cast —
  reuse these; do not invent new names for these roles."* Primary/secondary are
  already in the injected bible; the new part is the `tertiary` minors.
- **What is NOT injected:** `transient` (one-shot) entries. Re-injecting a named-once
  walk-on is noise and would pressure awkward reuse. A transient is promoted to
  `tertiary` only if it actually recurs (recorded at the review gate).
- **Cost:** a dozen recurring minors at ~10 words each ≈ 150 words — negligible
  against a 3,000-word chapter and the multi-thousand-word bible. Profiles are the
  bloat; a roster is not.
- **Optional location/scene scoping** (for long books with a large roster): the scene
  brief states the chapter's locations, so inject only the minors whose registry
  `role`/location tag matches (bakery scene → Rosa/Enzo/Bex; wedding scene → the
  wedding minors). Deterministic filter; falls back to the full recurring roster if
  untagged.
- **Reinforces the cure:** because the roster is injected, the writer reuses Rosa, so
  the next chapter's manifest reports "Rosa (existing)" rather than a new name — less
  to classify, less drift to fix.

### 4. Extraction — the frontier-writer manifest
The `creative_writing` (chapter draft) step's prompt is extended to require a
**mandatory, sentinel-delimited manifest** of characters and locations the chapter
introduces or references, with the model's own new/ambiguous self-flags:

```
<!--BOOKCLAW:MANIFEST
CHARACTERS:
- Dottie | new | server at the Marchetti wedding | possibly-same-as: Rosa Marchetti? (different role, small-town)
- Marisol | mentioned | Cole's staffer, offpage | transient
LOCATIONS:
- (none new)
/MANIFEST-->
```

- **Mandatory and always present, even empty** (`CHARACTERS: none`). An *empty*
  manifest is valid (no new names); a *missing* manifest is an anomaly that triggers
  the fallback (§4) — we never assume missing = nothing happened.
- **Position-agnostic:** the writer may place the block as a **footer (default,
  retrospective — most accurate record of what is on the page)** or a **header
  (optional, prospective — a declared plan)**. The parser locates the block by its
  sentinel markers, never by offset, so header/footer/mid-document all parse and
  strip identically. **Header mode** is offered for truncation-robustness (a
  truncated chapter loses a footer manifest but keeps a header) and models that
  front-load structure; in header mode the manifest is treated as a *plan* and
  reconciled against the actual prose (flag listed-but-absent names; still catch
  spontaneously-introduced ones via the residue/entity check).

### 5. Strip / parse — 3-layer anti-bleed (cheap on the happy path)
1. **Deterministic sentinel strip + residue check.** Locate the
   `<!--BOOKCLAW:MANIFEST … /MANIFEST-->` block anywhere in the document, strip it,
   and then scan the stripped chapter to confirm no sentinel /`CHARACTERS:`
   /`LOCATIONS:` residue survives.
2. **Header/schema validation.** Validate the sentinel open/close well-formedness and
   the block's structure programmatically.
3. **Conditional light-model remnant sweep.** ONLY if the block is missing, header
   validation fails, or residue is detected: run a cheap model (Haiku / Gemini Flash)
   to find and strip any malformed manifest remnant from the prose and best-effort
   recover the character/location data.

On the happy path (frontier writer emits a clean manifest) this is pure deterministic
string work — **zero extra model calls**; the Haiku/Flash pass only fires on failure,
so the safety net is nearly free. Runs as a deterministic step in the pipeline
alongside the existing per-chapter apply stages.

### 6. Classification — model proposes, human decides
The parsed manifest yields candidate new names. Determinism never decides
same-vs-distinct. Each candidate is resolved at the existing **per-chapter review
gate**:
- The model's self-flag (new / mentioned / transient / possibly-same-as X) and the
  canon context make each candidate a 1-click decision: **new character (add at the
  right tier) / map as drift of X (record in `driftMap`) / ignore transient**.
- Surname collisions and "same name, new role" are surfaced as *ambiguous — ask*,
  with reasoning; never auto-merged.
- Policy knob (default = smart hybrid): auto-accept clearly-distinct new names as
  tertiary; surface only ambiguous candidates (surname-matches an existing character,
  single appearance, or model-flagged) for confirmation. (Owner may choose
  confirm-everything.)

### 7. Enforcement — deterministic
- **Drift-maps auto-fix deterministically**, everywhere including dialogue, via the
  shipped AI-name-checker machinery (`applyAiNames`, global scope, word-boundary,
  case-preserving) sourced per-book from the registry's `driftMap`. So once
  "Dottie → Rosa" is recorded, every "Dottie" becomes "Rosa" in this and future
  chapters.
- **Unknown-name flagging:** future chapters' names not in the registry (and not a
  known alias) are surfaced as candidates (via the manifest + a deterministic
  proper-noun cross-check as a backstop).

## Components / boundaries

| Unit | Responsibility | Depends on |
|------|----------------|-----------|
| registry store | per-book name-registry.json load/save; seed from bible | BookService |
| roster builder | compact recurring-cast roster (tertiary+ , name+role; transients excluded; optional location scope) injected into scene-brief + draft prompts | registry store, ProjectEngine prompt build |
| manifest contract | `creative_writing` prompt block spec (sentinel, fields, empty-valid, header/footer) | ProjectEngine prompt build |
| `parseManifest` | locate-by-sentinel, validate header/schema, strip, residue-check → `{characters, locations, stripped}` | none (pure) |
| remnant sweep | conditional Haiku/Flash fallback to strip/recover a malformed manifest | AIRouter (light model) |
| candidate resolver | diff manifest vs registry; classify (auto/ambiguous); surface at review gate | review gate |
| enforcement | drift-map → `applyAiNames` (per-book); unknown flagging | `deai/ai-names.ts` |

## Error handling / fail-soft
- Missing/malformed manifest → light-model sweep; if that also fails, degrade to
  no-auto-candidates for the chapter (never crash, never block, never leak). Log `⚠`.
- Registry absent (older books) → feature no-ops; enforcement falls back to any
  existing `ai-names.csv` overlay. Log `ℹ`.
- The manifest is a high-quality hint feeding a human-confirmed table — it is never
  authoritative and never auto-mutates canon.

## Testing
- `parseManifest`: locates the block as header, footer, and mid-document; empty
  manifest → valid, zero candidates; missing block → flagged for sweep; residue after
  strip → detected; malformed sentinel → validation fails.
- Anti-bleed regression: the sentinel/`CHARACTERS:` markers NEVER survive into the
  stripped chapter (mirrors the meta-note-leak class).
- Enforcement: a recorded `driftMap` ("Dottie"→"Rosa") replaces ALL occurrences incl.
  dialogue; distinct same-surname characters (Rosa vs Angela Marchetti) are never
  merged.
- Classification: surname match + different role → surfaced as ambiguous, not
  auto-mapped.
- Fixture: project-77 Ch3 draft with "Dottie Marchetti" + a registry containing "Rosa
  Marchetti (driftMap: Dottie)" → enforcement yields a clean, Rosa-only chapter.
- Roster builder: includes `tertiary`/`secondary`/`primary` entries, EXCLUDES
  `transient`; renders compact `name — role` lines; location scoping selects only
  minors tagged to the chapter's scene locations and falls back to the full recurring
  roster when untagged; an empty registry → empty roster (no prompt change).

## Phasing
- **MVP:** registry store + seed; **roster injection** (recurring cast into the
  scene-brief + draft prompts — the prevention half); manifest contract + parse/strip
  + 3-layer anti-bleed + residue tests; drift-map enforcement via the name-checker;
  candidate surfacing at the review gate (API-level, minimal UI). This delivers
  prevention + detect + enforce.
- **Phase 2:** the curation UI (1-click classify at the review gate), location/scene
  scoping of the roster, header-mode reconciliation polish, and the deterministic
  proper-noun backstop cross-check.

## Out of scope
- Full re-architecture of the LLM consistency audit (separate; the registry
  complements it deterministically for the name class).
- Replacing the character bible / prompt-injected canon (the registry is a separate,
  non-injected lookup layer).
- The immediate one-line stopgap (`Dottie,Rosa` in the current book's name-checker
  overlay) is independent of this build.
