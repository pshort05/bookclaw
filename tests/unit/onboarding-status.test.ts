/**
 * Onboarding status (#11): pure-helper unit tests plus a real-express route
 * test (mountCore) driven by a fake gateway — mirrors the harness style in
 * tests/unit/gate-cadence-route.test.ts.
 *
 * Run: node --import tsx --test tests/unit/onboarding-status.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { AddressInfo } from 'net';
import {
  hasProviderKeyName,
  isVoiceProfileTemplate,
  computeOnboardingStatus,
} from '../../gateway/src/api/routes/onboarding-status.js';
import { mountCore } from '../../gateway/src/api/routes/core.routes.js';

// ── Pure helpers ─────────────────────────────────────────────────────────

test('hasProviderKeyName: true when a known provider key is present', () => {
  assert.equal(hasProviderKeyName(['gemini_api_key']), true);
  assert.equal(hasProviderKeyName(['deepseek_api_key']), true);
  assert.equal(hasProviderKeyName(['anthropic_api_key']), true);
  assert.equal(hasProviderKeyName(['openai_api_key']), true);
  assert.equal(hasProviderKeyName(['openrouter_api_key']), true);
});

test('hasProviderKeyName: false on empty list or unrelated keys', () => {
  assert.equal(hasProviderKeyName([]), false);
  assert.equal(hasProviderKeyName(['telegram_bot_token', 'discord_bot_token']), false);
});

test('hasProviderKeyName: together_api_key does NOT count (5-key list, no together)', () => {
  assert.equal(hasProviderKeyName(['together_api_key']), false);
});

test('isVoiceProfileTemplate: true for empty/whitespace content', () => {
  assert.equal(isVoiceProfileTemplate(''), true);
  assert.equal(isVoiceProfileTemplate('   \n  '), true);
});

test('isVoiceProfileTemplate: true when content contains the template marker', () => {
  assert.equal(isVoiceProfileTemplate('# Voice Profile\nStatus: Not Yet Analyzed\n'), true);
});

test('isVoiceProfileTemplate: false for real analyzed content', () => {
  assert.equal(isVoiceProfileTemplate('# Voice Profile\nSentence rhythm: varied, punchy.\n'), false);
});

// ── computeOnboardingStatus (direct, no HTTP) ───────────────────────────

function makeFakeServices(overrides: any = {}) {
  return {
    aiRouter: { getActiveProviders: () => [] },
    vault: { list: async () => [] as string[] },
    config: { get: (_path: string, def: any) => def },
    projectEngine: { listProjects: () => [] },
    books: { list: () => [] },
    ...overrides,
  };
}

test('computeOnboardingStatus: fail-soft — a throwing accessor still yields 200-shaped output with that item false', async () => {
  const baseDir = mkdtempSync(join(tmpdir(), 'onboarding-status-'));
  const services = makeFakeServices({
    aiRouter: { getActiveProviders: () => { throw new Error('router not ready'); } },
    vault: { list: async () => { throw new Error('vault locked'); } },
  });

  const status = await computeOnboardingStatus(services, baseDir);
  const aiItem = status.checklist.find(i => i.id === 'ai_provider');
  assert.ok(aiItem);
  assert.equal(aiItem!.done, false);
  assert.equal(status.firstRun, true);
});

// ── Route test: real express + mountCore + fake gateway ────────────────

async function harness(opts: {
  hasProvider?: boolean;
  voiceContent?: string | null; // null = file absent
  soulContent?: string | null;
  projects?: any[];
  books?: any[];
  telegramEnabled?: boolean;
  discordEnabled?: boolean;
  vaultKeys?: string[];
  throwingVault?: boolean;
} = {}) {
  const baseDir = mkdtempSync(join(tmpdir(), 'onboarding-status-route-'));
  const soulDir = join(baseDir, 'workspace', 'soul');
  mkdirSync(soulDir, { recursive: true });
  if (opts.voiceContent !== null && opts.voiceContent !== undefined) {
    writeFileSync(join(soulDir, 'VOICE-PROFILE.md'), opts.voiceContent);
  }
  if (opts.soulContent !== null && opts.soulContent !== undefined) {
    writeFileSync(join(soulDir, 'SOUL.md'), opts.soulContent);
  }

  const vaultKeys = opts.vaultKeys ?? [];
  const services = {
    aiRouter: { getActiveProviders: () => (opts.hasProvider ? [{ id: 'gemini' }] : []) },
    vault: {
      list: async () => {
        if (opts.throwingVault) throw new Error('vault unavailable');
        return vaultKeys;
      },
    },
    config: {
      get: (path: string, def: any) => {
        if (path === 'bridges.telegram.enabled') return opts.telegramEnabled ?? false;
        if (path === 'bridges.discord.enabled') return opts.discordEnabled ?? false;
        return def;
      },
    },
    books: { list: () => opts.books ?? [] },
    costs: { getStatus: () => ({}) },
    skills: {
      getLoadedCount: () => 0, getAuthorSkillCount: () => 0, getPremiumSkillCount: () => 0,
      getPremiumSkills: () => [], getSkillCatalog: () => [], getSkillsByCategory: () => ({}),
    },
    heartbeat: { getStats: () => ({}), getAutonomousStatus: () => ({}) },
    permissions: { preset: 'standard' },
    soul: { getName: () => 'Test' },
    personas: null,
  };

  const gateway = {
    getServices: () => services,
    getProjectEngine: () => ({ listProjects: () => opts.projects ?? [] }),
    handleDashboardCommand: async () => '',
    handleMessage: async () => {},
  };

  const app = express();
  app.use(express.json());
  mountCore(app as any, gateway, baseDir);
  const server = app.listen(0);
  await new Promise<void>((r) => server.once('listening', () => r()));
  const port = (server.address() as AddressInfo).port;
  return { url: `http://127.0.0.1:${port}/api/onboarding/status`, server };
}

test('/api/onboarding/status: no provider vs provider-present', async () => {
  const noProvider = await harness({ hasProvider: false });
  try {
    const res = await fetch(noProvider.url);
    assert.equal(res.status, 200);
    const body = await res.json();
    const item = body.checklist.find((i: any) => i.id === 'ai_provider');
    assert.equal(item.done, false);
  } finally {
    await new Promise<void>((r) => noProvider.server.close(() => r()));
  }

  const withProvider = await harness({ hasProvider: true, projects: [{ id: 'p1' }] });
  try {
    const res = await fetch(withProvider.url);
    const body = await res.json();
    const item = body.checklist.find((i: any) => i.id === 'ai_provider');
    assert.equal(item.done, true);
    assert.equal(body.firstRun, false, 'provider + project done => not firstRun');
  } finally {
    await new Promise<void>((r) => withProvider.server.close(() => r()));
  }
});

test('/api/onboarding/status: ai_provider falls back to vault key when router has none active', async () => {
  const { url, server } = await harness({ hasProvider: false, vaultKeys: ['gemini_api_key'] });
  try {
    const res = await fetch(url);
    const body = await res.json();
    const item = body.checklist.find((i: any) => i.id === 'ai_provider');
    assert.equal(item.done, true);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test('/api/onboarding/status: template voice profile vs analyzed voice profile', async () => {
  const template = await harness({ voiceContent: 'Status: Not Yet Analyzed\n' });
  try {
    const res = await fetch(template.url);
    const body = await res.json();
    const item = body.checklist.find((i: any) => i.id === 'voice_profile');
    assert.equal(item.done, false);
  } finally {
    await new Promise<void>((r) => template.server.close(() => r()));
  }

  const analyzed = await harness({ voiceContent: 'Sentence rhythm: varied, punchy.\n' });
  try {
    const res = await fetch(analyzed.url);
    const body = await res.json();
    const item = body.checklist.find((i: any) => i.id === 'voice_profile');
    assert.equal(item.done, true);
  } finally {
    await new Promise<void>((r) => analyzed.server.close(() => r()));
  }
});

test('/api/onboarding/status: soul absent/empty vs present with content', async () => {
  const empty = await harness({ soulContent: '   ' });
  try {
    const res = await fetch(empty.url);
    const body = await res.json();
    const item = body.checklist.find((i: any) => i.id === 'soul');
    assert.equal(item.done, false);
  } finally {
    await new Promise<void>((r) => empty.server.close(() => r()));
  }

  const present = await harness({ soulContent: 'You are a warm, meticulous author agent.' });
  try {
    const res = await fetch(present.url);
    const body = await res.json();
    const item = body.checklist.find((i: any) => i.id === 'soul');
    assert.equal(item.done, true);
  } finally {
    await new Promise<void>((r) => present.server.close(() => r()));
  }
});

test('/api/onboarding/status: empty vs populated projects/books', async () => {
  const empty = await harness({ projects: [], books: [] });
  try {
    const res = await fetch(empty.url);
    const body = await res.json();
    const item = body.checklist.find((i: any) => i.id === 'project');
    assert.equal(item.done, false);
  } finally {
    await new Promise<void>((r) => empty.server.close(() => r()));
  }

  const viaProjects = await harness({ projects: [{ id: 'p1' }], books: [] });
  try {
    const res = await fetch(viaProjects.url);
    const body = await res.json();
    assert.equal(body.checklist.find((i: any) => i.id === 'project').done, true);
  } finally {
    await new Promise<void>((r) => viaProjects.server.close(() => r()));
  }

  const viaBooks = await harness({ projects: [], books: [{ slug: 'my-book' }] });
  try {
    const res = await fetch(viaBooks.url);
    const body = await res.json();
    assert.equal(body.checklist.find((i: any) => i.id === 'project').done, true);
  } finally {
    await new Promise<void>((r) => viaBooks.server.close(() => r()));
  }
});

test('/api/onboarding/status: bridges on/off (telegram + discord)', async () => {
  const off = await harness({ telegramEnabled: false, discordEnabled: false, vaultKeys: [] });
  try {
    const res = await fetch(off.url);
    const body = await res.json();
    assert.equal(body.checklist.find((i: any) => i.id === 'telegram').done, false);
    assert.equal(body.checklist.find((i: any) => i.id === 'discord').done, false);
  } finally {
    await new Promise<void>((r) => off.server.close(() => r()));
  }

  const on = await harness({
    telegramEnabled: true,
    discordEnabled: true,
    vaultKeys: ['telegram_bot_token', 'discord_bot_token'],
  });
  try {
    const res = await fetch(on.url);
    const body = await res.json();
    assert.equal(body.checklist.find((i: any) => i.id === 'telegram').done, true);
    assert.equal(body.checklist.find((i: any) => i.id === 'discord').done, true);
  } finally {
    await new Promise<void>((r) => on.server.close(() => r()));
  }
});

test('/api/onboarding/status: enabled but no vault token still reports not-done (config alone is not enough)', async () => {
  const { url, server } = await harness({ telegramEnabled: true, vaultKeys: [] });
  try {
    const res = await fetch(url);
    const body = await res.json();
    assert.equal(body.checklist.find((i: any) => i.id === 'telegram').done, false);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test('/api/onboarding/status: fail-soft — a throwing vault still returns 200 with dependent items false', async () => {
  const { url, server } = await harness({ hasProvider: false, throwingVault: true, telegramEnabled: true });
  try {
    const res = await fetch(url);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.checklist.find((i: any) => i.id === 'ai_provider').done, false);
    assert.equal(body.checklist.find((i: any) => i.id === 'telegram').done, false);
    assert.equal(body.checklist.find((i: any) => i.id === 'discord').done, false);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
