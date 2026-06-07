/**
 * BookClaw Soul Service
 * Loads and manages the three-part soul: personality, style guide, voice profile
 */

import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

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

  async load(): Promise<void> {
    // Reset loaded fields first so a re-point (useBook) fully replaces the
    // prior author instead of leaking values for files the new dir omits.
    this.personality = '';
    this.personalityOverride = '';
    this.styleGuide = '';
    this.voiceProfile = '';
    this.name = 'BookClaw';

    // Load personality
    const soulPath = join(this.soulDir, 'SOUL.md');
    if (existsSync(soulPath)) {
      this.personality = await readFile(soulPath, 'utf-8');
      // Extract name from first heading
      const nameMatch = this.personality.match(/^#\s+(.+)/m);
      if (nameMatch) this.name = nameMatch[1].trim();
    }

    // Load optional personality override (e.g., snarky, formal, etc.)
    // This file is user-created and NOT shipped with BookClaw
    const personalityPath = join(this.soulDir, 'PERSONALITY.md');
    if (existsSync(personalityPath)) {
      this.personalityOverride = await readFile(personalityPath, 'utf-8');
    }

    // Style + voice come from the Voice snapshot (templates/voice/); fall back to
    // the author dir when no separate voice dir is set (legacy/old-shape books).
    const styleBase = this.voiceDir ?? this.soulDir;
    const stylePath = join(styleBase, 'STYLE-GUIDE.md');
    if (existsSync(stylePath)) {
      this.styleGuide = await readFile(stylePath, 'utf-8');
    }

    const voicePath = join(styleBase, 'VOICE-PROFILE.md');
    if (existsSync(voicePath)) {
      this.voiceProfile = await readFile(voicePath, 'utf-8');
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
    let context = '';

    if (this.personality) {
      context += this.personality + '\n\n';
    }

    // Personality override comes right after soul — it modifies chat tone
    // without affecting writing output quality
    if (this.personalityOverride) {
      context += this.personalityOverride + '\n\n';
    }

    if (this.styleGuide) {
      context += '## Writing Style Guide\n\n' + this.styleGuide + '\n\n';
    }

    if (this.voiceProfile) {
      context += '## Author Voice Profile\n\n' + this.voiceProfile + '\n\n';
    }

    return context || 'You are BookClaw, a helpful writing assistant for authors.';
  }

  async updateVoiceProfile(analysis: string): Promise<void> {
    const voicePath = join(this.voiceDir ?? this.soulDir, 'VOICE-PROFILE.md');
    const { writeFile } = await import('fs/promises');
    await writeFile(voicePath, analysis);
    this.voiceProfile = analysis;
  }
}
