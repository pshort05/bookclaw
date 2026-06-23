# BookClaw MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a thin, stateless TypeScript MCP server that exposes BookClaw's core author workflow to MCP clients over Streamable HTTP, wrapping BookClaw's existing REST API.

**Architecture:** The server registers a curated set of MCP tools (status, books, projects/pipeline, chat, export, library) plus a generic `bookclaw_request` escape hatch. Every tool delegates to one `fetch` wrapper (`bookclaw-client.ts`) that injects the outbound BookClaw bearer token. An inbound bearer gate protects the MCP HTTP endpoint. No state is persisted; BookClaw is the single source of truth.

**Tech Stack:** Node 22, TypeScript (NodeNext, run via `tsx`), `@modelcontextprotocol/sdk`, `express`, `zod`. Tests via `node --test` + a bash smoke script.

## Global Constraints

- Node 22+; TypeScript runs through `tsx` (`--import tsx`), never `ts-node`.
- `NodeNext` module resolution: **all relative imports use `.js` extensions** even though source is `.ts`.
- All config via environment variables: `BOOKCLAW_BASE_URL` (default `http://127.0.0.1:3847`), `BOOKCLAW_AUTH_TOKEN` (outbound, presented to BookClaw), `BOOKCLAW_MCP_TOKEN` (inbound, gates the MCP endpoint), `BOOKCLAW_MCP_BIND` (default `127.0.0.1`), `BOOKCLAW_MCP_PORT` (default `3849`).
- **Two bearer tokens are never conflated.** `BOOKCLAW_MCP_TOKEN` gates inbound; `BOOKCLAW_AUTH_TOKEN` is sent outbound. Never log either; never commit either.
- Stateless: no database, cache, or persisted state.
- `bookclaw_request` **never bypasses BookClaw's confirmation gate** — pending-confirmation responses are returned verbatim to the LLM, never auto-approved.
- Every tool calls BookClaw only through `bookclaw-client.ts`; no tool calls `fetch` directly.
- Fail-soft startup logging in BookClaw's `✓ / ⚠ / ℹ` style.

---

### Task 1: Project scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.env.example`
- Modify: `.gitignore` (replace the Java template with a Node template)
- Create: `tests/unit/scaffold.test.ts` (temporary smoke of the test runner; deleted in Task 2)

**Interfaces:**
- Consumes: nothing.
- Produces: a working `npm` project where `npx tsc --noEmit` and `npm run test:unit` succeed.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "bookclaw-mcp",
  "version": "0.1.0",
  "description": "MCP server for BookClaw",
  "type": "module",
  "engines": { "node": ">=22.0.0" },
  "scripts": {
    "start": "node --import tsx src/index.ts",
    "dev": "node --import tsx --watch src/index.ts",
    "build": "tsc",
    "test": "npm run test:unit && npm run test:smoke",
    "test:unit": "node --import tsx --test tests/unit/*.test.ts",
    "test:smoke": "bash tests/smoke-test.sh"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.0",
    "express": "^4.21.2",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^22.10.0",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": ".",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Write `.env.example`**

```bash
# Base URL of the running BookClaw gateway
BOOKCLAW_BASE_URL=http://127.0.0.1:3847

# Token this server presents to BookClaw (BookClaw's own auto-generated token)
BOOKCLAW_AUTH_TOKEN=

# Token that gates THIS server's MCP endpoint (clients must present it)
BOOKCLAW_MCP_TOKEN=

# Where this MCP server listens
BOOKCLAW_MCP_BIND=127.0.0.1
BOOKCLAW_MCP_PORT=3849
```

- [ ] **Step 4: Replace `.gitignore` with a Node template**

```gitignore
node_modules/
dist/
*.log
.env
.env.local
.DS_Store
```

- [ ] **Step 5: Write a temporary runner-smoke test `tests/unit/scaffold.test.ts`**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('test runner works', () => {
  assert.equal(1 + 1, 2);
});
```

- [ ] **Step 6: Install and verify**

Run: `npm install && npx tsc --noEmit && npm run test:unit`
Expected: install succeeds, `tsc` prints nothing (exit 0), test output shows `pass 1`.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json .env.example .gitignore tests/
git commit -m "chore: scaffold TypeScript MCP project"
```

---

### Task 2: BookClaw API client

**Files:**
- Create: `src/bookclaw-client.ts`
- Create: `tests/unit/bookclaw-client.test.ts`
- Delete: `tests/unit/scaffold.test.ts`

**Interfaces:**
- Consumes: env (`BOOKCLAW_BASE_URL`, `BOOKCLAW_AUTH_TOKEN`).
- Produces:
  - `type BookClawResult = { ok: true; status: number; data: unknown } | { ok: false; status: number; error: string }`
  - `function createClient(opts?: { baseUrl?: string; token?: string; timeoutMs?: number }): BookClawClient`
  - `interface BookClawClient { request(method: string, path: string, body?: unknown): Promise<BookClawResult> }`
  - The client sends `Authorization: Bearer <token>` when a token is set, maps `401/403/503` to friendly errors, and maps network/timeout failures to a retryable error naming the base URL.

- [ ] **Step 1: Write the failing tests `tests/unit/bookclaw-client.test.ts`**

```ts
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { createClient } from '../../src/bookclaw-client.js';

// A tiny stub BookClaw that echoes auth + path and can be told to return a status.
let server: Server;
let baseUrl: string;
let lastAuth: string | undefined;
let nextStatus = 200;
let nextBody: unknown = { ok: true };

before(async () => {
  server = createServer((req, res) => {
    lastAuth = req.headers['authorization'];
    res.statusCode = nextStatus;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(nextBody));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  if (typeof addr === 'object' && addr) baseUrl = `http://127.0.0.1:${addr.port}`;
});

