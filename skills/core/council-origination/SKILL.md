---
name: council-origination
description: Pipeline marker — the LLM Council originates the base story (premise + relationship arc) at this step. Handled by the council engine, not the AI router; in 'propose' mode it pauses for the author to pick from ranked candidates.
author: BookClaw
version: 1.0.0
triggers:
  - "council origination"
  - "base story council"
  - "ranked base stories"
  - "council selection"
permissions: []
---

# LLM Council — Base Story Origination (pipeline marker)

This is an **engine-handled marker step**, not a generative step routed to the AI
router. When a pipeline (the romance `romance-sweet-full` / `romance-spicy-full`
front half) reaches a step whose skill is `council-origination`, the **council
engine** runs instead of ordinary generation:

1. It generates N candidate **base stories** (premise + relationship arc) from the
   book's seeds, fanning out across models, then an AI **judge** ranks them and
   recommends one.
2. **`councilSelection: 'auto'`** — the step completes with the judge's top pick
   and the pipeline runs straight through with **no pause**.
3. **`councilSelection: 'propose'`** — the project **pauses** (reusing the shipped
   `paused` state + a `Project.selection` marker), surfaces the ranked candidates
   + the AI recommendation in the studio `CouncilSelect` screen, and **resumes**
   from the base story the author picks.

The chosen base story becomes this step's result, which — because the step is
`phase: 'premise'` — is injected into the real Premise step as "Prior Premise
Work" through the existing step-result chaining. No direct generation happens at
this step; its `promptTemplate` is descriptive only (never sent to the router).

Add it as the FIRST step of a romance pipeline:

```json
{ "label": "Council — Base Story Origination", "phase": "premise", "skill": "council-origination", "taskType": "general", "promptTemplate": "…descriptive…" }
```

Notes:

- If no `council-origination` step is present, the pipeline generates the premise
  directly from the seeds as before — this marker is purely additive.
- A council failure (e.g. no parseable candidate) **degrades** to today's
  straight-through generation rather than aborting the run.
- Use it as a **sequential** front step, not inside a `parallel` group.
