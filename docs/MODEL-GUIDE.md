# Choosing models — a practical guide

BookClaw routes every AI call to one of six **providers**, and within a provider you can pin a specific **model**. This guide explains what each provider and model is good at, and which to use for each kind of writing task. It is opinionated and cost-aware: the goal is good output at a sensible price, not the most expensive model on every step.

> **The short version:** let the automatic tier routing handle most steps; pin a **cheap, large-context model** (Haiku 4.5 or Gemini Flash) for high-volume mechanical passes like the **consistency audit**; reserve a **premium reasoning model** (Opus 4.8 / GPT) for the final polish. See [Recommendations by task](#recommendations-by-task).

## How BookClaw chooses a model

Each task has a `taskType` (e.g. `creative_writing`, `consistency`, `final_edit`). BookClaw maps that to a **tier** — `free`, `mid`, or `premium` — and each tier has an ordered list of providers it tries (first configured one wins). So with no configuration, a drafting step routes to the `mid` tier and a final-polish step to `premium`, automatically.

You can override that automatic choice at three levels, in increasing specificity:

1. **Project preferred provider** — a soft default for a whole run.
2. **Per-step / per-phase override** — pin a provider, model, and temperature on an individual pipeline step or skill phase, in the **Pipeline Editor** / **Skill Editor** (Asset Studio). See [Pipelines and sequences](./features/pipelines-and-sequences.md).
3. **Per-run / per-book overrides** for specific engines — the **Consistency Auditor** remembers a per-book model and accepts a per-run override; the **Prompt Runner** picks a model per run.

**Resolution order for any call:** per-step override → project preferred provider → tier routing (from the step's `taskType`). When a pinned provider has no API key configured, BookClaw warns and falls back to tier routing rather than failing.

A model override is `{ provider, model?, temperature? }` — any field is optional. Pick a provider and BookClaw uses that provider's configured default model unless you also name an exact model; set a temperature alone to keep automatic model routing but change creativity.

## The providers at a glance

| Provider | BookClaw tier | Default model | Relative cost | Best for |
|---|---|---|---|---|
| **Ollama** (local) | free | `llama3.2` | Free (your hardware) | Private/offline drafts, experiments, zero-cost bulk work where quality is secondary |
| **Google Gemini** | free | `gemini-2.5-flash` | Free tier / very low | Fast, large-context bulk work — research, long-document passes, cheap consistency scans |
| **DeepSeek** | cheap | `deepseek-chat` | Low | Cost-effective drafting and reasoning (`deepseek-reasoner` for harder reasoning) |
| **Anthropic Claude** | premium | `claude-sonnet-4-5` | Mid–premium (varies by model) | Highest craft quality; Haiku for cheap high-volume checks, Opus for the hardest reasoning |
| **OpenAI GPT** | premium | `gpt-4o` | Premium | Strong general-purpose reasoning and instruction-following |
| **OpenRouter** | cheap (ranked behind dedicated providers) | `anthropic/claude-sonnet-4-5` | Depends on the model you pick | Reaching any model not wired as a first-class provider; A/B-ing models without new keys |

The "default model" column is what BookClaw uses when you select a provider without naming an exact model — change it in `config/user.json` or pin a specific model per step. OpenRouter is ranked behind the dedicated providers in tier routing because its price depends entirely on the model you choose; if you want it as primary, set it as the project preferred provider.

> **A note on pricing.** Exact prices change often. The Claude figures below are point-in-time references; treat every number as "check the provider's current pricing page." For Gemini, DeepSeek, OpenAI, and OpenRouter, confirm current rates with the provider — BookClaw's per-run cost estimates (shown after a run) are the most reliable read on what a given model actually costs you.

## The Claude family in detail

Claude models span a wide cost/quality range, which is why model choice matters most here. Approximate reference figures (per 1M tokens, input / output; verify current pricing):

| Model | Pin as | Context | Input / Output | Character |
|---|---|---|---|---|
| **Claude Opus 4.8** | `claude-opus-4-8` | 1M | ~$5 / ~$25 | Most capable Opus tier — best long-horizon reasoning, structure, and craft. Use where quality dominates cost. |
| **Claude Sonnet 4.6** | `claude-sonnet-4-6` | 1M | ~$3 / ~$15 | Best balance of speed, intelligence, and price — a strong default for drafting and revision. |
| **Claude Haiku 4.5** | `claude-haiku-4-5` | 200K | ~$1 / ~$5 | Fastest and cheapest Claude. 200K context is plenty for per-chapter work. The value pick for high-volume passes. |
| **Claude Fable 5** | `claude-fable-5` | 1M | ~$10 / ~$50 | Anthropic's most capable widely-released model, for the most demanding reasoning. Premium of premiums — reserve for genuinely hard work. |

(BookClaw's `claude` provider ships with a Sonnet default; pin Haiku, Opus, or Fable explicitly via the model picker when a step warrants it. Older Opus 4.7 / 4.6 IDs also work if you prefer them.)

**Pros:** the strongest prose craft, voice consistency, and instruction-following of the providers here; large context windows (1M on Opus/Sonnet/Fable) hold a whole manuscript; predictable, published pricing.
**Cons:** premium tier on a per-token basis — running Opus or Fable across a whole book, or per-chapter on a long manuscript, adds up fast. This is exactly why per-step model selection exists.

## The other providers

**Google Gemini** — `gemini-2.5-flash` is fast, has a large context window, and a generous free tier, which makes it excellent for **bulk, mechanical, or research-heavy** work: web research, long-document analysis, and cheap consistency scans. It is BookClaw's first choice in both the `free` and `mid` tiers. Pros: speed, context, cost. Cons: prose craft and voice fidelity generally trail the top Claude/GPT tiers for finished narrative.

**DeepSeek** — `deepseek-chat` is a low-cost generalist; `deepseek-reasoner` swaps in a reasoning-tuned model when a task needs deeper thinking (BookClaw maps high-reasoning tasks to it automatically). Pros: strong value, capable reasoning. Cons: less consistent prose voice than premium tiers; provider availability/latency can vary.

**OpenAI GPT** — `gpt-4o` is a premium general-purpose model with strong reasoning and instruction-following. Pros: reliable, well-rounded, good at structured tasks. Cons: premium pricing; house style differs from Claude's prose — worth A/B-ing on your own voice.

**Ollama (local)** — runs a local model (`llama3.2` by default) on your own hardware. Pros: free, private, offline, no rate limits. Cons: quality well below the hosted premium tiers; speed depends on your machine. Best for private experiments, throwaway drafts, or zero-cost bulk steps where craft is not the point.

**OpenRouter** — a gateway to hundreds of models behind one key. Pros: try any model (including ones BookClaw doesn't wire as a first-class provider) without adding new credentials; ideal for A/B comparisons; the model picker offers its full catalog as a searchable list. Cons: pricing is per-model and opaque until you pick one — confirm the rate for the exact model before relying on it.

## Recommendations by task

These pair BookClaw's task types with a sensible model. "Auto" means the default tier routing is already a good fit; the others are where pinning a model pays off.

| Task | Recommended | Why |
|---|---|---|
| **Consistency audit** | **Haiku 4.5** (or Gemini Flash) | The audit makes **one AI call per chapter**, so cost scales with book length. The checks are largely mechanical (extract facts, compare deterministically), so they don't need frontier reasoning — a cheap, large-context model is the sweet spot. *Owner's finding: Haiku is the best value here.* Haiku's 200K context comfortably holds a chapter plus canon. |
| **Research / fact-finding** | Gemini Flash (auto, free tier) | High volume, web-heavy, low craft requirement. The free tier keeps it cheap. |
| **Drafting prose** (`creative_writing`) | Sonnet 4.6 (auto, mid) | The best balance of voice quality and cost for the highest-volume creative step. Step up to Opus for a showcase chapter; drop to DeepSeek/Gemini to draft cheaply and polish later. |
| **Outline / story bible** | Sonnet 4.6 (auto, mid) | Structure benefits from strong reasoning but these are length-heavy; Sonnet's 1M context and balance fit well. |
| **Revision / line edit** | Sonnet 4.6 → Opus 4.8 for the last pass | Iterate cheaply, then run the final polish on the strongest model. |
| **Final edit / polish** (`final_edit`) | **Opus 4.8** (auto, premium) | Low volume, high stakes — this is where premium reasoning earns its price. Fable 5 for an exceptionally demanding manuscript. |
| **Marketing copy / blurbs** | Gemini or DeepSeek (auto, free/cheap) | Short, lots of variants; cost matters more than craft ceiling. |
| **Private / offline work** | Ollama | Keep the manuscript on your own hardware; accept lower quality. |

### The cost pattern that matters most

For anything that runs **per chapter across a whole book** — the consistency audit above all — the model choice multiplies by chapter count. A full-book audit with a premium model can cost several dollars; the same audit on Haiku or Gemini Flash is a fraction of that, with results that are good enough because the heavy lifting is deterministic code, not the model. **Cheap model for the wide passes, premium model for the narrow final ones** is the single most useful rule here.

A complementary pattern for drafting: **draft cheap, edit premium.** Generate chapters on a low-cost model (DeepSeek, Gemini, or Haiku), then run the revision and final-edit passes on Sonnet or Opus. You pay the premium rate only on the words that survive.

## How to apply a choice

- **A pipeline step:** open the **Pipeline Editor** (Asset Studio), pick the step, set provider + model + temperature. Leave it on "auto" to use tier routing.
- **A skill phase:** open the **Skill Editor**; each executable phase has the same picker (skills are multi-provider — a phase can run on any provider, defaulting to OpenRouter).
- **The consistency audit:** set a per-book model in the Consistency panel (it persists), or override it per run. See [Continuity and consistency](./features/continuity-and-consistency.md).
- **A one-off prompt:** the **Prompt Runner** picks a provider + model per run and reports the actual cost afterward.

When in doubt, run a step both ways and compare the output and the reported cost — BookClaw shows tokens, speed, and an estimated cost after each run, which is the most honest guide to what a model is worth for your work.