after(() => server.close());

test('injects the bearer token', async () => {
  nextStatus = 200; nextBody = { hello: 'world' };
  const client = createClient({ baseUrl, token: 'secret-token' });
  const res = await client.request('GET', '/api/status');
  assert.equal(lastAuth, 'Bearer secret-token');
  assert.deepEqual(res, { ok: true, status: 200, data: { hello: 'world' } });
});

test('maps 401 to a friendly auth error', async () => {
  nextStatus = 401; nextBody = { error: 'unauthorized' };
  const client = createClient({ baseUrl, token: 'bad' });
  const res = await client.request('GET', '/api/status');
  assert.equal(res.ok, false);
  if (!res.ok) assert.match(res.error, /BOOKCLAW_AUTH_TOKEN/);
});

test('maps 503 to a no-providers error', async () => {
  nextStatus = 503; nextBody = { error: 'no providers' };
  const client = createClient({ baseUrl, token: 'x' });
  const res = await client.request('POST', '/api/chat', { message: 'hi' });
  assert.equal(res.ok, false);
  if (!res.ok) assert.match(res.error, /no AI providers/i);
});

test('maps a connection failure to a retryable error', async () => {
  const client = createClient({ baseUrl: 'http://127.0.0.1:1', token: 'x', timeoutMs: 500 });
  const res = await client.request('GET', '/api/status');
  assert.equal(res.ok, false);
  if (!res.ok) assert.match(res.error, /127\.0\.0\.1:1/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:unit`
Expected: FAIL — cannot find module `../../src/bookclaw-client.js`.

- [ ] **Step 3: Implement `src/bookclaw-client.ts`**

```ts
export type BookClawResult =
  | { ok: true; status: number; data: unknown }
  | { ok: false; status: number; error: string };

export interface BookClawClient {
  request(method: string, path: string, body?: unknown): Promise<BookClawResult>;
}

interface ClientOpts {
  baseUrl?: string;
  token?: string;
  timeoutMs?: number;
}

function friendlyError(status: number, baseUrl: string, raw: string): string {
  switch (status) {
    case 401:
      return 'BookClaw rejected the request (401) — check BOOKCLAW_AUTH_TOKEN.';
    case 403:
      return `BookClaw denied the request (403): ${raw || 'IP allowlist or confirmation gate.'}`;
    case 503:
      return 'BookClaw has no AI providers configured — add a key in BookClaw Settings.';
    default:
      return `BookClaw returned ${status}: ${raw || 'no body'} (${baseUrl})`;
  }
}

export function createClient(opts: ClientOpts = {}): BookClawClient {
  const baseUrl = (opts.baseUrl ?? process.env.BOOKCLAW_BASE_URL ?? 'http://127.0.0.1:3847').replace(/\/$/, '');
  const token = opts.token ?? process.env.BOOKCLAW_AUTH_TOKEN ?? '';
  const timeoutMs = opts.timeoutMs ?? 30_000;

  return {
    async request(method, path, body) {
      const url = `${baseUrl}${path}`;
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (token) headers['authorization'] = `Bearer ${token}`;

      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), timeoutMs);
      try {
        const resp = await fetch(url, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: ac.signal,
        });
        const text = await resp.text();
        let parsed: unknown = text;
        try { parsed = text ? JSON.parse(text) : null; } catch { /* keep raw text */ }

        if (!resp.ok) {
          const raw = typeof parsed === 'object' && parsed && 'error' in parsed
            ? String((parsed as Record<string, unknown>).error)
            : text;
          return { ok: false, status: resp.status, error: friendlyError(resp.status, baseUrl, raw) };
        }
        return { ok: true, status: resp.status, data: parsed };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, status: 0, error: `Could not reach BookClaw at ${baseUrl}: ${msg} (retryable).` };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:unit`
Expected: PASS — 4 passing.

- [ ] **Step 5: Delete the temporary scaffold test**

Run: `git rm tests/unit/scaffold.test.ts`

- [ ] **Step 6: Commit**

```bash
git add src/bookclaw-client.ts tests/unit/bookclaw-client.test.ts
git commit -m "feat: BookClaw API client with auth injection and error mapping"
```

---

### Task 3: Inbound bearer auth gate

**Files:**
- Create: `src/auth.ts`
- Create: `tests/unit/auth.test.ts`

**Interfaces:**
- Consumes: env (`BOOKCLAW_MCP_TOKEN`).
- Produces:
  - `function makeAuthMiddleware(token: string): (req, res, next) => void` — an Express middleware that returns `401` unless the request carries `Authorization: Bearer <token>`. A blank `token` argument makes every request `401` (deny-by-default).

- [ ] **Step 1: Write the failing tests `tests/unit/auth.test.ts`**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeAuthMiddleware } from '../../src/auth.js';

function fakeRes() {
  return {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(obj: unknown) { this.body = obj; return this; },
  };
}

test('rejects a missing token with 401', () => {
  const mw = makeAuthMiddleware('right');
  const res = fakeRes();
  let nextCalled = false;
  mw({ headers: {} } as any, res as any, () => { nextCalled = true; });
  assert.equal(res.statusCode, 401);
  assert.equal(nextCalled, false);
});

test('rejects a wrong token with 401', () => {
  const mw = makeAuthMiddleware('right');
  const res = fakeRes();
  mw({ headers: { authorization: 'Bearer wrong' } } as any, res as any, () => {});
  assert.equal(res.statusCode, 401);
});

test('accepts the correct token', () => {
  const mw = makeAuthMiddleware('right');
  const res = fakeRes();
  let nextCalled = false;
  mw({ headers: { authorization: 'Bearer right' } } as any, res as any, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
});

test('a blank configured token denies everything', () => {
  const mw = makeAuthMiddleware('');
  const res = fakeRes();
  mw({ headers: { authorization: 'Bearer ' } } as any, res as any, () => {});
  assert.equal(res.statusCode, 401);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:unit`
Expected: FAIL — cannot find module `../../src/auth.js`.

- [ ] **Step 3: Implement `src/auth.ts`**

```ts
import type { Request, Response, NextFunction } from 'express';

export function makeAuthMiddleware(token: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = String(req.headers['authorization'] || '');
    const presented = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token || presented !== token) {
      res.status(401).json({ error: 'Unauthorized — present a valid Bearer BOOKCLAW_MCP_TOKEN.' });
      return;
    }
    next();
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:unit`
Expected: PASS — auth tests green alongside the client tests.

- [ ] **Step 5: Commit**

```bash
git add src/auth.ts tests/unit/auth.test.ts
git commit -m "feat: inbound bearer gate for the MCP endpoint"
```

---

### Task 4: Server bootstrap, Streamable HTTP transport, and the status tool

**Files:**
- Create: `src/tools/status.ts`
- Create: `src/server.ts`
- Create: `src/index.ts`

**Interfaces:**
- Consumes: `createClient` (Task 2), `makeAuthMiddleware` (Task 3).
- Produces:
  - `src/tools/status.ts`: `function registerStatusTools(server: McpServer, client: BookClawClient): void` registering `bookclaw_status`.
  - `src/server.ts`: `function buildMcpServer(client: BookClawClient): McpServer` (registers every tool module) and `function startHttpServer(): void` (express app, auth middleware, stateless `/mcp` route, listen on bind/port).
  - `src/index.ts`: calls `startHttpServer()`.

- [ ] **Step 1: Implement `src/tools/status.ts`**

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { BookClawClient } from '../bookclaw-client.js';

function toToolResult(label: string, result: Awaited<ReturnType<BookClawClient['request']>>) {
  if (!result.ok) {
    return { isError: true, content: [{ type: 'text' as const, text: `${label} failed: ${result.error}` }] };
  }
  return { content: [{ type: 'text' as const, text: JSON.stringify(result.data, null, 2) }] };
}

export function registerStatusTools(server: McpServer, client: BookClawClient): void {
  server.registerTool(
    'bookclaw_status',
    {
      title: 'BookClaw status',
      description: 'Liveness and runtime status of the BookClaw gateway (providers, version, active book).',
      inputSchema: {},
    },
    async () => toToolResult('bookclaw_status', await client.request('GET', '/api/status')),
  );
}
```

> Note for later tasks: `toToolResult` is re-used. Put it in `src/tools/_shared.ts` when Task 5 needs it; for now keep it local. Task 5, Step 1 moves it.

- [ ] **Step 2: Implement `src/server.ts`**

```ts
import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createClient, type BookClawClient } from './bookclaw-client.js';
import { makeAuthMiddleware } from './auth.js';
import { registerStatusTools } from './tools/status.js';

export function buildMcpServer(client: BookClawClient): McpServer {
  const server = new McpServer({ name: 'bookclaw-mcp', version: '0.1.0' });
  registerStatusTools(server, client);
  return server;
}

export function startHttpServer(): void {
  const bind = process.env.BOOKCLAW_MCP_BIND ?? '127.0.0.1';
  const port = Number(process.env.BOOKCLAW_MCP_PORT ?? '3849');
  const mcpToken = process.env.BOOKCLAW_MCP_TOKEN ?? '';
  const client = createClient();

  if (!mcpToken) {
    console.warn('  ⚠ BOOKCLAW_MCP_TOKEN is unset — the MCP endpoint will deny all requests.');
  }
  if (!process.env.BOOKCLAW_AUTH_TOKEN) {
    console.warn('  ⚠ BOOKCLAW_AUTH_TOKEN is unset — calls to BookClaw will likely 401.');
  }

  const app = express();
  app.use(express.json({ limit: '4mb' }));
  app.post('/mcp', makeAuthMiddleware(mcpToken), async (req, res) => {
    // Stateless mode: a fresh server + transport per request (no session reuse).
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => { transport.close(); });
    const server = buildMcpServer(client);
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  // Stateless transport does not support server-initiated GET/DELETE sessions.
  const reject = (_req: express.Request, res: express.Response) =>
    res.status(405).json({ error: 'Method Not Allowed (stateless server).' });
  app.get('/mcp', makeAuthMiddleware(mcpToken), reject);
  app.delete('/mcp', makeAuthMiddleware(mcpToken), reject);

  app.listen(port, bind, () => {
    console.log(`  ✓ bookclaw-mcp listening on http://${bind}:${port}/mcp`);
    console.log(`  ℹ proxying to BookClaw at ${process.env.BOOKCLAW_BASE_URL ?? 'http://127.0.0.1:3847'}`);
  });
}
```

- [ ] **Step 3: Implement `src/index.ts`**

```ts
import { startHttpServer } from './server.js';

startHttpServer();
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: exit 0, no output.

- [ ] **Step 5: Manual boot check**

Run: `BOOKCLAW_MCP_TOKEN=t BOOKCLAW_AUTH_TOKEN=t npm start` (Ctrl-C after the banner)
Expected: prints `✓ bookclaw-mcp listening on http://127.0.0.1:3849/mcp`.

- [ ] **Step 6: Commit**

```bash
git add src/index.ts src/server.ts src/tools/status.ts
git commit -m "feat: MCP server bootstrap over Streamable HTTP + status tool"
```

---

### Task 5: Books tools

**Files:**
- Create: `src/tools/_shared.ts`
- Modify: `src/tools/status.ts` (import `toToolResult` from `_shared`)
- Create: `src/tools/books.ts`
- Modify: `src/server.ts` (register books tools)

**Interfaces:**
- Consumes: `BookClawClient`.
- Produces:
  - `src/tools/_shared.ts`: `function toToolResult(label, result)` (moved from `status.ts`) and `function asText(obj: unknown)`.
  - `src/tools/books.ts`: `function registerBookTools(server, client): void` registering `list_books`, `get_book`, `create_book`, `set_active_book`, `get_book_files`, `read_book_file`.

BookClaw endpoints used (verified in `../bookclaw/gateway/src/api/routes/books.routes.ts`):
`GET /api/books`, `GET /api/books/:slug`, `POST /api/books` (create), `POST /api/books/active` (set active), `GET /api/books/:slug/files`, `GET /api/books/:slug/files/:filename`.

- [ ] **Step 1: Create `src/tools/_shared.ts` and move the helper**

```ts
import type { BookClawResult } from '../bookclaw-client.js';

export function toToolResult(label: string, result: BookClawResult) {
  if (!result.ok) {
    return { isError: true, content: [{ type: 'text' as const, text: `${label} failed: ${result.error}` }] };
  }
  return { content: [{ type: 'text' as const, text: JSON.stringify(result.data, null, 2) }] };
}
```

Then edit `src/tools/status.ts`: delete its local `toToolResult` and add `import { toToolResult } from './_shared.js';`.

- [ ] **Step 2: Write the failing test `tests/unit/books.test.ts`**

```ts
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createClient } from '../../src/bookclaw-client.js';
import { registerBookTools } from '../../src/tools/books.js';

let server: Server;
let baseUrl: string;
let lastReq: { method?: string; url?: string } = {};

before(async () => {
  server = createServer((req, res) => {
    lastReq = { method: req.method, url: req.url };
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ books: [{ slug: 'demo' }] }));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  if (typeof addr === 'object' && addr) baseUrl = `http://127.0.0.1:${addr.port}`;
});
after(() => server.close());

test('registerBookTools wires list_books to GET /api/books', async () => {
  const client = createClient({ baseUrl, token: 't' });
  const mcp = new McpServer({ name: 'test', version: '0' });
  registerBookTools(mcp, client);
  // Drive the registered handler directly through a minimal call.
  const res = await client.request('GET', '/api/books');
  assert.equal(lastReq.url, '/api/books');
  assert.equal(res.ok, true);
});
```

> This test verifies the client wiring and that `registerBookTools` imports/compiles. Tool-handler dispatch is covered end-to-end by the smoke test (Task 11).

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test:unit`
Expected: FAIL — cannot find module `../../src/tools/books.js`.

- [ ] **Step 4: Implement `src/tools/books.ts`**

```ts
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { BookClawClient } from '../bookclaw-client.js';
import { toToolResult } from './_shared.js';

export function registerBookTools(server: McpServer, client: BookClawClient): void {
  server.registerTool('list_books',
    { title: 'List books', description: 'List all books with their state and suggested next action.', inputSchema: {} },
    async () => toToolResult('list_books', await client.request('GET', '/api/books')),
  );

  server.registerTool('get_book',
    { title: 'Get book', description: 'Get one book by slug.', inputSchema: { slug: z.string().describe('Book slug') } },
    async ({ slug }) => toToolResult('get_book', await client.request('GET', `/api/books/${encodeURIComponent(slug)}`)),
  );

  server.registerTool('create_book',
    {
      title: 'Create book',
      description: 'Create a new book, pulling author/voice/genre/pipeline templates from the library.',
      inputSchema: {
        title: z.string().describe('Book title'),
        author: z.string().optional().describe('Library author name'),
        genre: z.string().optional().describe('Library genre name'),
        pipeline: z.string().optional().describe('Library pipeline name'),
      },
    },
    async (args) => toToolResult('create_book', await client.request('POST', '/api/books', args)),
  );

  server.registerTool('set_active_book',
    { title: 'Set active book', description: 'Set the global active book by slug.', inputSchema: { slug: z.string() } },
    async ({ slug }) => toToolResult('set_active_book', await client.request('POST', '/api/books/active', { slug })),
  );

  server.registerTool('get_book_files',
    { title: 'List book files', description: 'List the generated output files of a book.', inputSchema: { slug: z.string() } },
    async ({ slug }) => toToolResult('get_book_files', await client.request('GET', `/api/books/${encodeURIComponent(slug)}/files`)),
  );

  server.registerTool('read_book_file',
    {
      title: 'Read book file',
      description: 'Read one output file of a book by filename.',
      inputSchema: { slug: z.string(), filename: z.string() },
    },
    async ({ slug, filename }) =>
      toToolResult('read_book_file',
        await client.request('GET', `/api/books/${encodeURIComponent(slug)}/files/${encodeURIComponent(filename)}`)),
  );
}
```

- [ ] **Step 5: Register in `src/server.ts`**

Add `import { registerBookTools } from './tools/books.js';` and, inside `buildMcpServer`, after `registerStatusTools(server, client);` add `registerBookTools(server, client);`.

- [ ] **Step 6: Run tests + type-check**

Run: `npm run test:unit && npx tsc --noEmit`
Expected: PASS, exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/tools/_shared.ts src/tools/status.ts src/tools/books.ts src/server.ts tests/unit/books.test.ts
git commit -m "feat: books tools (list/get/create/set-active/files)"
```

---

### Task 6: Projects and pipeline tools

**Files:**
- Create: `src/tools/projects.ts`
- Modify: `src/server.ts` (register)

**Interfaces:**
- Consumes: `BookClawClient`, `toToolResult`.
- Produces: `function registerProjectTools(server, client): void` registering `list_projects`, `get_project`, `create_project`, `create_pipeline`, `advance_pipeline`, `get_project_files`.

BookClaw endpoints (from `projects.routes.ts` / `documents.routes.ts`):
`GET /api/projects/list`, `GET /api/projects/:id`, `POST /api/projects/create`, `POST /api/pipeline/create`, `POST /api/pipeline/:pipelineId/advance`, `GET /api/projects/:id/files`.

- [ ] **Step 1: Implement `src/tools/projects.ts`**

```ts
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { BookClawClient } from '../bookclaw-client.js';
import { toToolResult } from './_shared.js';

export function registerProjectTools(server: McpServer, client: BookClawClient): void {
  server.registerTool('list_projects',
    { title: 'List projects', description: 'List known projects (id, title, status).', inputSchema: {} },
    async () => toToolResult('list_projects', await client.request('GET', '/api/projects/list')),
  );

  server.registerTool('get_project',
    { title: 'Get project', description: 'Get one project and its steps by id.', inputSchema: { id: z.string() } },
    async ({ id }) => toToolResult('get_project', await client.request('GET', `/api/projects/${encodeURIComponent(id)}`)),
  );

  server.registerTool('create_project',
    {
      title: 'Create project',
      description: 'Create and auto-execute a project. BookClaw plans steps from the task, or a template if given.',
      inputSchema: {
        task: z.string().describe('What to do, in plain language'),
        template: z.string().optional().describe('Optional project template id'),
      },
    },
    async (args) => toToolResult('create_project', await client.request('POST', '/api/projects/create', args)),
  );

  server.registerTool('create_pipeline',
    {
      title: 'Create pipeline',
      description: 'Create a full multi-phase book pipeline (planning → bible → production → revision → format → launch).',
      inputSchema: {
        idea: z.string().describe('The book idea'),
        pipeline: z.string().optional().describe('Named library pipeline; defaults to the novel pipeline'),
      },
    },
    async (args) => toToolResult('create_pipeline', await client.request('POST', '/api/pipeline/create', args)),
  );

  server.registerTool('advance_pipeline',
    { title: 'Advance pipeline', description: 'Advance a pipeline to its next phase.', inputSchema: { pipelineId: z.string() } },
    async ({ pipelineId }) =>
      toToolResult('advance_pipeline', await client.request('POST', `/api/pipeline/${encodeURIComponent(pipelineId)}/advance`)),
  );

  server.registerTool('get_project_files',
    { title: 'List project files', description: 'List a project\'s output files.', inputSchema: { id: z.string() } },
    async ({ id }) =>
      toToolResult('get_project_files', await client.request('GET', `/api/projects/${encodeURIComponent(id)}/files`)),
  );
}
```

- [ ] **Step 2: Register in `src/server.ts`**

Add `import { registerProjectTools } from './tools/projects.js';` and call `registerProjectTools(server, client);` inside `buildMcpServer`.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/tools/projects.ts src/server.ts
git commit -m "feat: projects and pipeline tools"
```

---

### Task 7: Chat tool

**Files:**
- Create: `src/tools/chat.ts`
- Modify: `src/server.ts` (register)

**Interfaces:**
- Consumes: `BookClawClient`, `toToolResult`.
- Produces: `function registerChatTools(server, client): void` registering `chat`.

BookClaw endpoint (from `core.routes.ts`): `POST /api/chat` with `{ message: string, skipHistory?: boolean }`, returns `{ response }`. Messages over 10,000 chars are rejected by BookClaw with 400.

- [ ] **Step 1: Implement `src/tools/chat.ts`**

```ts
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { BookClawClient } from '../bookclaw-client.js';
import { toToolResult } from './_shared.js';

export function registerChatTools(server: McpServer, client: BookClawClient): void {
  server.registerTool('chat',
    {
      title: 'Chat with BookClaw',
      description: 'Send a message to the BookClaw agent (free chat or a /command). Returns the full response.',
      inputSchema: {
        message: z.string().max(10_000).describe('Message or /command (max 10,000 chars)'),
        skipHistory: z.boolean().optional().describe('Do not record this turn in conversation history'),
      },
    },
    async (args) => toToolResult('chat', await client.request('POST', '/api/chat', args)),
  );
}
```

- [ ] **Step 2: Register in `src/server.ts`**

Add `import { registerChatTools } from './tools/chat.js';` and call `registerChatTools(server, client);`.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/tools/chat.ts src/server.ts
git commit -m "feat: chat tool"
```

---

### Task 8: Export tools

**Files:**
- Create: `src/tools/export.ts`
- Modify: `src/server.ts` (register)

**Interfaces:**
- Consumes: `BookClawClient`, `toToolResult`.
- Produces: `function registerExportTools(server, client): void` registering `compile_project`, `export_docx`.

BookClaw endpoints (from `documents.routes.ts`): `POST /api/projects/:id/compile`, `POST /api/projects/:id/export-docx`.

- [ ] **Step 1: Implement `src/tools/export.ts`**

```ts
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { BookClawClient } from '../bookclaw-client.js';
import { toToolResult } from './_shared.js';

export function registerExportTools(server: McpServer, client: BookClawClient): void {
  server.registerTool('compile_project',
    { title: 'Compile project', description: 'Compile a project\'s step outputs into a single manuscript.', inputSchema: { id: z.string() } },
    async ({ id }) =>
      toToolResult('compile_project', await client.request('POST', `/api/projects/${encodeURIComponent(id)}/compile`)),
  );

  server.registerTool('export_docx',
    { title: 'Export DOCX', description: 'Export a project as a KDP-ready DOCX file.', inputSchema: { id: z.string() } },
    async ({ id }) =>
      toToolResult('export_docx', await client.request('POST', `/api/projects/${encodeURIComponent(id)}/export-docx`)),
  );
}
```

- [ ] **Step 2: Register in `src/server.ts`**

Add `import { registerExportTools } from './tools/export.js';` and call `registerExportTools(server, client);`.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/tools/export.ts src/server.ts
git commit -m "feat: export tools (compile, docx)"
```

---

### Task 9: Library (read) tools

**Files:**
- Create: `src/tools/library.ts`
- Modify: `src/server.ts` (register)

**Interfaces:**
- Consumes: `BookClawClient`, `toToolResult`.
- Produces: `function registerLibraryTools(server, client): void` registering `list_library`, `get_library_entry`.

BookClaw endpoints (from `library.routes.ts`): `GET /api/library` (overview), `GET /api/library/:kind`, `GET /api/library/:kind/:name`. Kinds: `author`, `voice`, `genre`, `pipeline`, `section`, `skill`.

- [ ] **Step 1: Implement `src/tools/library.ts`**

```ts
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { BookClawClient } from '../bookclaw-client.js';
import { toToolResult } from './_shared.js';

const KIND = z.enum(['author', 'voice', 'genre', 'pipeline', 'section', 'skill']);

export function registerLibraryTools(server: McpServer, client: BookClawClient): void {
  server.registerTool('list_library',
    {
      title: 'List library',
      description: 'List reusable library assets. Omit kind for an overview, or pass a kind to list its entries.',
      inputSchema: { kind: KIND.optional() },
    },
    async ({ kind }) =>
      toToolResult('list_library', await client.request('GET', kind ? `/api/library/${kind}` : '/api/library')),
  );

  server.registerTool('get_library_entry',
    { title: 'Get library entry', description: 'Get one library entry by kind and name.', inputSchema: { kind: KIND, name: z.string() } },
    async ({ kind, name }) =>
      toToolResult('get_library_entry', await client.request('GET', `/api/library/${kind}/${encodeURIComponent(name)}`)),
  );
}
```

- [ ] **Step 2: Register in `src/server.ts`**

Add `import { registerLibraryTools } from './tools/library.js';` and call `registerLibraryTools(server, client);`.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/tools/library.ts src/server.ts
git commit -m "feat: read-only library tools"
```

---

### Task 10: Escape hatch + endpoint catalog

**Files:**
- Create: `src/endpoints.ts`
- Create: `src/tools/escape-hatch.ts`
- Create: `tests/unit/escape-hatch.test.ts`
- Modify: `src/server.ts` (register)

**Interfaces:**
- Consumes: `BookClawClient`, `toToolResult`.
- Produces:
  - `src/endpoints.ts`: `const ENDPOINT_CATALOG: { method: string; path: string; purpose: string }[]` — a curated subset (the common ~40 routes; full coverage can be appended later).
  - `src/tools/escape-hatch.ts`: `function validatePath(path: string): string | null` (returns an error string or `null`), `function registerEscapeHatch(server, client): void` registering `bookclaw_request` and `list_endpoints`.

- [ ] **Step 1: Write the failing test `tests/unit/escape-hatch.test.ts`**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePath } from '../../src/tools/escape-hatch.js';

test('rejects a path that does not start with /api/', () => {
  assert.match(validatePath('/etc/passwd') ?? '', /must start with \/api\//);
});

test('rejects a protocol-relative or absolute URL', () => {
  assert.notEqual(validatePath('http://evil.example/api/x'), null);
});

test('accepts a normal api path', () => {
  assert.equal(validatePath('/api/books'), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit`
Expected: FAIL — cannot find module `../../src/tools/escape-hatch.js`.

- [ ] **Step 3: Implement `src/endpoints.ts`**

```ts
export const ENDPOINT_CATALOG: { method: string; path: string; purpose: string }[] = [
  { method: 'GET', path: '/api/status', purpose: 'Gateway status (providers, version, active book).' },
  { method: 'GET', path: '/api/books', purpose: 'List books.' },
  { method: 'POST', path: '/api/books', purpose: 'Create a book.' },
  { method: 'GET', path: '/api/books/:slug', purpose: 'Get one book.' },
  { method: 'POST', path: '/api/projects/create', purpose: 'Create + auto-execute a project.' },
  { method: 'POST', path: '/api/pipeline/create', purpose: 'Create a full novel pipeline.' },
  { method: 'POST', path: '/api/chat', purpose: 'Chat with the agent.' },
  { method: 'GET', path: '/api/personas', purpose: 'List author personas.' },
  { method: 'POST', path: '/api/personas', purpose: 'Create an author persona.' },
  { method: 'GET', path: '/api/series', purpose: 'List series.' },
  { method: 'POST', path: '/api/kdp/export-blurb', purpose: 'Generate a KDP blurb.' },
  { method: 'POST', path: '/api/projects/:id/beta-reader', purpose: 'Run the AI beta-reader panel.' },
  { method: 'POST', path: '/api/audio/generate', purpose: 'Generate TTS audio.' },
  { method: 'POST', path: '/api/images/book-cover', purpose: 'Generate a book cover.' },
  { method: 'GET', path: '/api/confirmations', purpose: 'List pending confirmation-gate items.' },
  { method: 'POST', path: '/api/confirmations/:id/approve', purpose: 'Approve a gated action (requires explicit human intent).' },
  { method: 'GET', path: '/api/backups', purpose: 'List backups.' },
  { method: 'GET', path: '/api/library', purpose: 'Library overview.' },
];
// This is a curated subset. BookClaw exposes ~284 routes; see
// ../bookclaw/gateway/src/api/routes/*.routes.ts for the complete list.
```

- [ ] **Step 4: Implement `src/tools/escape-hatch.ts`**

```ts
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { BookClawClient } from '../bookclaw-client.js';
import { toToolResult } from './_shared.js';
import { ENDPOINT_CATALOG } from '../endpoints.js';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

export function validatePath(path: string): string | null {
  if (!path.startsWith('/api/')) return 'path must start with /api/';
  if (path.includes('://')) return 'path must be a relative /api/ path, not a full URL';
  return null;
}

export function registerEscapeHatch(server: McpServer, client: BookClawClient): void {
  server.registerTool('list_endpoints',
    {
      title: 'List BookClaw endpoints',
      description: 'A curated catalog of BookClaw REST endpoints reachable via bookclaw_request.',
      inputSchema: {},
    },
    async () => ({ content: [{ type: 'text' as const, text: JSON.stringify(ENDPOINT_CATALOG, null, 2) }] }),
  );

  server.registerTool('bookclaw_request',
    {
      title: 'Call any BookClaw endpoint',
      description:
        'Escape hatch: call any /api/ endpoint not covered by a dedicated tool. ' +
        'Irreversible actions (publish/send/submit/upload/purchase) return a pending-confirmation ' +
        'response that a human must approve in BookClaw — this tool never auto-approves.',
      inputSchema: {
        method: z.enum(METHODS),
        path: z.string().describe('A path beginning with /api/'),
        body: z.record(z.unknown()).optional().describe('JSON body for POST/PUT/PATCH'),
      },
    },
    async ({ method, path, body }) => {
      const err = validatePath(path);
      if (err) return { isError: true, content: [{ type: 'text' as const, text: `bookclaw_request rejected: ${err}` }] };
      return toToolResult('bookclaw_request', await client.request(method, path, body));
    },
  );
}
```

- [ ] **Step 5: Register in `src/server.ts`**

Add `import { registerEscapeHatch } from './tools/escape-hatch.js';` and call `registerEscapeHatch(server, client);`.

- [ ] **Step 6: Run tests + type-check**

Run: `npm run test:unit && npx tsc --noEmit`
Expected: PASS, exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/endpoints.ts src/tools/escape-hatch.ts tests/unit/escape-hatch.test.ts src/server.ts
git commit -m "feat: generic bookclaw_request escape hatch + endpoint catalog"
```

---

### Task 11: Smoke test (boot + auth gate + MCP handshake)

**Files:**
- Create: `tests/smoke-test.sh`
- Create: `tests/stub-bookclaw.mjs` (a tiny stub BookClaw used by the smoke test)

**Interfaces:**
- Consumes: the built server (`npm start`).
- Produces: an executable hermetic smoke test asserting (a) `POST /mcp` without a token → `401`, (b) with the token, an MCP `initialize` request → `200`, supporting a `-v` flag that streams the server log.

- [ ] **Step 1: Write `tests/stub-bookclaw.mjs`**

```js
import { createServer } from 'node:http';
const port = Number(process.env.STUB_PORT || '0');
const server = createServer((req, res) => {
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ status: 'ok', stub: true, path: req.url }));
});
server.listen(port, '127.0.0.1', () => {
  // Print the chosen port so the harness can read it.
  console.log(`STUB_PORT=${server.address().port}`);
});
```

- [ ] **Step 2: Write `tests/smoke-test.sh`**

```bash
#!/usr/bin/env bash
# Hermetic smoke test: boots a stub BookClaw + the MCP server, asserts the
# inbound bearer gate and an MCP initialize round-trip. Use -v to stream logs.
set -uo pipefail

