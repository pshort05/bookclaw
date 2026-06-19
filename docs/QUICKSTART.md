# BookClaw Quick Start

Get BookClaw running and writing in under 5 minutes.

## Prerequisites

- **Node.js 22+** (check: `node --version`)
- **A Gemini API key** (free at [aistudio.google.com](https://aistudio.google.com))
- **Optional:** Telegram bot token (for mobile control)

## Install

```bash
git clone https://github.com/pshort05/bookclaw.git
cd bookclaw
npm install
```

## Start

```bash
npm start
```

You should see (the version is a CalVer build stamp, `V{yy.mm.dd}`):

```
  BookClaw V26.06.xx
  ═══════════════════════════════════
  The Autonomous AI Writing Agent
  ...
  ✓ Skills: 29 loaded (15 author-specific)
  ✓ Project engine: 7 pipeline templates + dynamic AI planning
  ═══════════════════════════════════
  BookClaw is ready to write
  Dashboard: http://localhost:3847
```

## Configure

1. Open **http://localhost:3847** in your browser — this opens the v6 studio (Book Board). A standalone Chat app can also be enabled on its own port by setting `BOOKCLAW_CHAT_PORT` (e.g. `3848`); it is disabled unless that variable is set.
2. Go to **Settings** in the left rail
3. Paste your **Gemini API key** and click Save
4. The provider status should show "Gemini" as active

## Your First Task

### Option A: Studio
1. Use the **New-Book picker** to create a book, then open the **Write** workspace from the left rail
2. Type your prompt in the chat: "Write me a short story about a robot who learns to paint"
3. Watch the **Activity** view (left rail) as BookClaw plans and executes

### Option B: Telegram
1. In Settings, paste your **Telegram Bot Token** and click Save
2. Click **Connect Telegram**
3. Open your bot in Telegram and send:
   ```
   /goal write me a short story about a robot who learns to paint
   ```
4. BookClaw plans the steps and runs them, sending you updates

### Option C: API
```bash
curl -X POST http://localhost:3847/api/projects/create \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $BOOKCLAW_AUTH_TOKEN" \
  -d '{"title":"Robot Story","description":"Write a short story about a robot who learns to paint","planning":"dynamic"}'
```
Replace `$BOOKCLAW_AUTH_TOKEN` with the token from your `.env` file (auto-generated on first run).

## View Results

- **Studio** → Activity view (left rail) shows everything the agent did
- **Files**: `workspace/projects/` contains all generated content
- **Telegram**: Use `/files` to list, `/read [file]` to preview

## Add More Providers

BookClaw gets smarter with better models. In Settings, add:

- **Anthropic Claude** — Best for complex editing and reasoning ($3/M tokens)
- **DeepSeek** — Good for creative writing at low cost ($0.14/M tokens)
- **Ollama** — Free local models (requires Ollama installed)

## Next Steps

- Run a full novel: `/goal write a full tech-thriller from start to finish`
- Do research: `/research medieval sword fighting techniques`
- Customize: Edit `workspace/soul/STYLE-GUIDE.md` for your writing style

## Premium Skills Bundle

Extend BookClaw with advanced writing capabilities. The **Premium Skills Bundle** includes 10 premium skills — Ghostwriter Pro, Series Architect, Book Launch Machine, First Chapter Hook, Comp Title Finder, Dictation Cleanup, Sensitivity Reader, Read Aloud, Narrative Voice Coach, and Writing Secrets Integration — all in one package.

**Get it on Ko-Fi:** [ko-fi.com/writingsecrets](https://ko-fi.com/s/4e24f1dfa5)

### Install Premium Skills

1. Purchase the bundle from Ko-Fi
2. Download and extract the zip
3. Copy all skill folders to `skills/premium/`
4. Restart BookClaw — premium skills appear with a star in the console

## Author OS Integration

If you have the Author OS tool suite, mount the tools for enhanced capabilities:

- **Local**: Place at `~/author-os`
- **Docker**: Mount to `/app/author-os`

BookClaw auto-detects: Workflow Engine, Book Bible Engine, Format Factory Pro, Manuscript Autopsy, AI Author Library, Creator Asset Suite.

Format Factory Pro requires Python 3 for manuscript export.
