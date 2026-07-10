# Romance Adaptive Interview — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sub-project 4 of the Romance Workflow — an AI-led **conversational interview** that draws a romance story out of the author one turn at a time and converges on the *same* shared seed contract the Guided flow produces, then creates the book on `romance-{sweet,spicy}-full`. This is the largest UI piece; the backend is deliberately tiny (one stateless per-turn service + one endpoint).

**Architecture:** A new **stateless-per-turn** design. A backend `RomanceInterviewService` (injected `aiComplete`/`aiSelectProvider`, exactly like `PremiseIntakeService`) exposes `turn(messages) → { reply, done, seeds? }`: one structured-output AI call per turn returns the next question, or — when it has gathered enough — `done:true` plus the structured seed contract. A new endpoint `POST /api/romance/interview` wires the real `services.aiRouter` and returns that shape. **The server holds no conversational state** — the studio client holds the `messages` array (like a chat) and posts the whole array each turn. A studio screen `AdaptiveInterview.tsx` renders a chat transcript, drives the endpoint turn-by-turn, and on `done` shows an editable seed-review gate (reusing `PremiseIntake`'s review patterns + `FormatPicker`) then POSTs the finalized seeds to the existing `POST /api/books`.

**Why a new endpoint, not the existing chat.** The gateway's chat infra (`conversationHistories` in `gateway/src/index.ts`, keyed by channel; the `editor_chat` taskType) is *server-stateful*, injects the SOUL/persona and the global active-book pointer, and returns free-form prose — none of which fits a structured seed-convergence task. Reusing it would entangle the interview with channel-history persistence, soul injection, and the free-chat book pointer, and it would not yield the `{ reply, done, seeds? }` structured contract. A dedicated stateless per-turn service mirrors `PremiseIntakeService` exactly (injected AI for deterministic tests, JSON-extraction/defaulting discipline), keeps state on the client (simplest), and produces the contract directly. **Decision: new endpoint.** (The `editor_chat` *taskType* is still reused for routing — it is the right conversational tier — but none of the chat *plumbing* is.)

**Tech Stack:** Node 22 + TypeScript (`--import tsx`, NodeNext `.js` imports), Express route in `gateway/src/api/routes/books.routes.ts` (same module that already hosts the sibling romance `POST /api/books/intake`), the shipped AI router (`services.aiRouter.complete` / `.selectProvider`), React studio in `frontend/studio/`, vendored MCP server in `mcp/`. Unit tests: `node --import tsx --test tests/unit/*.test.ts` (inject AI — canned turns). Smoke tests: bash under `tests/`. Studio verification: a committed bundle-grep test.

## Global Constraints

- **Imports use `.js` extensions** even in `.ts` source (NodeNext). Match existing files.
- **Fail-soft posture:** log `⚠`/`ℹ` and continue degraded; never crash the gateway. A **malformed AI turn must degrade gracefully** — keep the conversation alive (return the raw text as the next question, `done:false`), never throw out of `turn()` on unparseable output.
- **Shared seed contract (decision 6):** the interview converges on exactly `{ heat:'sweet'|'spicy', storyArc, characters, setting, chapterCount, wordsPerChapter, councilSelection:'auto'|'propose' }`. **No `blueprint`** — that field is premise-file-only; do not add it here.
- **Seed field is `setting`, never `world`** (place/sensory texture; distinct from the World Repository `world` bind).
- **Validated format path:** send `chapterCount`/`wordsPerChapter` to `/api/books` only as part of a full `structure`+`form`+`chapterCount`+`wordsPerChapter` set (bare counts → `400`). The review gate reuses `FormatPicker` so the author supplies structure+form; the interview's counts pre-fill it.
- **MCP lockstep:** the new `/api/romance/interview` endpoint is surfaced through MCP in the **same commit** as the gateway route (Task 3).
- **No `git push`.** Per repo workflow the maintainer commits via `./push.sh` + a `commit_message` file. "Commit" steps here mean staging a local git commit for review during subagent-driven execution; the final push is the maintainer's.
- **`npx tsc --noEmit` must be clean** after every task.

**Reference spec:** `docs/superpowers/specs/2026-07-08-romance-workflow-design.md` (decision 6 = the shared seed contract; sub-project 4 row). **Reference plan (format model):** `docs/superpowers/plans/2026-07-09-romance-premise-file-intake.md`. **Reference code:** `gateway/src/services/premise-intake.ts` (injected-AI service + `extractJson`/`str`/`num`), `frontend/studio/src/routes/PremiseIntake.tsx` (review-gate patterns), `frontend/studio/src/components/newbook/FormatPicker.tsx`, `frontend/studio/src/routes/NewHub.tsx:21` (the `soon:true` Adaptive card), `gateway/src/api/routes/books.routes.ts:75-96` (sibling `/api/books/intake` route as the wiring template), `tests/romance-premise-intake-smoke.sh`, `tests/unit/premise-intake-bundle.test.ts`.

---

### Task 1: `RomanceInterviewService.turn()` — messages → `{ reply, done, seeds? }`

The whole backend brain: one structured-output AI call maps the conversation-so-far to the next question, or to `done` + the seed contract. AI is injected (like `PremiseIntakeService`) so the test is deterministic. Fail-soft: unparseable output keeps the conversation alive rather than throwing.

**Files:**
- Create: `gateway/src/services/romance-interview.ts`
- Test: `tests/unit/romance-interview.test.ts`

**Interfaces:**

```ts
export interface InterviewSeeds {
  heat: 'sweet' | 'spicy';
  storyArc: string;
  characters: string;
  setting: string;
  chapterCount: number;
  wordsPerChapter: number;
  councilSelection: 'auto' | 'propose';
}
export interface TurnMessage { role: 'user' | 'assistant'; content: string; }
export interface TurnResult { reply: string; done: boolean; seeds?: InterviewSeeds; }

// Injected dependencies — identical shapes to premise-intake.ts (decoupled from router internals):
export type AiComplete = (req: { provider: string; system: string; messages: Array<{ role: 'user' | 'assistant'; content: string }>; maxTokens?: number; thinking?: 'low' | 'medium' | 'high' }) => Promise<{ text: string }>;
export type AiSelectProvider = (taskType: string) => { id: string };

export class RomanceInterviewService {
  constructor(aiComplete: AiComplete, aiSelectProvider: AiSelectProvider);
  turn(messages: TurnMessage[]): Promise<TurnResult>;
}
```

- [ ] **Step 1: Write the failing test**

`tests/unit/romance-interview.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RomanceInterviewService } from '../../gateway/src/services/romance-interview.js';

const ASK = JSON.stringify({ reply: "Who are your two leads, and what keeps pulling them together?", done: false });
const DONE = JSON.stringify({
  reply: 'Perfect — I have everything I need to build your story.',
  done: true,
  seeds: { heat: 'spicy', storyArc: 'Rival bakers, enemies to lovers', characters: 'Gia; Cole', setting: 'Long Beach Island, NJ — a boardwalk bakery', chapterCount: 36, wordsPerChapter: 2800, councilSelection: 'propose' },
});

test('turn returns the next question when not done', async () => {
  const svc = new RomanceInterviewService(async () => ({ text: ASK }), () => ({ id: 'gemini' }));
  const out = await svc.turn([{ role: 'user', content: 'A grumpy-sunshine bakery romance.' }]);
  assert.equal(out.done, false);
  assert.match(out.reply, /two leads/);
  assert.equal(out.seeds, undefined);
});

test('turn returns the full seed contract when done', async () => {
  const svc = new RomanceInterviewService(async () => ({ text: DONE }), () => ({ id: 'gemini' }));
  const out = await svc.turn([{ role: 'user', content: '...' }]);
  assert.equal(out.done, true);
  assert.equal(out.seeds?.heat, 'spicy');
  assert.equal(out.seeds?.chapterCount, 36);
  assert.equal(out.seeds?.councilSelection, 'propose');
  assert.equal(out.seeds?.setting, 'Long Beach Island, NJ — a boardwalk bakery');
});

test('done turn defaults missing seed fields', async () => {
  const thin = JSON.stringify({ reply: 'done', done: true, seeds: { storyArc: 'x' } });
  const svc = new RomanceInterviewService(async () => ({ text: thin }), () => ({ id: 'gemini' }));
  const out = await svc.turn([]);
  assert.equal(out.seeds?.heat, 'sweet');            // default
  assert.equal(out.seeds?.characters, '');           // missing -> empty string
  assert.equal(out.seeds?.chapterCount, 40);         // default
  assert.equal(out.seeds?.wordsPerChapter, 2500);    // default
  assert.equal(out.seeds?.councilSelection, 'auto'); // default
});

test('turn tolerates fenced JSON', async () => {
  const svc = new RomanceInterviewService(async () => ({ text: 'Sure!\n```json\n{"reply":"Q?","done":false}\n```' }), () => ({ id: 'gemini' }));
  const out = await svc.turn([]);
  assert.equal(out.reply, 'Q?');
  assert.equal(out.done, false);
});

test('malformed turn degrades gracefully — no throw, conversation continues', async () => {
  const svc = new RomanceInterviewService(async () => ({ text: 'no json, just prose asking a question' }), () => ({ id: 'gemini' }));
  const out = await svc.turn([{ role: 'user', content: 'hi' }]);
  assert.equal(out.done, false);
  assert.match(out.reply, /prose asking a question/);
  assert.equal(out.seeds, undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/romance-interview.test.ts`
Expected: FAIL — module `romance-interview.js` not found.

- [ ] **Step 3: Implement `turn()`**

`gateway/src/services/romance-interview.ts` (types from the Interfaces block, plus):

```ts
const INTERVIEW_SYSTEM = `You are a warm, perceptive romance-writing interviewer. Through a natural back-and-forth, draw out the story the author wants to write until you can confidently fill EVERY field of this seed contract:
- heat: 'sweet' (closed-door / fade-to-black) or 'spicy' (open-door / explicit)
- storyArc: the central couple, the core romantic conflict, the tropes, the HEA/HFN promise
- characters: the two leads plus key supporting cast
- setting: place, time and sensory texture (real-world grounded — locations, buildings, seasons)
- chapterCount: a number
- wordsPerChapter: a number
- councilSelection: 'auto' (let the AI pick the single best base story) or 'propose' (show ranked options to choose from)

Rules:
- Ask ONE focused question per turn. Build on what the author has already said; never re-ask something they answered.
- Preserve the author's own words and canon — you are drawing the story out, not inventing it.
- When (and ONLY when) you can confidently fill all seven fields, set done=true and return the full seeds. Until then done=false and omit seeds.
Output ONE JSON object and nothing else:
{"reply":"<your next question OR a short closing confirmation>","done":<true|false>,"seeds":{"heat","storyArc","characters","setting","chapterCount","wordsPerChapter","councilSelection"} | null}`;

// Non-throwing JSON extraction — a malformed turn must NOT abort the interview.
function tryExtractJson(text: string): any {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  const raw = fenced ? fenced[1] : (start >= 0 && end > start ? text.slice(start, end + 1) : '');
  if (!raw.trim()) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export class RomanceInterviewService {
  constructor(private aiComplete: AiComplete, private aiSelectProvider: AiSelectProvider) {}

  async turn(messages: TurnMessage[]): Promise<TurnResult> {
    // Client holds the transcript; on the opening turn there is nothing yet, so seed a kickoff
    // user turn (some providers reject an all-system message list).
    const convo: TurnMessage[] = messages.length
      ? messages
      : [{ role: 'user', content: 'Let us begin. Ask your first question to start drawing out my romance story.' }];

    const provider = this.aiSelectProvider('editor_chat').id;
    const { text } = await this.aiComplete({ provider, system: INTERVIEW_SYSTEM, messages: convo, maxTokens: 4000, thinking: 'low' });

    const j = tryExtractJson(text);
    if (!j || typeof j !== 'object') {
      // Graceful degradation: no parseable JSON — surface the model's prose as the next
      // question so the interview keeps moving instead of dead-ending.
      return { reply: text.trim() || 'Tell me more about the story you want to write.', done: false };
    }

    const done = j.done === true;
    const reply = str(j.reply) || (done ? 'Great — I have everything I need to build your story.' : 'Tell me more.');
    if (!done) return { reply, done: false };

    const s = j.seeds ?? {};
    const seeds: InterviewSeeds = {
      heat: s.heat === 'spicy' ? 'spicy' : 'sweet',
      storyArc: str(s.storyArc),
      characters: str(s.characters),
      setting: str(s.setting),
      chapterCount: num(s.chapterCount, 40),
      wordsPerChapter: num(s.wordsPerChapter, 2500),
      councilSelection: s.councilSelection === 'propose' ? 'propose' : 'auto',
    };
    return { reply, done: true, seeds };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/unit/romance-interview.test.ts`
Expected: PASS (5 tests). Then `npx tsc --noEmit` → no errors.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/services/romance-interview.ts tests/unit/romance-interview.test.ts
git commit -m "feat(romance): RomanceInterviewService.turn — stateless per-turn seed-collection"
```

---

### Task 2: `POST /api/romance/interview` endpoint

Wires `turn()` behind one bearer-gated endpoint using the real `services.aiRouter`, mirroring the sibling `/api/books/intake` wiring (`books.routes.ts:75-96`). Stateless: the client sends the whole `messages` array; the server processes one turn.

**Files:**
- Modify: `gateway/src/api/routes/books.routes.ts` (add the route + import the service)
- Create: `tests/romance-adaptive-smoke.sh`
- Modify: `package.json` (add `test:adaptive-smoke` script alongside the other smokes) *(fold into this task; no separate commit)*

**Interfaces:**
- Consumes: `RomanceInterviewService` (Task 1), `services.aiRouter.complete`, `services.aiRouter.selectProvider`.
- Produces: `POST /api/romance/interview` body `{ messages: TurnMessage[] }` → `200 { reply, done, seeds? }`; `400` on a missing/invalid `messages` array or an oversized conversation; `500 { error }` on AI failure (fail-soft, logged).

- [ ] **Step 1: Write the failing smoke test**

`tests/romance-adaptive-smoke.sh` — model on `tests/romance-premise-intake-smoke.sh` (boot own gateway, loopback, token via env, non-default port; hard input gates always run; the AI happy-path is gated on provider availability, treating `500` as SKIP). Use `PORT=3880`, `TOKEN=romance-adaptive-smoke-token`. Core assertions:

```bash
H=(-H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json')

# (a) empty body {} (no messages array) -> 400
CODE=$(curl -s -o /dev/null -w '%{http_code}' "${H[@]}" -X POST "$BASE/api/romance/interview" --data '{}')
[[ "$CODE" == "400" ]] && echo "PASS: no messages -> 400" || { echo "FAIL: no messages not 400 (got $CODE)"; FAILED=1; }

# (b) messages not an array -> 400
CODE=$(curl -s -o /dev/null -w '%{http_code}' "${H[@]}" -X POST "$BASE/api/romance/interview" --data '{"messages":"nope"}')
[[ "$CODE" == "400" ]] && echo "PASS: bad messages -> 400" || { echo "FAIL: bad messages not 400 (got $CODE)"; FAILED=1; }

# (c)+AI happy-path: a valid turn. Route-mounted is a hard gate; the reply is asserted
# only when an AI provider actually ran (200). No provider in this dev env -> 500 -> SKIP.
VALID='{"messages":[{"role":"user","content":"A grumpy-sunshine bakery romance on Long Beach Island, NJ."}]}'
RESP=$(curl -s -w '\n%{http_code}' "${H[@]}" -X POST "$BASE/api/romance/interview" --data "$VALID")
BODY=$(echo "$RESP" | sed '$d'); CODE=$(echo "$RESP" | tail -n1)
if [[ "$CODE" == "404" ]]; then echo "FAIL: route not mounted (404)"; FAILED=1
elif [[ "$CODE" == "200" ]]; then
  echo "$BODY" | grep -q '"reply"' && echo "PASS: turn returns a reply" || { echo "FAIL: 200 without reply"; FAILED=1; }
elif [[ "$CODE" == "500" ]]; then
  echo "PASS: route mounted (500 without 404)"; echo "SKIP: no AI provider configured — happy-path deferred to a provisioned deploy (Mercury)"
else echo "FAIL: unexpected status (got $CODE)"; FAILED=1; fi
```

- [ ] **Step 2: Run smoke to verify it fails**

Run: `bash tests/romance-adaptive-smoke.sh`
Expected: FAIL — route 404s (no `/api/romance/interview`).

- [ ] **Step 3: Implement the route**

In `gateway/src/api/routes/books.routes.ts`, add the import near the existing `PremiseIntakeService` import (line 17):

```ts
import { RomanceInterviewService } from '../../services/romance-interview.js';
```

And add the route next to `POST /api/books/intake` (after line 96):

```ts
  // Romance Adaptive Interview (sub-project 4): one conversational turn. STATELESS —
  // the client holds the transcript and posts the whole messages[] each turn; the
  // server runs a single structured-output AI call and returns { reply, done, seeds? }.
  app.post('/api/romance/interview', async (req: Request, res: Response) => {
    const raw = Array.isArray(req.body?.messages) ? req.body.messages : null;
    if (!raw) return res.status(400).json({ error: 'messages array is required' });
    const messages = raw
      .filter((m: any) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .map((m: any) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
    const total = messages.reduce((n: number, m: { content: string }) => n + m.content.length, 0);
    if (total > 200_000) return res.status(400).json({ error: 'conversation is too large (200k char limit)' });
    try {
      const svc = new RomanceInterviewService(
        (r) => services.aiRouter.complete(r as any),
        (t) => services.aiRouter.selectProvider(t),
      );
      const result = await svc.turn(messages);
      res.json(result);
    } catch (err: any) {
      console.log(`  ⚠ romance interview turn failed: ${err?.message ?? err}`);
      res.status(500).json({ error: 'Interview turn failed' });
    }
  });
```

Add to `package.json` scripts, alongside `test:intake-smoke`: `"test:adaptive-smoke": "bash tests/romance-adaptive-smoke.sh"`.

- [ ] **Step 4: Run smoke to verify it passes**

Run: `bash tests/romance-adaptive-smoke.sh -v`
Expected: PASS (input gates hard-pass; the happy-path asserts `reply` when a provider is configured, else SKIPs on `500`). Then `npx tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/api/routes/books.routes.ts tests/romance-adaptive-smoke.sh package.json
git commit -m "feat(romance): POST /api/romance/interview — stateless conversational seed-collection turn"
```

---

### Task 3: MCP lockstep — `romance_interview` tool

Surface the new endpoint through the vendored MCP server in the same commit as the route (repo convention). Model the registration on the existing `premise_intake` tool.

**Files:**
- Modify: `mcp/src/tools/books.ts` (register `romance_interview`; confirm the exact file — grep `premise_intake` under `mcp/src/tools/` and register alongside it)
- Test: `cd mcp && npm run build && npm test`

**Interfaces:**
- Consumes: `POST /api/romance/interview` (Task 2).

- [ ] **Step 1: Register the `romance_interview` tool**

In the same file that registers `premise_intake`, add (matching that tool's `registerTool` + `client.request` pattern):

```ts
  server.registerTool('romance_interview',
    { description: 'Run one turn of the romance Adaptive Interview: given the conversation so far, returns the AI\'s next question, or when enough is gathered, done=true plus the structured romance seed contract. Stateless — hold the messages array client-side and pass it back each turn.',
      inputSchema: { messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() })).describe('The conversation so far (empty for the opening turn)') } },
    async (args) => toToolResult('romance_interview', await client.request('POST', '/api/romance/interview', args)),
  );
```

- [ ] **Step 2: Build + test the MCP package**

Run: `cd mcp && npm install && npm run build && npm test`
Expected: build succeeds; tests pass.

- [ ] **Step 3: Commit**

```bash
git add mcp/src/tools/books.ts
git commit -m "feat(mcp): romance_interview tool (lockstep with /api/romance/interview)"
```

---

### Task 4: Studio `AdaptiveInterview.tsx` — chat + review gate + create (the largest piece)

The UI: a chat transcript that drives the interview turn-by-turn; when the turn returns `done`, flip to an editable seed-review gate (reusing `PremiseIntake`'s patterns + `FormatPicker` for the validated length path), then POST the finalized seeds to `/api/books` on `romance-{heat}-full`. Wire the route and flip the NewHub "Adaptive" card live.

**Files:**
- Create: `frontend/studio/src/routes/AdaptiveInterview.tsx`
- Create: `frontend/studio/src/routes/AdaptiveInterview.module.css` (mirror `PremiseIntake.module.css`; add a chat-transcript block — `.transcript`, `.bubbleUser`, `.bubbleAssistant`, `.composer`)
- Modify: `frontend/studio/src/main.tsx` (import + `<Route path="adaptive" element={<AdaptiveInterview />} />`)
- Modify: `frontend/studio/src/routes/NewHub.tsx:21` (Adaptive card: replace `soon: true` with `to: '/adaptive'`)
- Test: `tests/unit/adaptive-interview-bundle.test.ts` (new bundle-grep)

**Interfaces:**
- Consumes: `POST /api/romance/interview` → `{ reply, done, seeds? }`; `GET /api/library/{author,voice,genre}`, `GET /api/structures`, `GET /api/forms` (as `NewBook`/`PremiseIntake` do); `POST /api/books` with `{ title, author, voice, genre, pipelineSequence:[heat==='spicy'?'romance-spicy-full':'romance-sweet-full'], storyArc, characters, setting, councilSelection, structure, form, chapterCount, wordsPerChapter }`.

- [ ] **Step 1: Build the chat stage (transcript + turn loop)**

Create `frontend/studio/src/routes/AdaptiveInterview.tsx`. Follow the auth-fetch (`api`), `useStore`, and library-loading patterns already in `PremiseIntake.tsx`. Chat-stage behavior:
- State: `messages: {role,'user'|'assistant'; content}[]`, `pending: boolean`, `input: string`, `error: string|null`, plus `seeds: InterviewSeeds|null` (set when a turn returns `done`).
- On mount, fire the opening turn: `POST /api/romance/interview` with `{ messages: [] }`; append the returned `reply` as an assistant bubble.
- Composer: a textarea + Send. On send, append `{role:'user',content:input}`, clear input, `POST { messages }` (the freshly-updated array), then append the assistant `reply`. If the response `done`, store `seeds` (→ review stage) — still show the closing `reply` bubble.
- Render the transcript as user/assistant bubbles; disable the composer while `pending`; show `error` inline on failure (leave the transcript intact so the author can retry).

Sketch:

```tsx
const send = async (userText: string) => {
  const next = userText ? [...messages, { role: 'user' as const, content: userText }] : messages;
  setMessages(next); setInput(''); setPending(true); setError(null);
  try {
    const r = await api<TurnResult>('/api/romance/interview', { method: 'POST', body: JSON.stringify({ messages: next }) });
    setMessages((m) => [...m, { role: 'assistant', content: r.reply }]);
    if (r.done && r.seeds) { setSeeds(r.seeds); setFormat((f) => ({ ...f, chapterCount: r.seeds!.chapterCount, wordsPerChapter: r.seeds!.wordsPerChapter })); }
  } catch (e) { setError(String(e)); } finally { setPending(false); }
};
useEffect(() => { void send(''); /* opening turn */ }, []); // eslint-disable-line react-hooks/exhaustive-deps
```

- [ ] **Step 2: Build the review stage (editable seeds + FormatPicker + council)**

When `seeds` is set, render the review gate (reuse `PremiseIntake`'s editable-field pattern and `.module.css` classes):
- Editable textareas for `storyArc`, `characters`, `setting` bound to `seeds` (via an `editSeed` helper like `PremiseIntake`'s).
- A sweet/spicy heat toggle bound to `seeds.heat` (mirror `PremiseIntake`'s toggle).
- A council toggle bound to `seeds.councilSelection`: "Auto-Select Best Story" (`auto`) / "Propose Top Ideas" (`propose`).
- `FormatPicker` (import from `../components/newbook/FormatPicker.js`) bound to a `format: FormatValue` state pre-filled with the interview's `chapterCount`/`wordsPerChapter` (Step 1). Load `structures`/`forms` from `/api/structures` + `/api/forms` as `NewBook` does. This is the **validated path** — the author picks a structure + form so the counts post as a full format set.
- Book identity: `title` (required), `author`/`voice`/`genre` selects defaulting to `entries[0]` (genre defaulting to `romance`), exactly as `PremiseIntake` does.

- [ ] **Step 3: Finalize + create**

- Compute `fmtFit = formatFit(format, forms)`; gate creation on `!!(seeds && title.trim() && author && voice) && fmtFit.ok && !creating`.
- On "Start Book", `POST /api/books`:

```tsx
await api<{ book: BookManifest }>('/api/books', { method: 'POST', body: JSON.stringify({
  title: title.trim(), author, voice, genre: genre || null,
  pipelineSequence: [seeds.heat === 'spicy' ? 'romance-spicy-full' : 'romance-sweet-full'],
  storyArc: seeds.storyArc, characters: seeds.characters, setting: seeds.setting,
  councilSelection: seeds.councilSelection,
  structure: format.structure,
  ...(format.structure === 'custom' ? { customStructure: parseCustomStructure(format.customStructureText) } : {}),
  form: format.form, chapterCount: format.chapterCount, wordsPerChapter: format.wordsPerChapter,
}) });
await loadBooks(); navigate('/');
```

(Send the format set only when `fmtFit.active`; since creation is gated on `fmtFit.ok`, it will always be active here — but guard defensively as `NewBook` does.)

- [ ] **Step 4: Wire the route + flip the NewHub card live**

- `frontend/studio/src/main.tsx`: add `import { AdaptiveInterview } from './routes/AdaptiveInterview.js';` and `<Route path="adaptive" element={<AdaptiveInterview />} />` (next to the `premise` route, line 36).
- `frontend/studio/src/routes/NewHub.tsx`: the Adaptive card (line 21) — replace `soon: true` with `to: '/adaptive'`. Leave its `icon`/`title`/`tag` unchanged.

- [ ] **Step 5: Write the bundle-grep test**

`tests/unit/adaptive-interview-bundle.test.ts` — copy `tests/unit/premise-intake-bundle.test.ts` and swap the markers. Assert the built studio JS bundle carries:

```ts
assert.ok(js.includes('/api/romance/interview'), 'interview endpoint path must ship in the bundle');
assert.ok(js.includes('/adaptive'), 'NewHub Adaptive card must route to /adaptive');
assert.ok(js.includes('Auto-Select Best Story'), 'council toggle label must ship in the bundle');
```

(Pick markers that are literal strings in the source so Vite preserves them — the endpoint path, the route, and a council-toggle label are all stable.)

- [ ] **Step 6: Build + verify**

Run: `npm run build:frontend` then `node --import tsx --test tests/unit/adaptive-interview-bundle.test.ts tests/unit/studio-build.test.ts`
Expected: build succeeds; both assertions pass. Then `npx tsc --noEmit`.

Manual verification (record result): start the gateway with a provider configured, open the studio, **New ▸ Advanced ▸ Adaptive**. Confirm: the interview opens with a first question; each answer produces the next question; after enough turns the closing turn flips to the review gate with the seeds pre-filled; the heat/council toggles + FormatPicker work; "Start Book" stays disabled until title/author/voice + a valid structure+form are set; creating lands a `romance-{heat}-full` project whose premise/bible/outline prompts weave the interview seeds.

- [ ] **Step 7: Commit**

```bash
git add frontend/studio/src/routes/AdaptiveInterview.tsx frontend/studio/src/routes/AdaptiveInterview.module.css frontend/studio/src/main.tsx frontend/studio/src/routes/NewHub.tsx tests/unit/adaptive-interview-bundle.test.ts
git commit -m "feat(studio): Adaptive interview screen (conversational seed-collection) + NewHub card live"
```

---

## Feature tracking

- [ ] Before starting, note in `docs/TODO.md` that **Sub-project 4 — Adaptive interview** (already listed under "Romance Workflow", line ~178) is in progress. On completion (Task 4 lands), move that bullet from `docs/TODO.md` to `docs/COMPLETED.md` with the `2026-07-10` completion date, preserving the original text and adding a one-line summary of what shipped (the `RomanceInterviewService` + `/api/romance/interview` endpoint + the `AdaptiveInterview` studio screen + MCP `romance_interview` tool). Per repo CLAUDE.md feature-tracking rule — remove it from `TODO.md` in the same edit. This also completes the Romance Workflow decomposition's build order (Foundation → Guided → Council → Adaptive) for the Adaptive rung.

## Self-Review (completed against the spec)

- **Spec coverage:** Shared seed contract (decision 6, all seven fields, `setting` not `world`, no `blueprint`) → Task 1 `InterviewSeeds`. Conversational per-turn subsystem (per-turn AI call + conversational state on the client) → Tasks 1-2. Reuse-vs-new-chat decision (new stateless endpoint; justified) → Architecture + Task 2. Studio conversational UI + convergence to the review gate + create on `romance-{heat}-full` → Task 4. MCP lockstep → Task 3. NewHub card live → Task 4 Step 4. Feature tracking → Feature-tracking section.
- **Simplicity check:** No server-side conversational-state persistence (client holds `messages`); one AI call per turn; the service is a single method; the endpoint reuses the sibling-route wiring; the UI reuses `PremiseIntake` review patterns + `FormatPicker`. No speculative fields.
- **Testing requirements:** unit tests inject AI for determinism and assert reply/done/seeds mapping + JSON extraction + defaulting + graceful degradation (Task 1); bash smoke boots the gateway, hard-gates the `400`s, gates the AI happy-path on provider availability like `romance-premise-intake-smoke.sh` (Task 2); committed bundle-grep test for the studio screen (Task 4); `npx tsc --noEmit` clean per task; fail-soft (malformed turn never throws).
- **Type consistency:** `InterviewSeeds`/`TurnMessage`/`TurnResult` defined once in Task 1 and consumed unchanged by Task 2 and the studio types in Task 4; injected `AiComplete`/`AiSelectProvider` shapes match `premise-intake.ts` and the real `services.aiRouter.complete`/`.selectProvider`.
- **Open items deferred to implementation:** the exact `mcp/src/tools/*.ts` file registering `premise_intake` (Task 3 instructs to grep and register alongside it); the precise `/api/forms` shape for `FormatPicker` (Task 4 follows the existing `NewBook.tsx` loading code verbatim).