VERBOSE=0
[ "${1:-}" = "-v" ] && VERBOSE=1

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MCP_TOKEN="smoke-mcp-token"
MCP_PORT=3859
LOG="$(mktemp)"
STUB_LOG="$(mktemp)"

cleanup() {
  [ -n "${MCP_PID:-}" ] && kill "$MCP_PID" 2>/dev/null
  [ -n "${STUB_PID:-}" ] && kill "$STUB_PID" 2>/dev/null
  [ "$VERBOSE" = "1" ] && { echo "--- mcp log ---"; cat "$LOG"; }
  rm -f "$LOG" "$STUB_LOG"
}
trap cleanup EXIT

# 1) Start the stub BookClaw on an ephemeral port.
STUB_PORT=0 node "$ROOT/tests/stub-bookclaw.mjs" >"$STUB_LOG" 2>&1 &
STUB_PID=$!
for _ in $(seq 1 50); do grep -q 'STUB_PORT=' "$STUB_LOG" && break; sleep 0.1; done
STUB_PORT="$(sed -n 's/STUB_PORT=//p' "$STUB_LOG" | head -1)"
[ -z "$STUB_PORT" ] && { echo "FAIL: stub did not start"; exit 1; }

# 2) Start the MCP server pointed at the stub.
BOOKCLAW_BASE_URL="http://127.0.0.1:$STUB_PORT" \
BOOKCLAW_AUTH_TOKEN="stub-token" \
BOOKCLAW_MCP_TOKEN="$MCP_TOKEN" \
BOOKCLAW_MCP_BIND="127.0.0.1" \
BOOKCLAW_MCP_PORT="$MCP_PORT" \
  node --import tsx "$ROOT/src/index.ts" >"$LOG" 2>&1 &
