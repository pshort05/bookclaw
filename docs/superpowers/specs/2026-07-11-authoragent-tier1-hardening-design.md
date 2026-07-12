# AuthorAgent Tier-1 Hardening — Design & Spec

- **Date:** 2026-07-11
- **Source:** Tier 1 of `docs/AUTHORAGENT-PORT-ANALYSIS-2026-07-11.md` — three live defects in the
  current BookClaw tree that the sibling fork `Ckokoski/AuthorAgent` already fixed.
- **Reference implementation:** fetched locally as ref `authoragent/main` (compare:
  `https://github.com/pshort05/bookclaw/compare/main...Ckokoski:AuthorAgent:main`).

## What this is

Three surgical hardening fixes, each closing a confirmed live risk. They are file-disjoint and can be
built in parallel.

1. **Skill-match token cap** — `gateway/src/skills/loader.ts`
2. **`.gitignore` deny-by-default for `workspace/`** — repo-root `.gitignore`
3. **Injection-detector severity model (fiction scoping)** — `gateway/src/security/injection.ts` and
   its callers

None changes a public API shape in a breaking way; all preserve existing behavior for the normal
(non-adversarial, non-oversized) path.

---

## 1. Skill-match token cap

### Problem

`SkillLoader.matchSkills(input)` (`gateway/src/skills/loader.ts:229`) iterates all loaded skills and
pushes the **full markdown content** of every trigger-substring match, with no cap on count and no
budget on total size. Several romance skill files are 15–23 KB. A chat message matching 3–4 skills
silently injects tens of thousands of untracked tokens into the system prompt. Called on every chat
message at `gateway/src/index.ts:767`.

### Reference (AuthorAgent)

Their `matchSkills` scores each skill by trigger-match quality (word-bounded match beats substring;
longer triggers score higher; multiple trigger hits add signal), sorts descending, takes the top
`MAX_MATCHED_SKILLS = 3`, then assembles within a `CONTENT_BUDGET_CHARS = 8000` budget — truncating a
body that overflows (with a `[truncated]` marker + `⚠` log) or omitting it if the budget is
exhausted. (Their version also prepends a `## Skill: <name>` header and records usage stats; both are
out of scope here — the header changes injected content and usage-tracking is a separate skipped
feature.)

### Design (BookClaw)

Adapt the ranking + cap + budget, but **preserve the current output contract**: `matchSkills` returns
`string[]` of skill bodies that callers `join('\n')` into the prompt (`index.ts:1257`). Do NOT add the
`## Skill:` header (that changes what is injected and could regress prompt behavior). Do NOT add usage
tracking.

- Constants: `MAX_MATCHED_SKILLS = 3`, `CONTENT_BUDGET_CHARS = 8000` (module-level, documented).
- Score each skill: for each trigger the input contains, add a base weight (word-boundary match higher
  than bare substring) plus a length bonus; multiple trigger hits add a bonus. Only skills with ≥1 hit
  are candidates.
- Sort by score desc, take top `MAX_MATCHED_SKILLS`.
- Assemble within `CONTENT_BUDGET_CHARS`: include each selected skill's content whole if it fits;
  else truncate to the remaining budget with a trailing `\n[truncated]` and a `⚠` log; once the budget
  is exhausted, skip the rest with a `⚠` log.
- `matchSkillNames` (`loader.ts:265`) must return names for the **same** selected+ordered set as
  `matchSkills` (it is used for activity logging and must stay in agreement). Factor the scoring into a
  private helper both call, so names and bodies never diverge.

### Fail-soft / compatibility

- Zero matches → `[]` (unchanged).
- A skill with no triggers or empty content is handled without error.
- Output remains `string[]`; the join-based caller is unaffected except the total is now bounded.

---

## 2. `.gitignore` deny-by-default for `workspace/`

### Problem

The repo `.gitignore` (lines 19–40) uses an **allow-list** of specific `workspace/` subdirectories.
Confirmed via `git check-ignore` that several runtime directories written by the app
(`workspace/images/`, `workspace/.import-staging/`, `workspace/character-voices/`,
`workspace/plot-promises/`, `workspace/website/`) are currently untracked but **not** ignored by any
rule. They are empty today, but the only commit path (`push.sh`) runs `git add .`, so a future write
into any of them would be swept into version control (private manuscripts, staged imports, generated
covers, author voice fingerprints).

### Design

Flip to **deny-by-default**: ignore `workspace/*`, then re-include only the product-default files that
ship with the repo. The currently-tracked shipped defaults (from `git ls-files workspace/`) are:

- `workspace/SKILLS.txt`
- `workspace/soul/PERSONALITY.md`, `workspace/soul/SOUL.md`, `workspace/soul/STYLE-GUIDE.md`,
  `workspace/soul/VOICE-PROFILE.md`
- `workspace/projects/.template/README.md`

Re-include structure (mirroring AuthorAgent's pattern, but matching BookClaw's actual tracked set):

```
# Deny-by-default: ignore everything under workspace/, then re-include ONLY the
# product-default files meant to ship with the repo. Prevents a stray `git add .`
# (push.sh) from ever committing the author's private manuscripts, memory,
# staged imports, generated covers, or voice fingerprints.
workspace/*
!workspace/soul/
!workspace/SKILLS.txt
!workspace/projects/
workspace/projects/*
!workspace/projects/.template/
```

### Verification requirement

After the change, `git check-ignore` must confirm:

