# World Repository Phase 2 — Luminarch Migration Importer Implementation Plan

> **For agentic workers:** This plan conforms to the shared contract `docs/superpowers/plans/2026-06-21-world-repository-00-index-and-contract.md`. Use the exact type names, signatures, and paths defined there. Phase 2 **consumes** Phase 1 (`world-types.ts`, `world-parse.ts`, `WorldService`, the `world` library kind) and adds **no new contract types**. If you need a name not in the contract, that is a contract gap — stop and reconcile, do not invent.

**Spec:** `docs/superpowers/specs/2026-06-21-world-repository-design.md` — Section 5 "Migration / worked example" (lines 153–156) is the entire scope of this plan.

**Process:** `superpowers:writing-plans` → execution via `superpowers:subagent-driven-development` or `superpowers:executing-plans`.

---

## Goal

Deliver a **one-time, re-runnable** migration importer — a manually-invoked `tsx` script — that turns the owner's existing Luminarch authoring assets into live World Repository data:

1. Writes the **`luminarch-adept`** library `editor` asset (built from `interactive_luminarch_editor.json`) into the workspace library overlay.
2. Creates the **`shattered-cradle`** world: a `world.json` built from the prompt taxonomy (document types Tomb/Codex/Field-Guide/Observations, domains, clearance levels, `narrative_format_directive` → `formatDirective`, `authoringEditor: 'luminarch-adept'`), then imports every `Luminarch/*.md` as a document via `WorldService.createDocument`, **parsing the existing header** (preserving the existing classification code rather than auto-assigning) and auto-filling `summary` + `tags` deterministically.
3. **Validates** by re-reading the created world and asserting counts/fields.

The maintainer runs the importer against the live `~/data/Writing/shattered-cradle-world/Luminarch/` data on the Neptune writing instance. This plan's tests run the same importer against a temp dir seeded with small committed fixtures, so the parsing and world-build logic is provably correct without the live corpus.

## Architecture

The importer is a thin **orchestration script** plus a pure **header-parsing module** it can share with its tests:

- `scripts/import-luminarch-world.ts` — entry point. Resolves source paths (defaults to the live locations, overridable by argv so tests point at a temp dir), wires a real `LibraryService` + `WorldService` against a target library root, and runs three deterministic stages (editor → world.json → documents) followed by a validation pass. Exits non-zero on validation failure.
- `gateway/src/services/luminarch-import.ts` — pure functions: `buildLuminarchEditor(promptJson)`, `buildShatteredCradleWorldJson(promptJson)`, and `parseLuminarchHeader(raw, filename)` → `{ meta, body }` shaped for `WorldService.createDocument`. No I/O; fully unit-testable. The script does the file reads/writes and calls these.

Keeping the parsing pure (no filesystem inside `luminarch-import.ts`) is what makes the unit test small and deterministic: the test feeds fixture strings to the pure functions and feeds fixture files to the orchestration via a temp library root.

The importer is **idempotent / re-runnable**: the editor write uses `LibraryService.writeEntry` (create-or-override by name), `world.json` is written create-or-override, and each document is created with its **preserved** classification code, so a second run over the same source produces the same overlay (documents keyed by their existing classification-derived `docId`). It does not delete docs the source no longer has — re-run is additive/overwrite, matching the library overlay posture.

## Tech Stack

- Node 22+, TypeScript via `tsx` (no compile step in dev). Invoked as `node --import tsx scripts/import-luminarch-world.ts [srcPromptJson] [srcDocsDir] [libraryRoot]`.
- No new runtime dependency. `JSON.parse` for the prompt JSON; the world-doc frontmatter is produced via Phase 1's `serializeWorldDoc` (through `WorldService.createDocument`); the Luminarch *source* header is hand-parsed line-by-line in `luminarch-import.ts` (same idiom as `gateway/src/skills/loader.ts:182`).
- Tests: `tests/unit/luminarch-import.test.ts` via `node --import tsx --test` (`npm run test:unit`).

## Global Constraints (apply to every task in this plan)