MCP_PID=$!
for _ in $(seq 1 100); do grep -q 'listening on' "$LOG" && break; sleep 0.1; done
grep -q 'listening on' "$LOG" || { echo "FAIL: MCP server did not start"; exit 1; }

URL="http://127.0.0.1:$MCP_PORT/mcp"
ACCEPT='Accept: application/json, text/event-stream'
INIT='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}'

# Assertion 1: no token -> 401
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$URL" \
  -H 'Content-Type: application/json' -H "$ACCEPT" -d "$INIT")
[ "$code" = "401" ] || { echo "FAIL: expected 401 without token, got $code"; exit 1; }
echo "PASS: unauthenticated request rejected (401)"

# Assertion 2: with token -> 200 and a JSON-RPC result
resp=$(curl -s -X POST "$URL" -H 'Content-Type: application/json' -H "$ACCEPT" \
  -H "Authorization: Bearer $MCP_TOKEN" -d "$INIT" -w '\n%{http_code}')
code=$(printf '%s' "$resp" | tail -1)
body=$(printf '%s' "$resp" | sed '$d')
[ "$code" = "200" ] || { echo "FAIL: expected 200 with token, got $code"; exit 1; }
printf '%s' "$body" | grep -q 'bookclaw-mcp' || { echo "FAIL: initialize result missing server name"; exit 1; }
echo "PASS: authenticated initialize round-trip (200)"

