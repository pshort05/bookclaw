# Config-not-code pipeline follow-ups — STATUS / HANDOFF

Source: `docs/TODO.md` → "Config-not-code pipelines — follow-ups (from the 2026-06-14 review)".
Three items, each run through the full 8-step workflow (design → plan → TDD → code-review → fix medium+ → smoke → deploy to Mercury → run smoke). Then a final full-smoke update + run.

Started: 2026-06-18. Driver: autonomous (per user request).

## Decisions (don't re-litigate)
- **Claude runs `./push.sh` itself this session** (user authorized; overrides the standing never-push rule for this task only). After push, deploy = `touch build_now` is bundled in the commit; Mercury watcher pulls + runs `scripts/deploy.sh`. Verify via `.build-logs/last-build.status` fresh PASS, then smoke against `http://192.168.1.32:3847`.
- **Per-feature cadence**: deploy + remote smoke after EACH of the 3 features (3 Docker rebuilds + 3 paid feature-smokes ~$0.25 each).
- Work on `main`. Unit tests: `node --import tsx --test tests/unit/*.test.ts`. Local smoke uses a free port (neptune :3847 is taken): `PORT=3947 bash tests/smoke-test.sh`.

## Feature designs (approved by investigation; see code refs)

### F1 — Sequence run advancement (multi-pipeline books)
- Problem: `createBookSequence` (projects.ts) makes N `pending` projects linked by `pipelineId` + `pipelinePhase`; route returns `{pipelineId, project: projects[0], projects}`. `PipelineRail.startPipeline` only consumes `projects[0]`; no advance when phase N completes.
- Design (cost-safe auto-advance, NO unattended AI):
  - `ProjectEngine.advancePipeline(pipelineId)` → starts the next still-`pending` phase project IFF the immediately-preceding phase is `completed`; returns the started Project or null. Marks active only — does NOT execute steps (zero AI cost).
  - `onProjectCompleted` hook (init phase): on completion of a project with `pipelineId`, call `advancePipeline` to auto-start the next phase.
  - Routes: `GET /api/projects/pipeline/:pipelineId` (list, sorted by phase) + `POST /api/projects/pipeline/:pipelineId/advance` (explicit, used by smoke + manual control).
  - Frontend PipelineRail (minimal): consume `projects[]`+`pipelineId` from create; show "Phase X of N"; when tracked project completes and has a pipelineId, switch to the next pipeline project.
- Tests: unit `advancePipeline` (advances when prev complete; no-op when prev incomplete / no next / already started). Smoke: create multi-pipeline book → start+execute phase 1 to completion → assert phase 2 auto-started (or advance endpoint starts it).

### F2 — Skill content on the studio run path
- Problem: `index.ts:1918-1929` (bridge `startAndRunProject`) injects passive step-skill content (book snapshot → global SkillLoader). Studio paths `projects.routes.ts` `/execute` (~392) and `/auto-execute` (~590) build `buildProjectContext` WITHOUT it.
- Design: extract a shared `passiveSkillBlock(services, skillName, bookSlug): string` into `services/skill-runner.ts` (sibling to `runExecutableSkillStep`). Returns `\n\n# Skill: <name>\n\n<content>` or ''. Call from all 3 sites; replace the inline index.ts block.
- Tests: unit `passiveSkillBlock` (no name→''; book snapshot wins; falls back to global; neither→''). Smoke: extend `skill-steps-smoke.sh` to assert a passive-skill step run via `/execute` carries skill guidance (or unit-level is sufficient).

### F3 — Migrated-book pipeline baseline
- Problem: `migrateBookToV2` (book.ts:331) writes `templates/pipeline/<name>.json` but not `.baseline/pipeline/<name>.json` → re-pull reports `no-baseline`, loses 3-way merge.
- Design: in the migration, also write `.baseline/pipeline/<name>.json` (from the legacy `.baseline/pipeline.json` if present, else from the templates content being migrated).
- Tests: unit (extend `book-migration-v2.test.ts`): after migrating a v1 book, `.baseline/pipeline/<name>.json` exists and re-pull no longer returns `no-baseline`.

## Phase table
| Feature | design | plan | TDD code | code-review | fix med+ | smoke | deploy | remote-smoke |
|---------|--------|------|----------|-------------|----------|-------|--------|--------------|
| F1 sequence advance | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| F2 skill on studio   | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| F3 migration baseline| ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 🔄 | ✅(local) |
| Final: update+run full smoke | — | — | — | — | — | ✅ | — | ✅ |

