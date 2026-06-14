/**
 * BookClaw API Routes
 * REST API for the dashboard and external integrations
 */

// NOTE: All /api/* endpoints are gated by bearer-token auth (and an optional
// source-IP allowlist) wired in gateway/src/index.ts — see the auth middleware
// there. The server bind defaults to 0.0.0.0 (LAN/Docker), NOT loopback, so
// do not assume localhost is a trust boundary. Auth can be disabled explicitly
// via BOOKCLAW_AUTH_DISABLED=1 (loud startup warning).

import { Application } from 'express';
import { mountCore } from './routes/core.routes.js';
import { mountSettings } from './routes/settings.routes.js';
import { mountProjects } from './routes/projects.routes.js';
import { mountDocuments } from './routes/documents.routes.js';
import { mountHeartbeat } from './routes/heartbeat.routes.js';
import { mountPersonas } from './routes/personas.routes.js';
import { mountMedia } from './routes/media.routes.js';
import { mountOps } from './routes/ops.routes.js';
import { mountExport } from './routes/export.routes.js';
import { mountWave } from './routes/wave.routes.js';
import { mountSeries } from './routes/series.routes.js';
import { mountKnowledge } from './routes/knowledge.routes.js';
import { mountWebsite } from './routes/website.routes.js';
import { mountAuthoring } from './routes/authoring.routes.js';
import { mountLibrary } from './routes/library.routes.js';
import { mountBooks } from './routes/books.routes.js';
import { mountBackups } from './routes/backups.routes.js';

/**
 * Mounts all REST API routes. This is a thin composition root: each feature
 * area lives in its own mounter under ./routes/ (see Level 1 refactor). Add a
 * new feature by creating a mountX(app, gateway, baseDir) module and calling it
 * here — do not grow this file back into a god factory.
 */
export function createAPIRoutes(app: Application, gateway: any, rootDir?: string): void {
  const baseDir = rootDir || process.cwd();

  // Health/status/chat/cost/audit/activity — see ./routes/core.routes.ts
  mountCore(app, gateway, baseDir);
  // Memory reset, vault key CRUD, config, Telegram — see ./routes/settings.routes.ts
  mountSettings(app, gateway, baseDir);
  // Project engine: templates/pipeline/auto-execute/files/compile — see ./routes/projects.routes.ts
  mountProjects(app, gateway, baseDir);
  // Document library + uploads + context engine — see ./routes/documents.routes.ts
  mountDocuments(app, gateway, baseDir);
  // Heartbeat, idle tasks, agent journal, native export, tool ingestion — see ./routes/heartbeat.routes.ts
  mountHeartbeat(app, gateway, baseDir);
  // Author persona CRUD + AI generation — see ./routes/personas.routes.ts
  mountPersonas(app, gateway, baseDir);
  // Internet research, image generation, TTS/audio — see ./routes/media.routes.ts
  mountMedia(app, gateway, baseDir);
  // Lessons, preferences, orchestrator — see ./routes/ops.routes.ts
  mountOps(app, gateway, baseDir);
  // KDP blurb, track-changes, external tools, cover, hub, beta reader — see ./routes/export.routes.ts
  mountExport(app, gateway, baseDir);
  // Wave 2 + Wave 3 (gated career agent) — see ./routes/wave.routes.ts
  mountWave(app, gateway, baseDir);
  mountSeries(app, gateway, baseDir);
  // Search, user-model, cron, auto-skill, judge, voices, research, structures, promises — see ./routes/knowledge.routes.ts
  mountKnowledge(app, gateway, baseDir);
  // Website site registry — see ./routes/website.routes.ts
  mountWebsite(app, gateway, baseDir);
  // Edit prompts (soul) + skills with hot-reload — see ./routes/authoring.routes.ts
  mountAuthoring(app, gateway, baseDir);
  // Read-only template library (book-container Phase 1) — see ./routes/library.routes.ts
  mountLibrary(app, gateway, baseDir);
  mountBooks(app, gateway, baseDir);
  // Backup & recovery (book-container Phase 11) — see ./routes/backups.routes.ts
  mountBackups(app, gateway, baseDir);
}