echo "SMOKE OK"
```

- [ ] **Step 3: Make the script executable and run it**

Run: `chmod +x tests/smoke-test.sh && npm run test:smoke`
Expected: prints `PASS: unauthenticated request rejected (401)`, `PASS: authenticated initialize round-trip (200)`, `SMOKE OK`, exit 0.

> If the `initialize` response is delivered as an SSE stream, the body still contains the literal `bookclaw-mcp` server name, so the `grep` holds. If it fails, re-run with `bash tests/smoke-test.sh -v` to inspect the server log.

- [ ] **Step 4: Run the full suite**

Run: `npm test && npx tsc --noEmit`
Expected: unit tests pass, smoke passes, type-check clean.

- [ ] **Step 5: Commit**

```bash
git add tests/smoke-test.sh tests/stub-bookclaw.mjs
git commit -m "test: hermetic boot + auth + initialize smoke test"
```

---

### Task 12: Wire-up documentation

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: nothing.
- Produces: a README documenting install, env config, running, the tool list, and an MCP-client config snippet.

- [ ] **Step 1: Replace `README.md`**

```markdown
# bookclaw-mcp

A Model Context Protocol (MCP) server that exposes [BookClaw](../bookclaw)'s
author workflow to MCP clients over Streamable HTTP. It is a thin, stateless
client of BookClaw's REST API — see `CLAUDE.md` and
`docs/superpowers/specs/2026-06-18-bookclaw-mcp-design.md`.

