/**
 * BookClaw Soul Service
 * Loads and manages the three-part soul: personality, style guide, voice profile
 */

import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

interface SoulParts {
  personality: string;
  personalityOverride: string;
  styleGuide: string;
  voiceProfile: string;
}

/** Assemble the system-prompt string from four soul parts. Pure function; no I/O. */
function assembleSoulContext(parts: SoulParts): string {
  let context = '';
  if (parts.personality) {
    context += parts.personality + '\n\n';
  }
  if (parts.personalityOverride) {
    context += parts.personalityOverride + '\n\n';
  }
  if (parts.styleGuide) {
    context += '## Writing Style Guide\n\n' + parts.styleGuide + '\n\n';
  }
  if (parts.voiceProfile) {
    context += '## Author Voice Profile\n\n' + parts.voiceProfile + '\n\n';
  }
  return context || 'You are BookClaw, a helpful writing assistant for authors.';
}

export class SoulService {
  private soulDir: string;
  private readonly initialSoulDir: string;
  private voiceDir: string | null = null;
  private personality = '';
  private personalityOverride = '';
  private styleGuide = '';
  private voiceProfile = '';
  private name = 'BookClaw';

  constructor(soulDir: string) {
    this.soulDir = soulDir;
    this.initialSoulDir = soulDir;
  }

  /**
   * Read the four soul files from the given dirs into a SoulParts object.
   * Operates purely on locals — no writes to any instance field.
   */
  private async composeFrom(authorDir: string, voiceDir: string | null): Promise<SoulParts> {
    const parts: SoulParts = { personality: '', personalityOverride: '', styleGuide: '', voiceProfile: '' };

    const soulPath = join(authorDir, 'SOUL.md');
    if (existsSync(soulPath)) {
      parts.personality = await readFile(soulPath, 'utf-8');
    }

    const personalityPath = join(authorDir, 'PERSONALITY.md');
    if (existsSync(personalityPath)) {
      parts.personalityOverride = await readFile(personalityPath, 'utf-8');
    }

    const styleBase = voiceDir ?? authorDir;
    const stylePath = join(styleBase, 'STYLE-GUIDE.md');
    if (existsSync(stylePath)) {
      parts.styleGuide = await readFile(stylePath, 'utf-8');
    }

    const voicePath = join(styleBase, 'VOICE-PROFILE.md');
    if (existsSync(voicePath)) {
      parts.voiceProfile = await readFile(voicePath, 'utf-8');
    }

    return parts;
  }

  async load(): Promise<void> {
    // Reset loaded fields first so a re-point (useBook) fully replaces the
    // prior author instead of leaking values for files the new dir omits.
    this.personality = '';
    this.personalityOverride = '';
    this.styleGuide = '';
    this.voiceProfile = '';
    this.name = 'BookClaw';

    const parts = await this.composeFrom(this.soulDir, this.voiceDir);
    this.personality = parts.personality;
    this.personalityOverride = parts.personalityOverride;
    this.styleGuide = parts.styleGuide;
    this.voiceProfile = parts.voiceProfile;

    // Extract name from first heading of personality
    if (this.personality) {
      const nameMatch = this.personality.match(/^#\s+(.+)/m);
      if (nameMatch) this.name = nameMatch[1].trim();
    }
  }

  /** Re-read the soul/prompt files from disk (after an in-dashboard edit). */
  async reload(): Promise<void> {
    await this.load();
  }

  /**
   * Re-point this SoulService at a book's Author snapshot
   * (workspace/books/<slug>/templates/author/) and reload, so getFullContext()
   * now returns the active book's Author identity (book-container Phase 3b).
   *
   * Fail-soft: if the dir is missing/unreadable we keep the currently-loaded
   * Author rather than blanking it — generation must never lose its voice.
   * getFullContext() consumers are unchanged.
   */
  async useBook(authorDir: string, voiceDir: string | null): Promise<void> {
    if (!authorDir || !existsSync(authorDir)) {
      console.warn(`  ⚠ Soul: author snapshot not found at "${authorDir}" — keeping current Author`);
      return;
    }
    const prevSoul = this.soulDir;
    const prevVoice = this.voiceDir;
    this.soulDir = authorDir;
    this.voiceDir = voiceDir && existsSync(voiceDir) ? voiceDir : null;
    if (voiceDir && !existsSync(voiceDir)) {
      console.warn(`  ⚠ Soul: voice snapshot not found at "${voiceDir}" — falling back to the author dir for style (a new-shape book may have no style there)`);
    }
    try {
      await this.load();
    } catch (err) {
      // Restore the previous sources on a load error and keep the prior context.
      this.soulDir = prevSoul;
      this.voiceDir = prevVoice;
      console.warn(`  ⚠ Soul: failed to load author snapshot at "${authorDir}" — keeping current Author: ${(err as Error)?.message || err}`);
    }
  }

  /** Re-point back to the initial (workspace/soul) source — e.g. when no book is active. */
  async resetToInitial(): Promise<void> {
    this.soulDir = this.initialSoulDir;
    this.voiceDir = null;
    try { await this.load(); } catch { /* fail-soft: keep whatever is loaded */ }
  }

  getName(): string {
    return this.name;
  }

  getFullContext(): string {
    // Personality override comes right after soul — it modifies chat tone
    // without affecting writing output quality
    return assembleSoulContext({
      personality: this.personality,
      personalityOverride: this.personalityOverride,
      styleGuide: this.styleGuide,
      voiceProfile: this.voiceProfile,
    });
  }

  /**
   * Stateless composition path: returns the same string shape as getFullContext()
   * but reads from the given dirs rather than the singleton's current state.
   * Does NOT mutate any instance field — safe to call concurrently with
   * other books running against this singleton.
   *
   * Fail-soft: if authorDir is falsy/absent, or a read fails mid-run (permission,
   * corruption), returns '' so the caller can fall back to getFullContext()
   * instead of rejecting the in-flight step. Called per generation step at
   * runtime, so a transient FS error must degrade, not crash the pipeline.
   */
  async composeForBook(authorDir: string, voiceDir: string | null): Promise<string> {
    if (!authorDir || !existsSync(authorDir)) {
      return '';
    }
    try {
      const parts = await this.composeFrom(authorDir, voiceDir);
      return assembleSoulContext(parts);
    } catch (err) {
      console.warn(`  ⚠ Soul: composeForBook failed to read "${authorDir}" — falling back to global Author: ${(err as Error)?.message || err}`);
      return '';
    }
  }

  async updateVoiceProfile(analysis: string): Promise<void> {
    const voicePath = join(this.voiceDir ?? this.soulDir, 'VOICE-PROFILE.md');
    const { writeFile } = await import('fs/promises');
    await writeFile(voicePath, analysis);
    this.voiceProfile = analysis;
  }
}
