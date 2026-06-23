# Audiobook and Text-to-Speech

## What it is

BookClaw can turn your writing into spoken audio in two distinct ways:

1. **Text-to-speech (TTS)** — a neural narration engine with author-optimized
   voice presets. Paste text or point at an output file and hear it read aloud
   in seconds. Two providers ship behind one interface: **Edge TTS** (free, no
   API key, the default) and **ElevenLabs v3** (paid, audiobook-grade, uses your
   own key from the vault).

2. **Audiobook preparation** — a set of tools that take a finished project's
   manuscript and ready it for narration: clean the prose for speech, build a
   pronunciation dictionary for your invented names, generate per-chapter SSML,
   and attribute dialogue to per-character voices for multi-voice production.

TTS is for listening to your draft; audiobook prep is for producing the actual
narration source. They share the same voice presets.

## Why it matters

Hearing your prose read aloud is one of the fastest ways to catch clunky
dialogue, run-on sentences, and rhythm problems that the eye glides over. The
free Edge provider means you can do this on every draft at no cost. When you are
ready to produce a real audiobook, the prep tools handle the unglamorous work —
spelling out symbols, flagging ambiguous pronouns, getting your characters'
names pronounced correctly, and splitting the text by speaker — and emit SSML
that uploads cleanly to Amazon Polly, Google Cloud TTS, Azure, or ElevenLabs.
The prep step also enforces the **AI-narration disclosure** that ACX, Apple
Books, Google Play, and Spotify require, so you do not accidentally ship
undisclosed AI audio.

## How to use it

### Voice presets

Nine author-tuned presets are always available (they map onto Edge TTS voices):

| Preset | Voice | Best for |
|--------|-------|----------|
| `narrator_female` | Aria | Versatile, most genres (default) |
| `narrator_male` | Guy | Literary fiction, thriller |
| `narrator_deep` | Christopher | Epic fantasy, sci-fi, nonfiction |
| `narrator_warm` | Jenny | Romance, memoir |
| `british_male` | Ryan | Period pieces, cozy mysteries |
| `british_female` | Sonia | Elegant, literary |
| `storyteller` | Andrew | Adventure, YA, middle grade |
| `snarky_nerd` | Steffan | Witty banter, smart humor, sci-fi |
| `curious_kid` | Ana | Middle grade, picture books, whimsical |

You can pass a preset name (e.g. `narrator_deep`), a raw Edge voice ID (e.g.
`en-US-AriaNeural`), or an ElevenLabs `voice_id`. The engine auto-detects which
provider a voice belongs to from its format, so you rarely set the provider by
hand.

### In the Studio / via the API

Generate audio from any text:

```
POST /api/audio/generate
{ "text": "In a world...", "voice": "narrator_deep" }
```

