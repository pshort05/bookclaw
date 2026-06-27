# Implementation plan: live model picker for claude & gemini

Spec: `docs/superpowers/specs/2026-06-27-anthropic-google-model-picker-design.md`

TDD throughout: write/extend the failing test, then make it pass. Backend is the
contract source and is built first; frontend consumes the locked contract.

## Stage A — backend catalog parsers + routes (TDD)

1. **Tests first.** Add `tests/unit/models-anthropic-parse.test.ts` and
   `tests/unit/models-google-parse.test.ts` (copy the shape of
   `tests/unit/models-openrouter-parse.test.ts`):
   - anthropic: maps `data[].id` + `display_name`; falls back `name=id` when no
     display; sorts by id; drops entries without a string id; `[]` on garbage.
   - google: keeps only `generateContent` entries; strips `models/` prefix to id;
     `name=displayName||id`; sorts; `[]` on garbage.
   - **verify:** `npx tsx --test tests/unit/models-anthropic-parse.test.ts tests/unit/models-google-parse.test.ts` fails (functions don't exist).
2. **Implement** `parseAnthropicModels`, `parseGoogleModels` in
   `gateway/src/api/routes/models.routes.ts`; export them.
   - **verify:** the two unit files pass.
3. **Routes.** Generalize the module cache to per-provider; add
   `/api/models/claude` + `/api/models/gemini` (7-day TTL, vault key, seed
   fallback, fail-soft). Leave `/api/models/openrouter` behaviour unchanged.
   - **verify:** `npx tsc --noEmit` clean; existing openrouter parse test still green.

## Stage B — settings config write (TDD-ish)

4. `settings.routes.ts`: add `ai.claude.model`, `ai.gemini.model` to `safePaths`;
   call `await services.aiRouter.reinitialize()` after persisting any
   `ai.<provider>.model` path.
   - **verify:** `npx tsc --noEmit` clean. (Exercised end-to-end by the smoke test
     in Stage D; a focused settings unit test if one already covers safePaths.)

## Stage C — frontend (typecheck + build verified)

5. Rename `useOpenRouterModels` → `useModelCatalog(provider)` in
   `frontend/studio/src/lib/openrouterModels.ts`; per-provider singleton; fetch
   `/api/models/${provider}` for `{openrouter,claude,gemini}`. Update imports in
   `ModelPicker.tsx`, `PromptRunner.tsx`, `Consistency.tsx`.
6. Broaden the datalist gate to `CATALOG_PROVIDERS` in those three pickers.
7. `Settings.tsx`: editable datalist default-model input for `claude`/`gemini`
   POSTing to `/api/config/update`.
   - **verify:** `npx tsc --noEmit` (studio workspace) clean; `npm run build:frontend`
     succeeds.

## Stage D — smoke test

8. Extend `tests/smoke-test.sh` with a phase: with no provider key set, a valid
   bearer token, `GET /api/models/claude` and `/api/models/gemini` → `200` with a
   non-empty `models` array of `{id,name}`; `401` without a token.
   - **verify:** `npm run test:smoke` passes locally.

## Stage E — review, deploy, verify

9. Code-review workflow (high effort) over the diff; fix all medium+ findings.
10. `commit_message` + touch `build_now`; deploy to Mercury; run smokes against
    `http://192.168.1.32:3847`; fix any errors.
11. Final deploy to Mercury and Neptune (`http://192.168.1.28:3847`, production).

## Files touched

- `gateway/src/api/routes/models.routes.ts` (parsers + 2 routes + per-provider cache)
- `gateway/src/api/routes/settings.routes.ts` (safePaths + reinitialize)
- `frontend/studio/src/lib/openrouterModels.ts` (hook rename/generalize)
- `frontend/studio/src/components/asset/ModelPicker.tsx`
- `frontend/studio/src/routes/PromptRunner.tsx`
- `frontend/studio/src/routes/Consistency.tsx`
- `frontend/studio/src/routes/Settings.tsx`
- `tests/unit/models-anthropic-parse.test.ts` (new)
- `tests/unit/models-google-parse.test.ts` (new)
- `tests/smoke-test.sh` (new phase)
