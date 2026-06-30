---
name: human-review
description: Pipeline checkpoint — pause the pipeline at this step and wait for a human to approve in the Confirmations screen before continuing to the next step
author: BookClaw
version: 1.0.0
triggers:
  - "human review"
  - "human approval"
  - "pause for review"
  - "review gate"
  - "approval gate"
  - "wait for approval"
permissions: []
---

# Human Review (pipeline gate)

This is a **gate**, not a generative step. When a pipeline reaches a step whose
skill is `human-review`, the pipeline **pauses** and raises a request in the
**Confirmations** screen. The pipeline only advances to the next step once a human
**approves** that request; a **reject** leaves the pipeline paused.

Add it to a pipeline as a checkpoint between phases:

```json
{ "label": "Human review", "skill": "human-review", "taskType": "general", "promptTemplate": "" }
```

Notes:

- If no `human-review` step is present, the pipeline runs uninterrupted to the end
  (or until an error).
- Independently of this gate, **any step error** also raises a Confirmations
  request for human review — approve to retry the failed step, reject to stop.
- Resolution is poll-based: approving/rejecting in the Confirmations screen resumes
  the pipeline within ~a minute (a background sweep resolves decisions + expired
  gates and re-drives generation; with autonomous mode on, the heartbeat continues
  the run).
- Use it as a **sequential** checkpoint (its own step), not as a member of a
  `parallel` group — a gate inside a parallel group can't hold back its in-flight
  siblings.