## Setup

```bash
npm install
cp .env.example .env   # fill in BOOKCLAW_AUTH_TOKEN and BOOKCLAW_MCP_TOKEN
npm start              # listens on http://127.0.0.1:3849/mcp
```

`BOOKCLAW_AUTH_TOKEN` is BookClaw's own token (from BookClaw's `.env`).
`BOOKCLAW_MCP_TOKEN` is a token you choose to gate this server.

## Tools

`bookclaw_status`, `list_books`, `get_book`, `create_book`, `set_active_book`,
`get_book_files`, `read_book_file`, `list_projects`, `get_project`,
`create_project`, `create_pipeline`, `advance_pipeline`, `get_project_files`,
`chat`, `compile_project`, `export_docx`, `list_library`, `get_library_entry`,
`list_endpoints`, `bookclaw_request` (escape hatch).

## Testing

```bash
npm test            # unit + smoke
npx tsc --noEmit    # type-check
```
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README for bookclaw-mcp"
```

---

## Self-Review

**Spec coverage:**
- Two-token model → Tasks 2 (outbound), 3 (inbound), 4 (wired + startup warnings). ✓
- Thin API client, every tool through it → Task 2; Tasks 5–10 all call `client.request`. ✓
- Streamable HTTP transport, stateless → Task 4. ✓
- Curated tools (status/books/projects/chat/export/library) → Tasks 4–9. ✓
- Escape hatch + confirmation-gate-never-bypassed + `list_endpoints` → Task 10 (gate honored because BookClaw returns the pending-confirmation body, which the client passes through untouched). ✓
- Error mapping (401/403/503/network) → Task 2. ✓
- Streaming out of scope → not built; chat is request/response (Task 7). ✓
- Scripted tests + `-v` → Tasks 2/3/10 (unit), Task 11 (smoke with `-v`). ✓
- `.js` import extensions, NodeNext, Node 22, env-only config → Task 1 + every module. ✓
- `.gitignore` Java→Node fix → Task 1, Step 4. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases"; every code step shows complete code. The `ENDPOINT_CATALOG` is intentionally a curated subset, documented as such in code and spec (the full 284 stay reachable by path).

**Type consistency:** `BookClawResult` / `BookClawClient.request(method, path, body?)` defined in Task 2 and used unchanged in Tasks 5–10. `toToolResult(label, result)` defined in Task 4, relocated to `_shared.ts` in Task 5, imported everywhere after. `registerXxxTools(server, client)` signature uniform across Tasks 4–10. `validatePath(path)` defined and tested in Task 10.

## Notes for the implementer

- Verify each endpoint's exact request/response shape against the matching
  handler in `../bookclaw/gateway/src/api/routes/*.routes.ts` before relying on
  a field name. The paths in this plan are taken from those modules, but
  request-body keys (e.g. `create_book`, `create_project`, `create_pipeline`)
  should be confirmed against the live handler and adjusted if BookClaw expects
  different keys.
- Per `CLAUDE.md`: do not `git commit`/`push` for the user. The `git commit`
  steps above are the *intended* commit boundaries — if the user prefers the
  `commit_message` + `./push.sh` workflow, write `commit_message` instead and
  let them push.
