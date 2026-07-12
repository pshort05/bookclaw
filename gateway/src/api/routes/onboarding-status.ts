import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

/**
 * Read-only first-run checklist (Author HQ onboarding). Pure aggregate over
 * existing services (vault, AI router, soul files, projects/books, bridge
 * config) — no new state is introduced here. Every signal is independently
 * guarded so one failing check (e.g. a missing workspace/soul directory on a
 * very first boot) can't 500 the whole endpoint; it just reports that item
 * as not-done.
 */

export interface ChecklistItem {
  id: string;
  label: string;
  done: boolean;
  hint: string;
}

export interface OnboardingStatus {
  firstRun: boolean;
  checklist: ChecklistItem[];
}

/**
 * Vault key names that indicate an AI provider is configured — mirrors this
 * repo's 5-provider AI router (gateway/src/ai/router.ts): Gemini, DeepSeek,
 * Claude/Anthropic, OpenAI, OpenRouter. Ollama is free/local and has no key.
 */
export const PROVIDER_KEY_NAMES = [
  'gemini_api_key', 'deepseek_api_key', 'anthropic_api_key', 'openai_api_key', 'openrouter_api_key',
] as const;

/** True if any of the given vault key names is a known AI provider key. */
export function hasProviderKeyName(keys: string[]): boolean {
  return keys.some(k => (PROVIDER_KEY_NAMES as readonly string[]).includes(k));
}

/**
 * The status line present in both the shipped VOICE-PROFILE template and an
 * un-analyzed live VOICE-PROFILE.md — SoulService overwrites the file with
 * real content once a manuscript has been analyzed, so this marker's
 * presence is a reliable "not yet analyzed" signal.
 */
const VOICE_PROFILE_TEMPLATE_MARKER = 'Not Yet Analyzed';

/**
 * True if `content` is the un-analyzed template (or empty) — i.e. the voice
 * profile has NOT been populated by real analysis yet.
 */
export function isVoiceProfileTemplate(content: string): boolean {
  if (!content || !content.trim()) return true;
  return content.includes(VOICE_PROFILE_TEMPLATE_MARKER);
}

/**
 * Computes the onboarding checklist. `services` is the gateway's service
 * bag (`gateway.getServices()`) with `projectEngine` folded in by the caller
 * (see core.routes.ts) since it lives behind a separate gateway accessor.
 */
export async function computeOnboardingStatus(services: any, baseDir: string): Promise<OnboardingStatus> {
  const checklist: ChecklistItem[] = [];

  // ── 1. At least one AI provider active (vault key fallback) ──
  let hasProvider = false;
  try {
    const active = services.aiRouter.getActiveProviders();
    hasProvider = Array.isArray(active) && active.length > 0;
  } catch {
    // Fall back to a raw vault check below if the router isn't ready yet.
  }
  if (!hasProvider) {
    try {
      const keys: string[] = await services.vault.list();
      hasProvider = hasProviderKeyName(keys);
    } catch {
      hasProvider = false;
    }
  }
  checklist.push({
    id: 'ai_provider',
    label: 'Connect an AI provider',
    done: hasProvider,
    hint: hasProvider
      ? 'At least one AI provider is active.'
      : 'Add a free Gemini key, run Ollama locally, or add a paid key in Settings → API Keys.',
  });

  // ── 2. Voice profile analyzed (file exists AND isn't the shipped template) ──
  let voiceAnalyzed = false;
  try {
    const voicePath = join(baseDir, 'workspace', 'soul', 'VOICE-PROFILE.md');
    if (existsSync(voicePath)) {
      const content = await readFile(voicePath, 'utf-8');
      voiceAnalyzed = !isVoiceProfileTemplate(content);
    }
  } catch {
    voiceAnalyzed = false;
  }
  checklist.push({
    id: 'voice_profile',
    label: 'Analyze your writing voice',
    done: voiceAnalyzed,
    hint: voiceAnalyzed
      ? 'Voice profile is analyzed and active.'
      : 'Send a 5,000+ word writing sample and say "Learn my style from this."',
  });

  // ── 3. Soul / identity present (SOUL.md exists and has content) ──
  let soulPresent = false;
  try {
    const soulPath = join(baseDir, 'workspace', 'soul', 'SOUL.md');
    if (existsSync(soulPath)) {
      const content = await readFile(soulPath, 'utf-8');
      soulPresent = content.trim().length > 0;
    }
  } catch {
    soulPresent = false;
  }
  checklist.push({
    id: 'soul',
    label: 'Set up your agent identity',
    done: soulPresent,
    hint: soulPresent
      ? 'SOUL.md is present.'
      : 'BookClaw ships with a default SOUL.md — customize it in workspace/soul/SOUL.md if you want a different personality.',
  });

  // ── 4. At least one project or book created ──
  let hasProject = false;
  try {
    const projects = services.projectEngine?.listProjects?.() ?? [];
    const books = services.books?.list?.() ?? [];
    hasProject = (Array.isArray(projects) && projects.length > 0) || (Array.isArray(books) && books.length > 0);
  } catch {
    hasProject = false;
  }
  checklist.push({
    id: 'project',
    label: 'Create your first project',
    done: hasProject,
    hint: hasProject
      ? 'At least one project or book exists.'
      : 'Start a novel, book bible, or blog post from the Projects panel.',
  });

  // ── 5. (Optional) Telegram connected ──
  let telegramConnected = false;
  try {
    const enabled = services.config.get('bridges.telegram.enabled', false);
    const keys: string[] = await services.vault.list();
    telegramConnected = Boolean(enabled) && keys.includes('telegram_bot_token');
  } catch {
    telegramConnected = false;
  }
  checklist.push({
    id: 'telegram',
    label: 'Connect Telegram (optional)',
    done: telegramConnected,
    hint: telegramConnected
      ? 'Telegram bridge is connected.'
      : 'Optional — connect Telegram in Settings to write from your phone.',
  });

  // ── 6. (Optional) Discord connected ──
  let discordConnected = false;
  try {
    const enabled = services.config.get('bridges.discord.enabled', false);
    const keys: string[] = await services.vault.list();
    discordConnected = Boolean(enabled) && keys.includes('discord_bot_token');
  } catch {
    discordConnected = false;
  }
  checklist.push({
    id: 'discord',
    label: 'Connect Discord (optional)',
    done: discordConnected,
    hint: discordConnected
      ? 'Discord bridge is connected.'
      : 'Optional — connect Discord in Settings to write from your server.',
  });

  return {
    firstRun: !(hasProvider && hasProject),
    checklist,
  };
}