**ALL DONE (2026-06-18).** 3 features built+reviewed+deployed; full feature-smoke vs Mercury **90/0/0** (incl. Tier E: F1 7/7, F2 6/6). 394 unit tests. TODO→COMPLETED moved. Remaining: commit the test/doc-only Tier-E + bookkeeping changes (no app change → no redeploy).

## How to resume
Next action: implement F2 with TDD — extract `passiveSkillBlock(services, skillName, bookSlug)` into `gateway/src/services/skill-runner.ts` (write `tests/unit/skill-injection.test.ts` first), then call it from index.ts startAndRunProject + the two studio paths in projects.routes.ts (/execute ~392, /auto-execute ~590).

## Deploy mechanics (learned during F1 — don't re-discover)
- `./push.sh` commits but its `git push` FAILS in this sandbox (HTTPS remote, no creds). The commit is made locally. Push manually via SSH: `GIT_SSH_COMMAND="ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new" git push git@github.com:pshort05/bookclaw.git main`. Then `rm -f commit_message` (push.sh's set -e aborts before it deletes the file).
- Deploy trigger: `touch build_now` (gitignored). A build watcher consumes it on a timer tick (~1-2 min), runs scripts/deploy.sh, writes `.build-logs/last-build.status` (`commit=<short> result=PASS`). Mercury live at http://192.168.1.32:3847. Token: `grep '^BOOKCLAW_AUTH_TOKEN=' docker/.env`.
- Verify deploy: `cat .build-logs/last-build.status` shows your commit + PASS; then curl Mercury /api/status (version V26.06.18).

## Log
- 2026-06-18: investigated all 3; designs above.
- 2026-06-18: F1 coded (TDD). `advancePipeline` + tests/unit/pipeline-advance.test.ts (5 tests); onProjectCompleted auto-advance hook (phase-06-content.ts); POST /api/pipeline/:id/advance route; PipelineRail follow-to-next-phase + "Phase X / N" + Project type fields. Backend tsc clean, studio build clean, 387/387 unit.
- 2026-06-18: F1 code-review (3 finder agents). Fixed: (B2) corrected over-claiming "zero unattended cost" comments — accurate now re: heartbeat picks up active/pending sequence projects when autonomous mode is ON (pre-existing; no NEW cost); (F5) PipelineRail follow-effect set `followedRef` before the fetch → a transient failure dead-ended the sequence; now set only after a successful pipeline read; (F4) reset seqTotal on pipeline switch. Added docs/TODO.md note: heartbeat doesn't enforce sequence phase order in autonomous mode (pre-existing, out of scope). Re-verified tsc/build/tests.
- 2026-06-18: F1 smoke `tests/pipeline-advance-smoke.sh` (gate + real-AI auto-advance hook). Local boot test clean. Deployed F1 (commit cce955e, last-build PASS). Mercury smoke 7/7 (incl. real-AI phase-1 completion → phase-2 auto-started). F1 DONE.
- 2026-06-18: F3 deployed (commit aca105f, last-build PASS). Step 9: added Tier E to tests/feature-smoke.sh (runs the F1 + F2 dedicated sub-smokes against the same target; F3 noted as local/unit-covered). Running full feature-smoke against Mercury — 87/0/0 through Tier D, Tier E pending.

- 2026-06-18: F3 coded (TDD). migrateBookToV2 now also writes `.baseline/pipeline/<name>.json` (relocate legacy `.baseline/pipeline.json` if present, else seed from templates). 2 new tests in book-migration-v2.test.ts. tsc clean, 394/394 unit. Code-review (1 agent) → [] (fail-soft preserved, idempotent, no wrong-file reads, only affects migrated v1 books). Smoke `tests/migration-baseline-smoke.sh` is LOCAL (boots a gateway, drops a v1 fixture, drives repull → migrate; Mercury has only v2 books so no remote smoke possible — migration paths also unit-covered). Local smoke 5/5. Deploying F3 to Mercury.

- 2026-06-18: F2 coded (TDD). `passiveSkillBlock` helper in skill-runner.ts + tests/unit/skill-injection.test.ts (5); wired into index.ts startAndRunProject (replaced inline block) + projects.routes.ts /execute + /auto-execute. tsc clean, 392/392 unit. Code-review (1 agent, behavior-equivalence focus) → [] no findings (exact equivalence confirmed; no double-injection; services structural typing valid). Smoke `tests/skill-injection-smoke.sh` (passive skill w/ marker → assert marker in /execute output). Local boot clean. Deploying F2 to Mercury.