- The six currently-tracked files are still NOT ignored (they must remain committable/tracked).
- The five leak-risk dirs (`workspace/images/`, `.import-staging/`, `character-voices/`,
  `plot-promises/`, `website/`) ARE now ignored.
- Representative always-runtime dirs (`workspace/books/`, `workspace/memory/`, `workspace/.vault/`)
  remain ignored.
- `git status --porcelain` shows no newly-untracked-but-committable workspace content.

Note: BookClaw ships a **live** `workspace/soul/VOICE-PROFILE.md` (already tracked), unlike
AuthorAgent which strips it to a template — do NOT re-ignore `VOICE-PROFILE.md` here (that would
untrack an existing file). Keep the current tracked set intact; only close the leak gaps.

---

## 3. Injection-detector severity model (fiction scoping)

### Problem

`InjectionDetector.scan(input)` (`gateway/src/security/injection.ts:48`) returns a flat
`{ detected, type, confidence }` and the callers **hard-block** on any match. It is live in two
production paths:

- Chat: `index.ts:624` `handleMessage()` scans every message and blocks.
- Import gate: `book-transfer.ts` / `library-transfer.ts` / `transfer-security.ts` scan staged import
  files and gate `/api/library/import` on findings.

Several patterns are narrative-prose-prone. The clearest is `role_hijack`
(`/you\s+are\s+now\s+(in\s+|(a|an|the)\s+)\w+/i`, e.g. "you are now in the throne room"), plus
`mode_switch` ("maintenance mode" / "developer mode") and `instruction_inject` ("new instructions:").
An author pasting manuscript prose into chat for editing help, or importing a library entry/skill
containing ordinary narrative, gets the whole message/import **blocked** — a false-positive class that
is worse for a fiction-writing tool.

### Reference (AuthorAgent)

They add a severity model: manuscript/writing-channel prose is downgraded to warn + audit +
caution-note instead of a hard block, while exfiltration, RCE, and hidden-HTML patterns always
hard-block.

### Design (BookClaw)

Add a per-pattern **severity** so the detection engine stays advisory but stops false-blocking fiction.

- Extend each pattern entry with `severity: 'block' | 'warn'`.
  - **`block`** (real threats, always hard-block regardless of surface): `direct_override`,
    `memory_wipe`, `system_prompt_inject`, `fake_system_tag`, `jailbreak`, `data_exfil`,
    `sensitive_file_access`, `remote_code_exec`, `hidden_html_injection`, `zero_width_injection`.
  - **`warn`** (narrative-prose-prone, downgrade to warn+audit): `role_hijack`, `mode_switch`,
    `instruction_inject`.
- `scan(input)` returns `{ detected, type, confidence, pattern, severity }` on a match (add
  `severity`), `{ detected: false }` otherwise. **Return the first `block` match if any exists**
  (threats take priority over narrative warnings), otherwise the first `warn` match. This ensures a
  message that contains both an exfil attempt and narrative prose is still blocked.
- Callers act on `severity`:
  - Chat (`index.ts:624`): on `block` → keep today's hard-block behavior; on `warn` → do NOT block;
    log a `⚠` + write an audit entry (reuse the existing audit log) and continue processing the
    message.
  - Import gate (`transfer-security.ts` / `book-transfer.ts` / `library-transfer.ts`): on `block` →
    keep gating (reject/flag as today); on `warn` → record the finding as advisory (surface it) but do
    NOT hard-reject the import. Preserve the confirmation-gate behavior for `block`-level findings per
    `docs/SECURITY.md`.
- Backward compatibility: add `severity` as an optional field so any consumer reading only
  `detected/type/confidence` still compiles. Default any un-annotated pattern to `block` (fail-closed).

### Security posture

This does not weaken defense against real injection — every exfil/RCE/hidden/override pattern still
hard-blocks. It only stops the three narrative patterns from hard-blocking legitimate fiction, which
`docs/SECURITY.md` already frames as an advisory, defense-in-depth layer (not the security boundary —
that is bearer auth + sandbox). Update `docs/SECURITY.md` if it documents the detector's block-all
behavior.

---

## Scope & non-goals

**In scope:** the three fixes above, their unit tests, a smoke test exercising the new behavior, and
any doc touch-ups (`docs/SECURITY.md`).

**Out of scope:** skill usage-tracking / skill-curator (separate skipped feature), the `## Skill:`
header reformat, any change to the confirmation-gate flow for `block`-level findings, and the broader
AuthorAgent ports (Tiers 2–5).

## Testing

- **Unit (item 1):** ranking picks the highest-scoring skills; the top-N cap holds; total injected
  content stays within `CONTENT_BUDGET_CHARS`; an oversized body is truncated with `[truncated]`;
  `matchSkills` and `matchSkillNames` agree on the selected set; zero-match returns `[]`.
- **Unit (item 3):** a `block` pattern (exfil/RCE) → `severity:'block'`; a `warn` pattern
  ("you are now in the throne room") → `detected:true, severity:'warn'`; a message with both →
  `block` wins; a clean fiction sentence → not detected.
- **Item 2:** a scripted/`git check-ignore` assertion (see §2 Verification) — committed as a test
  under `tests/` so it is repeatable.
- **Smoke:** boot the gateway and assert the injection endpoint/behavior downgrades a narrative
  message (warn, not blocked) while still blocking an exfil attempt; and that a large skill match is
  bounded. Model on the existing `tests/smoke-test.sh` / feature-smoke conventions.