- **Node 22+**; TypeScript runs through `tsx` (no compile step in dev). Type-check with `npx tsc --noEmit`.
- **Imports use `.js` extensions** even from `.ts` source (NodeNext). Match this in every new file.
- **No new runtime dependency** for parsing. Frontmatter is hand-parsed in-repo (see `gateway/src/skills/loader.ts:182`); the world-doc parser follows that line-based idiom, extended for inline `tags: [a, b]` arrays. Do not add `js-yaml`/`gray-matter`.
- **Fail-soft init/runtime.** Services log `  ✓ … / ⚠ … / ℹ …` and degrade rather than crash (matches `index.ts` and `BookService`). A bad `world.json` or bad document frontmatter loads as "needs attention", never throws at boot.
- **`schemaVersion` gating.** `world.json` and each document carry a `schemaVersion`; `WORLD_SCHEMA_VERSION = 1`. Too-new → read-only/quarantine, mirroring `classifyVersion` in `book-types.ts`. Additive optional fields on `book.json` do **not** bump its schema.
- **Commit workflow.** This repo uses a `commit_message` + `./push.sh` workflow — the maintainer commits; **do not run `git commit` / `git push`**. Each task ends at a verified, type-checking state (tests green + `npx tsc --noEmit` clean). At milestone end, write the one-line-summary-plus-dashes `commit_message` per `CLAUDE.md`. (This overrides the writing-plans skill's literal `git commit` step, per user-instruction priority.)
- **Surgical changes.** Touch only what the task requires; match existing style.
- **Docs are professional Markdown, no emojis/icons.**
- **Tests are committed and re-runnable.** Unit tests: `tests/unit/*.test.ts` via `node --import tsx --test` (`npm run test:unit`). Smoke tests: `tests/*.sh` (mirror `tests/board-grouping-smoke.sh`). Both runner styles already exist; the CLAUDE.md "no unit-test suite" line is stale.

---

## File Structure

```
gateway/src/services/
  luminarch-import.ts          # NEW — pure builders + header parser (no I/O)
scripts/
  import-luminarch-world.ts    # NEW — orchestration: read sources, write editor + world, validate
tests/unit/
  luminarch-import.test.ts     # NEW — runs the importer against a temp library root + fixtures
tests/fixtures/luminarch/
  interactive_luminarch_editor.json   # NEW — trimmed copy of the real prompt (enough keys to build the editor + world.json)
  docs/
    field-guide-for-geography.md      # NEW — fixture doc, FG-GEO header form (** bold ** fields + italic "Compiled by…")
    luminarch-codex-cn-geo-0042.md    # NEW — fixture doc, CODEX header form (Access Level / Repository)
    shard-magic-primer.md             # NEW — fixture doc, "Classification Code:" + "Document Provenance:" form
```

Phase 1 files this plan imports from (already exist — do **not** redefine):

```
gateway/src/services/world-types.ts   # WORLD_SCHEMA_VERSION, LibraryWorld, WorldDocMeta, WorldDocument, WorldDocumentType
gateway/src/services/world-parse.ts   # parseWorldJson, parseWorldDoc, serializeWorldDoc, nextClassification
gateway/src/services/world.ts         # WorldService (createDocument, getConfig, listDocuments, getDocument)
gateway/src/services/library.ts       # LibraryService (writeEntry, createEntry, reload), ENTRY_NAME_RE
gateway/src/services/library-types.ts # LibraryEditor
```

---

### Task 1: Header-parsing module — `parseLuminarchHeader`

The genuinely new logic: turn a real Luminarch markdown file's existing header into a `WorldDocMeta` (minus `classification`-via-derivation — here we **preserve** the parsed code) plus the narrative body. The real corpus has three header dialects (verified against live samples):

- **Bold-field form** (most field guides): a leading `### FIELD GUIDE: TITLE` heading, then `**Classification:** FG-GEO-0141`, `**Distribution:** Approved for General Access`, then an italic `*Compiled by … Transcribed … by …*` attribution paragraph.
- **Codex bold form**: `# CODEX: TITLE`, then `**Classification:** CN-GEO-0042`, `**Access Level:**` / `**Access Restriction:**` / `**Distribution:**` (clearance), and `**Author:** Compiled by …` (attribution).
- **Plain form** (e.g. shard-magic primer): `CODEX ENTRY: TITLE`, `Classification Code: MAG-SHD-001`, `Document Provenance: Compiled by …`.

Parsing must be deterministic and tolerant: pull the classification **code** with a regex over the whole header region, pull clearance from the first of `Distribution|Access Level|Access Restriction|Access`, pull attribution from an italic "Compiled by…"/"Author:"/"Provenance:" line, derive `type`+`domain` from the classification code, derive `summary` from the first prose sentence, derive `tags` from the filename + domain. The body is everything after the header block (we keep the original full text as the body, including its in-file heading, since these are authored documents — we do not strip the heading).

**Files:**
- `gateway/src/services/luminarch-import.ts` (NEW)
- `tests/unit/luminarch-import.test.ts` (NEW, started here)
- `tests/fixtures/luminarch/docs/*.md` (NEW, three fixtures)

**Interfaces:**

Consumes from Phase 1 (exact signatures — import, do not redefine):
```ts
// gateway/src/services/world-types.ts
export const WORLD_SCHEMA_VERSION: number;
export interface WorldDocMeta {
  title: string; type: string; classification: string; clearance: string;
  domain: string; attribution?: string; tags: string[]; summary: string;
  appendixEligible?: boolean;
}
export interface WorldDocumentType { id: string; label: string; note?: string; }
export interface LibraryWorld { /* …per contract… */ }
```

Produces (this module's public surface):
```ts
// gateway/src/services/luminarch-import.ts
/** Map a documentType id to the TYPE token used in classification codes. */
export const LUMINARCH_TYPE_CODES: Record<string, string[]>;
// e.g. { tomb: ['TB'], codex: ['CN','CX','DC'], 'field-guide': ['FG'], observations: ['OB','OBS'] }

export interface ParsedLuminarchDoc {
  /** docId stem = lower-cased classification code, e.g. "fg-geo-0141". */
  docId: string;
  meta: WorldDocMeta;   // classification PRESERVED from the source header
  body: string;         // full markdown after the header block
}

/** Parse one Luminarch source file. `filename` is the basename (for tags + fallback type). */
export function parseLuminarchHeader(raw: string, filename: string): ParsedLuminarchDoc;
```

**Steps (TDD order):**

- [ ] Create the three doc fixtures under `tests/fixtures/luminarch/docs/`, each a faithful (small) copy of a real header dialect. Use the exact field syntax seen in the corpus.

  `field-guide-for-geography.md`:
  ```markdown
  ### FIELD GUIDE: THE GEOGRAPHY OF THE SHATTERED CRADLE

  **Classification:** FG-GEO-0141
  **Distribution:** Approved for General Access

  *Compiled by Talen Windwalker of the Concord of Memory. Transcribed into High Script by Morvin Ironhand, Archivist of Vaelth-Korr.*

  ---

  ## PREFACE

  This humble field guide is intended to serve travelers of all lineages who must navigate the diverse landscapes of our transformed world. The world beyond your home territory is both wondrous and deadly.
  ```

  `luminarch-codex-cn-geo-0042.md`:
  ```markdown
  # CODEX: THE GEOGRAPHY OF THE SHATTERED CRADLE

  **Classification:** CN-GEO-0042
  **Access Level:** SILENT BINDER ELDERS
  **Repository:** VOID ARCHIVE EG-001
  **Author:** Compiled by the Concord of Memory under Elder verification.

  ---

  ## I. PLANETARY OVERVIEW

  Three million years after the Twin Cataclysms, Earth's geography has transformed dramatically into a singular supercontinent.
  ```

  `shard-magic-primer.md`:
  ```markdown
  CODEX ENTRY: SHARD MAGIC: A PRIMER

  Classification Code: MAG-SHD-001

  Original: Pre-Exodus, Approx. 4000 A.D.;
  Transcribed: Current Cycle, Year 2,999,888

  Document Provenance: Compiled by the Silent School of Verd Selen, translated into High Script by Indexors of the Third Vault beneath Erisar.

  I. THE SHARDFALL AND ITS LEGACY

  The emergence of magic on Earth is directly attributed to the Shardfall event, a catastrophic orbital disaster that occurred during the Exodus.
  ```

- [ ] Write the **failing** unit test asserting `parseLuminarchHeader` output for all three fixtures:
  ```ts
  // tests/unit/luminarch-import.test.ts
  import { test } from 'node:test';
  import assert from 'node:assert/strict';
  import { readFileSync } from 'node:fs';
  import { join } from 'node:path';
  import { parseLuminarchHeader } from '../../gateway/src/services/luminarch-import.js';

  const FIX = join(import.meta.dirname, '..', 'fixtures', 'luminarch', 'docs');
  const read = (f: string) => readFileSync(join(FIX, f), 'utf-8');

  test('parses the bold field-guide header form', () => {
    const d = parseLuminarchHeader(read('field-guide-for-geography.md'), 'field-guide-for-geography.md');
    assert.equal(d.docId, 'fg-geo-0141');
    assert.equal(d.meta.classification, 'FG-GEO-0141');
    assert.equal(d.meta.type, 'field-guide');
    assert.equal(d.meta.domain, 'GEO');
    assert.equal(d.meta.clearance, 'Approved for General Access');
    assert.match(d.meta.attribution ?? '', /Talen Windwalker/);
    assert.equal(d.meta.title, 'THE GEOGRAPHY OF THE SHATTERED CRADLE');
    assert.ok(d.meta.summary.length > 0 && d.meta.summary.length <= 200);
    assert.ok(d.meta.tags.includes('geo'));
    assert.ok(d.body.includes('PREFACE'));
  });

  test('parses the codex bold form (Access Level + Author)', () => {
    const d = parseLuminarchHeader(read('luminarch-codex-cn-geo-0042.md'), 'luminarch-codex-cn-geo-0042.md');
    assert.equal(d.docId, 'cn-geo-0042');
    assert.equal(d.meta.type, 'codex');
    assert.equal(d.meta.domain, 'GEO');
    assert.equal(d.meta.clearance, 'SILENT BINDER ELDERS');
    assert.match(d.meta.attribution ?? '', /Concord of Memory/);
  });

  test('parses the plain "Classification Code" form', () => {
    const d = parseLuminarchHeader(read('shard-magic-primer.md'), 'shard-magic-primer.md');
    assert.equal(d.docId, 'mag-shd-001');
    assert.equal(d.meta.classification, 'MAG-SHD-001');
    assert.equal(d.meta.type, 'codex'); // MAG-* with no leading TYPE token defaults to codex
    assert.equal(d.meta.domain, 'MAG');
    assert.match(d.meta.attribution ?? '', /Verd Selen/);
  });
  ```

- [ ] Run `node --import tsx --test tests/unit/luminarch-import.test.ts` → expect **FAIL** (module/function does not exist yet).

- [ ] Implement `luminarch-import.ts` with the **actual** parser. Concrete logic (no placeholders):
  ```ts
  import type { WorldDocMeta } from './world-types.js';

  /** documentType id -> classification TYPE tokens that map to it. */
  export const LUMINARCH_TYPE_CODES: Record<string, string[]> = {
    tomb: ['TB', 'TM'],
    codex: ['CN', 'CX', 'DC', 'CD'],
    'field-guide': ['FG'],
    observations: ['OB', 'OBS'],
  };

  export interface ParsedLuminarchDoc { docId: string; meta: WorldDocMeta; body: string; }

  const HEADER_SCAN_LINES = 12; // header fields live in the top of the file
  const CODE_RE = /\b([A-Z]{2,3})-([A-Z]{2,4})-(\d{2,4}(?:-[A-Z]+)?)\b/;
  const CLEARANCE_RE = /^\s*\**\s*(?:Distribution|Access Level|Access Restriction|Access)\s*:\**\s*(.+?)\s*$/i;
  const ATTR_RE = /(?:Compiled by|Author\s*:|Document Provenance\s*:|Provenance\s*:)/i;

  /** TYPE token -> documentType id, derived from LUMINARCH_TYPE_CODES (codex is the fallback). */
  function typeIdForCode(typeToken: string): string {
    for (const [id, tokens] of Object.entries(LUMINARCH_TYPE_CODES)) {
      if (tokens.includes(typeToken)) return id;
    }
    return 'codex';
  }

  /** First prose sentence (skip headings / bold-field lines), capped at 200 chars. */
  function deriveSummary(body: string): string {
    for (const line of body.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#') || t.startsWith('**') || t.startsWith('*') || t === '---') continue;
      const sentence = t.split(/(?<=[.!?])\s/)[0] ?? t;
      return sentence.length > 200 ? sentence.slice(0, 197) + '…' : sentence;
    }
    return '';
  }

  /** Tags from filename words (>=3 chars, deduped) + the domain token, lower-cased. */
  function deriveTags(filename: string, domain: string): string[] {
    const stem = filename.replace(/\.md$/i, '');
    const stop = new Set(['for', 'the', 'and', 'of', 'a', 'an', 'to', 'in', 'luminarch', 'codex', 'field', 'guide', 'general']);
    const words = stem.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !stop.has(w));
    const tags = [domain.toLowerCase(), ...words];
    return [...new Set(tags)];
  }

  /** Title from the first heading-ish line, after a "TYPE:" prefix if present. */
  function deriveTitle(raw: string): string {
    for (const line of raw.split('\n')) {
      const t = line.replace(/^#+\s*/, '').trim();
      if (!t) continue;
      const m = t.match(/^(?:FIELD GUIDE|CODEX(?:\s+ENTRY)?|TOMB|OBSERVATIONS)\s*:\s*(.+)$/i);
      return (m ? m[1] : t).trim();
    }
    return 'Untitled';
  }

  export function parseLuminarchHeader(raw: string, filename: string): ParsedLuminarchDoc {
    const lines = raw.split('\n');
    const head = lines.slice(0, HEADER_SCAN_LINES).join('\n');

    const codeMatch = head.match(CODE_RE);
    // Fallback when no code is found: derive a synthetic UNK code so import never throws.
    const typeToken = codeMatch ? codeMatch[1] : 'CN';
    const domain = codeMatch ? codeMatch[2] : 'KNW';
    const serial = codeMatch ? codeMatch[3] : '0000';
    const classification = `${typeToken}-${domain}-${serial}`;

    let clearance = 'General Access';
    let attribution: string | undefined;
    for (const line of lines.slice(0, HEADER_SCAN_LINES + 4)) {
      const c = line.match(CLEARANCE_RE);
      if (c && clearance === 'General Access') clearance = c[1].replace(/\**\s*$/, '').trim();
      if (!attribution && ATTR_RE.test(line)) {
        attribution = line.replace(/^[*\s]+|[*\s]+$/g, '')
          .replace(/^(?:Author|Document Provenance|Provenance)\s*:\s*/i, '').trim();
      }
    }

    const type = typeIdForCode(typeToken);
    const title = deriveTitle(raw);
    const summary = deriveSummary(raw);
    const tags = deriveTags(filename, domain);

    const meta: WorldDocMeta = {
      title,
      type,
      classification,
      clearance,
      domain,
      attribution,
      tags,
      summary,
      appendixEligible: true,
    };
    return { docId: classification.toLowerCase(), meta, body: raw.trimEnd() + '\n' };
  }
  ```

- [ ] Run the test → expect **PASS** (all three fixtures).
- [ ] `npx tsc --noEmit` → expect clean.

---

### Task 2: World-config + editor builders

Build the two pure config artifacts from the prompt JSON: the `luminarch-adept` editor `systemPrompt`, and the `shattered-cradle` `world.json`. The taxonomy (document types, domains, clearance levels, `classificationScheme`) is fixed per the spec; only `formatDirective`, `description`, and the editor `systemPrompt` are composed from prompt fields.

**Files:**
- `gateway/src/services/luminarch-import.ts` (extend)
- `tests/unit/luminarch-import.test.ts` (extend)
- `tests/fixtures/luminarch/interactive_luminarch_editor.json` (NEW — trimmed but key-faithful)

**Interfaces:**

Consumes from Phase 1:
```ts
import { WORLD_SCHEMA_VERSION, type LibraryWorld } from './world-types.js';
import { type LibraryEditor } from './library-types.js';
import { parseWorldJson } from './world-parse.js'; // round-trip assertion in tests
```

Produces:
```ts
// gateway/src/services/luminarch-import.ts
export function buildLuminarchEditor(prompt: any): LibraryEditor;
export function buildShatteredCradleWorldJson(prompt: any): LibraryWorld;
```

**Steps (TDD order):**

- [ ] Create `tests/fixtures/luminarch/interactive_luminarch_editor.json` — a trimmed object carrying exactly the keys the builders read, mirroring the real file's shape:
  ```json
  {
    "title": "Luminarch Adept - Initial Consultation System",
    "description": "Initial consultation interface for Shattered Cradle creative projects",
    "persona": { "name": "Jorin Vex", "title": "Luminarch Adept, Third Circle", "role": "Initial consultation specialist" },
    "kethara_persona": { "name": "Kethara of the Seventh Memory", "title": "The Unseen, Seventh of Seven", "role": "Senior consultation specialist" },
    "clearance_level_protocols": {
      "classified_topics_trigger_kethara": ["Deep historical secrets", "Classified Cloister knowledge"]
    },
    "ai_generated_name_warnings": {
      "critical_ai_defaults": { "avoid_completely": ["Sarah Chen", "Elena"] }
    },
    "world_knowledge_baseline": {
      "basic_world_facts": {
        "setting": "The Shattered Cradle - Earth 3 million years after the Great Exodus",
        "document_types": "Tomb (ancient), Codex (verified truth), Field Guide (practical), Observations (personal accounts)"
      }
    },
    "narrative_format_directive": {
      "core_requirement": "MANDATORY: New documents being created must ALWAYS be in narrative format",
      "forbidden_formatting": { "never_use": ["Bullet points", "Numbered lists for narrative content"] }
    }
  }
  ```

- [ ] Add **failing** tests:
  ```ts
  import { buildLuminarchEditor, buildShatteredCradleWorldJson } from '../../gateway/src/services/luminarch-import.js';
  import { parseWorldJson } from '../../gateway/src/services/world-parse.js';

  const prompt = JSON.parse(read('../interactive_luminarch_editor.json')); // adjust path helper to fixtures root

  test('builds the luminarch-adept editor asset', () => {
    const ed = buildLuminarchEditor(prompt);
    assert.equal(ed.name, 'luminarch-adept');
    assert.equal(ed.schemaVersion, 1);
    assert.match(ed.systemPrompt, /Jorin Vex/);
    assert.match(ed.systemPrompt, /Kethara/);
    assert.match(ed.systemPrompt, /narrative format/i);
    assert.match(ed.systemPrompt, /Sarah Chen/); // name-warning carried through
  });

  test('builds shattered-cradle world.json with the right taxonomy', () => {
    const w = buildShatteredCradleWorldJson(prompt);
    assert.equal(w.name, 'shattered-cradle');
    assert.equal(w.schemaVersion, 1);
    assert.deepEqual(w.documentTypes.map((t) => t.id), ['tomb', 'codex', 'field-guide', 'observations']);
    assert.ok(w.domains.includes('GEO') && w.domains.includes('SHD'));
    assert.deepEqual(w.clearanceLevels, ['General Access', 'Restricted', 'Cloister-Only']);
    assert.equal(w.classificationScheme, '{TYPE}-{DOMAIN}-{NNNN}');
    assert.equal(w.authoringEditor, 'luminarch-adept');
    assert.match(w.formatDirective, /narrative/i);
    // Round-trips through the Phase 1 parser (serialize → parse).
    const reparsed = parseWorldJson(JSON.stringify(w));
    assert.equal(reparsed.name, 'shattered-cradle');
  });
  ```

- [ ] Run → expect **FAIL**.

- [ ] Implement both builders. **Actual** contents (no placeholders):
  ```ts
  import { WORLD_SCHEMA_VERSION, type LibraryWorld, type WorldDocumentType } from './world-types.js';
  import type { LibraryEditor } from './library-types.js';

  const DOCUMENT_TYPES: WorldDocumentType[] = [
    { id: 'tomb', label: 'Tomb', note: 'ancient' },
    { id: 'codex', label: 'Codex', note: 'verified truth' },
    { id: 'field-guide', label: 'Field Guide', note: 'practical' },
    { id: 'observations', label: 'Observations', note: 'personal accounts' },
  ];
  const DOMAINS = ['GEO', 'MAG', 'TEC', 'BIO', 'KNW', 'HIS', 'TMP', 'SHD', 'MEM', 'DIV', 'REL', 'SOC', 'EVT', 'LUM', 'INK', 'KAR'];
  const CLEARANCE_LEVELS = ['General Access', 'Restricted', 'Cloister-Only'];

  export function buildShatteredCradleWorldJson(prompt: any): LibraryWorld {
    const facts = prompt?.world_knowledge_baseline?.basic_world_facts ?? {};
    const nfd = prompt?.narrative_format_directive ?? {};
    const never = nfd?.forbidden_formatting?.never_use;
    const forbidden = Array.isArray(never) ? never.join(', ') : 'bullet points, numbered lists';
    const formatDirective = [
      String(nfd.core_requirement ?? 'New documents must ALWAYS be in narrative format.'),
      `Narrative prose only, never ${forbidden} (handwritten/transcribed conceit).`,
      'Each document header carries a Classification code, a Distribution/clearance line, and an in-world attribution ("Compiled by …; transcribed by …").',
    ].join(' ');

    return {
      schemaVersion: WORLD_SCHEMA_VERSION,
      name: 'shattered-cradle',
      label: 'The Shattered Cradle',
      description: String(facts.setting ?? 'Earth, three million years after the Great Exodus.'),
      documentTypes: DOCUMENT_TYPES,
      domains: DOMAINS,
      clearanceLevels: CLEARANCE_LEVELS,
      classificationScheme: '{TYPE}-{DOMAIN}-{NNNN}',
      formatDirective,
      authoringEditor: 'luminarch-adept',
      stripCodesInAppendix: true,
    };
  }

  export function buildLuminarchEditor(prompt: any): LibraryEditor {
    const p = prompt?.persona ?? {};
    const k = prompt?.kethara_persona ?? {};
    const classified = prompt?.clearance_level_protocols?.classified_topics_trigger_kethara ?? [];
    const avoid = prompt?.ai_generated_name_warnings?.critical_ai_defaults?.avoid_completely ?? [];
    const nfd = prompt?.narrative_format_directive ?? {};

    const systemPrompt = [
      `You are ${p.name ?? 'Jorin Vex'}, ${p.title ?? 'Luminarch Adept'}, working under ${k.name ?? 'Kethara of the Seventh Memory'} (${k.title ?? 'The Unseen, Seventh of Seven'}) in the Luminarch Cloister of the Shattered Cradle.`,
      `Role: ${p.role ?? 'consultation and document creation'}. For classified topics, defer to Kethara.`,
      classified.length ? `Topics that require Kethara (classified): ${classified.join('; ')}.` : '',
      `Document format: ${nfd.core_requirement ?? 'New documents must ALWAYS be in narrative format.'} ` +
        `Write flowing narrative prose only — never bullet points or numbered lists (these are handwritten, transcribed documents). ` +
        `Every document opens with a Classification code, a Distribution/clearance line, and an in-world attribution.`,
      avoid.length ? `Naming: avoid AI-default names entirely (${avoid.join(', ')}); choose intentional, phonetically varied names.` : '',
      'Before answering, search existing project knowledge to stay consistent with established lore; never contradict it.',
    ].filter(Boolean).join('\n\n');

    return {
      schemaVersion: 1,
      name: 'luminarch-adept',
      label: 'Luminarch Adept',
      description: String(prompt?.description ?? 'In-world authoring editor for the Shattered Cradle.'),
      specialty: 'Worldbuilding documents',
      systemPrompt,
      temperature: 0.7,
    };
  }
  ```

- [ ] Run → expect **PASS**. `npx tsc --noEmit` → clean.

---

### Task 3: Orchestration script + end-to-end importer test

Wire the pure pieces into a runnable script that reads the real source files, persists the editor + world, imports each document through `WorldService.createDocument` (preserving its classification), and validates. The end-to-end unit test runs the **same** importer entry function against a temp library root seeded with the fixtures.

To keep the script testable without a live filesystem dependency, factor the orchestration into an exported `runImport(opts)` the script's CLI shim calls. The test imports `runImport` directly.

**Files:**
- `scripts/import-luminarch-world.ts` (NEW)
- `tests/unit/luminarch-import.test.ts` (extend — the end-to-end case)

**Interfaces:**

Consumes from Phase 1:
```ts
// gateway/src/services/library.ts
class LibraryService {
  constructor(builtinDir: string, workspaceDir: string, skills: SkillCatalogLike);
  loadAll(): Promise<void>;
  reload(): Promise<void>;
  writeEntry(kind: 'editor', name: string, body: { content?: string }): Promise<void>; // editor → JSON in body.content
}
// gateway/src/services/world.ts
class WorldService {
  constructor(library: LibraryService);
  getConfig(name: string): LibraryWorld | undefined;
  listDocuments(name: string): WorldDocCatalogRow[];
  getDocument(name: string, docId: string): WorldDocument | undefined;
  createDocument(name: string, input: { meta: Omit<WorldDocMeta,'classification'> & { classification?: string }; body: string }): WorldDocument;
}
```
Note: `WorldService` reads worlds from the library overlay, so `world.json` is written to `<libraryRoot>/worlds/shattered-cradle/world.json` directly (it is not a `LibraryService` file-write path the way the editor is — the world *config* normally rides the library API, but for the importer we write the directory + `world.json` ourselves, then `library.reload()` so `WorldService` sees it). Confirm the exact overlay path from Phase 1's `DIR_LAYOUT` (`world: 'worlds'`) before writing.

Produces:
```ts
// scripts/import-luminarch-world.ts
export interface ImportOpts {
  promptJsonPath: string;   // interactive_luminarch_editor.json
  docsDir: string;          // directory of Luminarch *.md files
  libraryRoot: string;      // workspace library overlay root (writes worlds/ + editors/ under here)
}
export interface ImportResult { editorWritten: boolean; documentCount: number; skipped: string[]; worldName: string; }
export async function runImport(opts: ImportOpts): Promise<ImportResult>;
```

**Steps (TDD order):**

- [ ] Add the **failing** end-to-end test. It seeds a temp library root, points `runImport` at the fixture prompt + fixture docs, then asserts the persisted results by re-reading through a fresh `WorldService`:
  ```ts
  import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
  import { tmpdir } from 'node:os';
  import { LibraryService } from '../../gateway/src/services/library.js';
  import { WorldService } from '../../gateway/src/services/world.js';
  import { runImport } from '../../scripts/import-luminarch-world.js';

  test('imports editor + world + documents into a temp library', async () => {
    const root = mkdtempSync(join(tmpdir(), 'luminarch-import-'));
    try {
      const FIXROOT = join(import.meta.dirname, '..', 'fixtures', 'luminarch');
      const res = await runImport({
        promptJsonPath: join(FIXROOT, 'interactive_luminarch_editor.json'),
        docsDir: join(FIXROOT, 'docs'),
        libraryRoot: root,
      });

      assert.equal(res.editorWritten, true);
      assert.equal(res.worldName, 'shattered-cradle');
      assert.equal(res.documentCount, 3);
      assert.deepEqual(res.skipped, []);

      // Editor asset on disk.
      assert.ok(existsSync(join(root, 'editors', 'luminarch-adept.json')));

      // Re-read through a fresh service stack (no shared state with the importer).
      const lib = new LibraryService('/nonexistent-builtin', root, { list: () => [] } as any);
      await lib.loadAll();
      const world = new WorldService(lib);

      const cfg = world.getConfig('shattered-cradle');
      assert.ok(cfg);
      assert.deepEqual(cfg!.documentTypes.map((t) => t.id), ['tomb', 'codex', 'field-guide', 'observations']);
      assert.equal(cfg!.authoringEditor, 'luminarch-adept');

      const catalog = world.listDocuments('shattered-cradle');
      assert.equal(catalog.length, 3);

      const fg = world.getDocument('shattered-cradle', 'fg-geo-0141');
      assert.ok(fg);
      assert.equal(fg!.meta.classification, 'FG-GEO-0141'); // PRESERVED, not re-assigned
      assert.equal(fg!.meta.clearance, 'Approved for General Access');
      assert.match(fg!.meta.attribution ?? '', /Talen Windwalker/);
      assert.ok(fg!.body.includes('PREFACE'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  ```
  (Adjust the `SkillCatalogLike` stub to whatever Phase 1 / the existing `LibraryService` constructor expects — match how other tests construct it.)

- [ ] Run → expect **FAIL** (`runImport` does not exist).

- [ ] Implement `scripts/import-luminarch-world.ts`. **Actual** orchestration:
  ```ts
  import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
  import { join } from 'node:path';
  import { LibraryService } from '../gateway/src/services/library.js';
  import { WorldService } from '../gateway/src/services/world.js';
  import {
    buildLuminarchEditor,
    buildShatteredCradleWorldJson,
    parseLuminarchHeader,
  } from '../gateway/src/services/luminarch-import.js';

  export interface ImportOpts { promptJsonPath: string; docsDir: string; libraryRoot: string; }
  export interface ImportResult { editorWritten: boolean; documentCount: number; skipped: string[]; worldName: string; }

  export async function runImport(opts: ImportOpts): Promise<ImportResult> {
    const prompt = JSON.parse(readFileSync(opts.promptJsonPath, 'utf-8'));

    // Build config artifacts (pure).
    const editor = buildLuminarchEditor(prompt);
    const worldJson = buildShatteredCradleWorldJson(prompt);

    // Stage 1: editor asset via the library overlay (create-or-override by name).
    const lib = new LibraryService('/nonexistent-builtin', opts.libraryRoot, { list: () => [] } as any);
    await lib.loadAll();
    await lib.writeEntry('editor', 'luminarch-adept', { content: JSON.stringify(editor, null, 2) });
    console.log('  ✓ wrote editor asset: luminarch-adept');

    // Stage 2: world.json directly into the overlay, then reload so WorldService sees it.
    const worldDir = join(opts.libraryRoot, 'worlds', worldJson.name);
    mkdirSync(worldDir, { recursive: true });
    writeFileSync(join(worldDir, 'world.json'), JSON.stringify(worldJson, null, 2) + '\n', 'utf-8');
    await lib.reload();
    console.log(`  ✓ wrote world.json: ${worldJson.name}`);

    const world = new WorldService(lib);

    // Stage 3: import each *.md document, preserving its classification code.
    const files = readdirSync(opts.docsDir).filter((f) => f.toLowerCase().endsWith('.md'));
    const skipped: string[] = [];
    let count = 0;
    for (const f of files) {
      try {
        const raw = readFileSync(join(opts.docsDir, f), 'utf-8');
        const parsed = parseLuminarchHeader(raw, f);
        world.createDocument(worldJson.name, { meta: parsed.meta, body: parsed.body });
        count++;
      } catch (err) {
        skipped.push(`${f}: ${(err as Error).message}`);
        console.log(`  ⚠ skipped ${f}: ${(err as Error).message}`);
      }
    }
    console.log(`  ✓ imported ${count} document(s); skipped ${skipped.length}`);

    // Validation: re-read and assert counts.
    const catalog = world.listDocuments(worldJson.name);
    if (catalog.length !== count) {
      throw new Error(`Validation failed: created ${count} but catalog has ${catalog.length}`);
    }
    if (!world.getConfig(worldJson.name)) {
      throw new Error('Validation failed: world.json did not load through WorldService');
    }

    return { editorWritten: true, documentCount: count, skipped, worldName: worldJson.name };
  }

  // CLI shim — only runs when invoked directly, not when imported by tests.
  const isMain = import.meta.url === `file://${process.argv[1]}`;
  if (isMain) {
    const [promptArg, docsArg, libArg] = process.argv.slice(2);
    const opts: ImportOpts = {
      promptJsonPath: promptArg ?? '/home/paul/data/Dropbox/Writing/AI-Prompts/ChatPrompts/interactive_luminarch_editor.json',
      docsDir: docsArg ?? `${process.env.HOME}/data/Writing/shattered-cradle-world/Luminarch`,
      libraryRoot: libArg ?? `${process.env.HOME}/bookclaw-workspace/library`,
    };
    runImport(opts)
      .then((r) => {
        console.log(`\nImport complete: ${r.documentCount} docs into '${r.worldName}'.`);
        if (r.skipped.length) { console.log(`Skipped:\n  ${r.skipped.join('\n  ')}`); process.exit(1); }
        process.exit(0);
      })
      .catch((err) => { console.error('Import failed:', err); process.exit(1); });
  }
  ```
  Notes for the implementer:
  - The live `docsDir` contains non-`.md` files (`.jpg`, `.csv`, `.docx`) and meta files (`CLAUDE.md`, `GEMINI.md`, `luminarch-document-reference.md`). The `.md` filter handles extensions; if the live run pulls in `CLAUDE.md`/`GEMINI.md`/`luminarch-document-reference.*`, they will surface as `skipped` (no classification code → handled by the fallback `CN-KNW-0000`, which means they import as low-value docs). If the maintainer wants them excluded, add an explicit basename skip-list — flag this as a decision point, do not silently filter beyond `.md`.
  - `WorldService.createDocument` is called with `meta.classification` **set** (preserved), so per the contract it does **not** auto-assign — verify Phase 1 honours a provided `classification` (the contract's `createDocument` signature accepts `classification?`). If Phase 1 ignores a provided code, that is a contract mismatch — stop and reconcile.

- [ ] Run the end-to-end test → expect **PASS**.
- [ ] Run the whole unit file `node --import tsx --test tests/unit/luminarch-import.test.ts` → all green.
- [ ] `npx tsc --noEmit` → clean.

---

### Task 4: Wire the npm script + document the manual run

Make the importer discoverable and document the live invocation (this is a maintainer-run, one-time tool — no auto-execution).

**Files:**
- `package.json` (add a script entry)
- `docs/TODO.md` / `docs/COMPLETED.md` (move the Phase 2 item on completion, per `CLAUDE.md`)

**Interfaces:** none new.

**Steps:**

- [ ] Add to `package.json` `scripts`: `"import:luminarch": "node --import tsx scripts/import-luminarch-world.ts"`. Match the existing script style (do not reformat the block).
- [ ] Verify the script runs with `--help`-less argv defaults only on the maintainer's box; in CI/dev just confirm `npm run import:luminarch -- /tmp/does-not-exist.json /tmp/empty /tmp/lib` exits non-zero with a clear error (no crash trace). This is the debug-logging path — the `  ✓ / ⚠` lines stream to stdout so a failing live run is diagnosable without re-instrumenting.
- [ ] `npx tsc --noEmit` → clean. `node --import tsx --test tests/unit/luminarch-import.test.ts` → green.
- [ ] On completion, move the Phase 2 line from `docs/TODO.md` to `docs/COMPLETED.md` with a `2026-…` date (per `CLAUDE.md` feature-tracking rules), and write the `commit_message` file. Do **not** `git commit`.

---

## Self-Review

**Placeholder scan.** No `TODO`, `FIXME`, `...`, or stubbed bodies remain. Every code block (`parseLuminarchHeader`, `buildLuminarchEditor`, `buildShatteredCradleWorldJson`, `runImport`) is the actual implementation, grounded in the real header dialects observed in the corpus (bold-field FG, codex bold with `Access Level`/`Author`, plain `Classification Code:`/`Document Provenance:`). The `world.json` and editor `systemPrompt` show their literal composed contents.

**Internal consistency.** All Phase 1 names used (`WORLD_SCHEMA_VERSION`, `LibraryWorld`, `WorldDocMeta`, `WorldDocumentType`, `WorldService.createDocument/getConfig/listDocuments/getDocument`, `parseWorldJson`, `LibraryService.writeEntry`, `LibraryEditor`, `DIR_LAYOUT.world = 'worlds'`) match the contract verbatim. No new contract types are introduced — this plan only adds `luminarch-import.ts` (pure helpers) and the script. The editor is persisted via `LibraryService.writeEntry('editor', …, { content })` (JSON string), matching the real `writeEntry` editor branch (`library.ts:140`). `docId` = lower-cased preserved classification, consistent with the contract's `docId` ("filename stem under documents/").

**Scope.** Exactly Phase 2 (spec §5 migration). Out of scope and intentionally excluded: setting the `world` ref on the live series + running propose/curate (spec §5 step 3 — that is Phase 3 binding/pull), any AI call (summaries/tags are deterministic, no LLM), FTS indexing, and a documents-aware world `.zip` (deferred per contract §Deferred). The importer does not delete or migrate book bibles.

**Ambiguity / decision points flagged (not silently resolved).** (1) Whether to exclude non-document `.md` files in the live corpus (`CLAUDE.md`, `GEMINI.md`, `luminarch-document-reference.md`) — flagged in Task 3 as a maintainer decision; the default imports them under a fallback `CN-KNW-0000` rather than crashing. (2) Whether Phase 1's `createDocument` honours a **provided** `classification` (preserve) vs. always auto-assigning — flagged as a contract-reconcile checkpoint; the contract signature accepts `classification?`, and preservation is required by this plan ("preserving the existing classification code rather than auto-assigning"). (3) The `world.json` is written directly into the overlay dir + `library.reload()` rather than via a `LibraryService` world-file path, because world is the only kind that is a config file **plus** a `documents/` subdir (contract §Library wiring) — confirm Phase 1's exact overlay path before writing.

**TDD discipline.** Every task writes a failing test first (run → expect FAIL), implements, re-runs (expect PASS), and closes with `npx tsc --noEmit`. Tests use small committed fixtures (`tests/fixtures/luminarch/`) and a temp library root, so they are hermetic and re-runnable; the live ~40-doc import is the maintainer's manual `npm run import:luminarch`.

**Constraints honoured.** `.js` import extensions throughout; no new runtime dependency (hand-parsed source headers, `JSON.parse`, Phase 1's serializer); fail-soft (per-doc `try/catch` → `skipped[]`, fallback classification, never throws mid-import); `commit_message`/`push.sh` workflow (no literal `git commit`); professional Markdown.