Optional fields: `provider` (`edge` | `elevenlabs`), `rate` / `pitch` /
`volume` (Edge only, e.g. `"+10%"`), `personaId` or `projectId` (to inherit a
persona's configured voice), and `elevenLabsModel`. Text is capped at 50,000
characters per request. The response includes the `filename` and an estimated
`duration` (seconds, at ~150 words/minute).

Play or download the result:

```
GET /api/audio/file/<filename>
```

List available voices (Edge presets always; your ElevenLabs library voices when
a key is configured) plus the active voice/provider:

```
GET /api/audio/voices
```

Set the global default voice and/or provider (persists across restarts):

```
POST /api/audio/config
{ "voice": "narrator_warm", "provider": "edge" }
```

There is also a simpler `GET` / `POST /api/audio/voice` pair that reads or sets
just the active voice.

### Switching to ElevenLabs

Add an `elevenlabs_api_key` entry in **Settings → API Keys** (it is stored in
the encrypted vault). Then either set `provider: "elevenlabs"` in
`/api/audio/config`, or pass an ElevenLabs `voice_id` directly — the engine
detects it. ElevenLabs charges per character, so BookClaw refuses single
requests over 5,000 characters and tells you to split by chapter. For long
drafts, use Edge instead.

### From Telegram

The Telegram bridge exposes two commands:

- **`/speak`** — generate a voice message on demand. Examples:
  - `/speak Hello, I am BookClaw` — speak the text.
  - `/speak narrator_deep In a world...` — speak with a chosen preset.
  - `/speak 3` — read file number 3 from your file list aloud.
- **`/voice`** — toggle voice replies for ordinary chat. `/voice on` makes the
  bot reply with voice messages, `/voice off` turns it back to text, and
  `/voice narrator_deep` switches the voice used. The bot also reacts to natural
  phrases like "read that back" or "say that aloud."

### Audio cleanup

Generated TTS files land in `workspace/audio/` and are **auto-cleaned after 24
hours** (only files named `tts-*` are removed). Treat generated audio as
disposable previews — download anything you want to keep. From Telegram,
`/clean audio` removes generated audio on demand.

## Audiobook preparation

These operate on a **completed project** and run as four passes. Each is a REST
endpoint under `/api/projects/:id/audiobook/...` and is also exposed as an MCP
tool (`audiobook_cleanup`, `audiobook_pronunciation`, `audiobook_ssml`,
`audiobook_attribute`).

### 1. Cleanup — `POST /api/projects/:id/audiobook/cleanup`

Normalizes the manuscript for speech: em-dashes and ellipses become pause cues,
safe symbols are expanded (`&` → "and", `%` → "percent", `@` → "at"), common
abbreviations are spelled out (`Mr.` → "Mister", `Dr.` → "Doctor"), and
problematic passages are **flagged** for review — paragraphs with ambiguous
same-gender pronouns, and long parentheticals that read oddly as audio. Returns
the cleaned text, a change count, and the flagged passages.

### 2. Pronunciation — `POST /api/projects/:id/audiobook/pronunciation`

Pulls your invented and uncommon names from the project's entity index
(characters, locations, items) and produces a pronunciation dictionary template
sorted by how often each name appears. Common names like "John" and "Mary" are
skipped so you only fill in what matters. You add `suggestedIPA` or a
`rhymesWith` hint per entry; those feed the SSML pass.

### 3. SSML — `POST /api/projects/:id/audiobook/ssml`

Applies cleanup, substitutes your pronunciation entries as `<phoneme>` tags,
inserts `<break>` pauses, and emits per-chapter SSML plus a duration estimate.
SSML is accepted by Amazon Polly, Google Cloud TTS, Azure, and ElevenLabs v3.

**Disclosure gate:** for AI narration you must set `aiNarrationDisclosed: true`
(in the request body or on the project). Without it, the SSML is built as a
*human-narrator reference* and the response marks `disclosureRequired: true` —
a reminder that ACX, Apple, Google, and Spotify all require AI-audio disclosure.

### 4. Multi-voice attribution — `POST /api/projects/:id/audiobook/attribute`

Splits each chapter into segments and assigns a voice per speaker for multi-voice
narration. Dialogue is attributed by quote conventions and attribution tags
(`"Run," Sarah whispered.` → Sarah); bare dialogue uses turn-taking; narration
and action beats use the narrator voice. If you do not supply a `voiceMap`,
BookClaw auto-distributes the preset voices across characters deterministically
(the same character keeps the same voice on re-runs); pass `customVoices` to
override individuals, or `chapterNumber` to attribute a single chapter. The
response lists any `unmappedSpeakers` so you can fill the gaps. Each returned
segment carries a resolved `voiceId` — feed them one at a time to
`/api/audio/generate` and concatenate the resulting files into a multi-voice
chapter.

## Under the hood

- `gateway/src/services/tts.ts` — the TTS engine: provider dispatch
  (`edge` / `elevenlabs`), the nine `VOICE_PRESETS`, voice resolution and
  provider auto-detection, ElevenLabs voice listing/caching, and the 24-hour
  `cleanup()`.
- `gateway/src/services/audiobook-prep.ts` — the four prep passes
  (`cleanupScript`, `buildPronunciationDictionary`, `buildSSML`,
  `attributeMultiVoice` + `buildDefaultVoiceMap`).
- `gateway/src/api/routes/media.routes.ts` — the `/api/audio/*` routes and
  persona-aware voice resolution.
- `gateway/src/api/routes/wave.routes.ts` — the `/api/projects/:id/audiobook/*`
  prep routes.
- `gateway/src/bridges/telegram.ts` — the `/speak` and `/voice` handlers.
- `gateway/src/init/phase-06-content.ts` (TTS) and
  `gateway/src/init/phase-09-export-wave.ts` (audiobook prep) — service wiring.
- `mcp/src/tools/media.ts` (`generate_audio`, `list_voices`, `set_audio_config`)
  and `mcp/src/tools/audiobook.ts` (`audiobook_cleanup`,
  `audiobook_pronunciation`, `audiobook_ssml`, `audiobook_attribute`) — the MCP
  tool wrappers.

## Related

- [Ways to Use BookClaw — The Surfaces](./surfaces.md) — the Studio, Telegram,
  API, and MCP doors that all reach these routes.
- [Books and Authors](./books-and-authors.md) — projects and the manuscripts the
  prep tools narrate.
- [Book Format and Structure](./book-format-and-structure.md) — the chapters
  that feed audiobook prep, and the other export formats.
