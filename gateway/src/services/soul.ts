/**
 * BookClaw Soul Service
 * Loads and manages the three-part soul: personality, style guide, voice profile
 */

import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

export class SoulService {
  private soulDir: string;
  private personality = '';
  private personalityOverride = '';
  private styleGuide = '';
  private voiceProfile = '';
  private name = 'BookClaw';

  constructor(soulDir: string) {
    this.soulDir = soulDir;
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

    // Load style guide
    const stylePath = join(this.soulDir, 'STYLE-GUIDE.md');
    if (existsSync(stylePath)) {
      this.styleGuide = await readFile(stylePath, 'utf-8');
    }

    // Load voice profile (learned from author's writing)
    const voicePath = join(this.soulDir, 'VOICE-PROFILE.md');
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
  async useBook(authorDir: string): Promise<void> {
    if (!authorDir || !existsSync(authorDir)) {
      console.warn(`  ⚠ Soul: author snapshot not found at "${authorDir}" — keeping current Author`);
      return;
    }
    const prev = this.soulDir;
    this.soulDir = authorDir;
    try {
      await this.load();
    } catch (err) {
      // Restore the previous source on a load error and keep the prior context.
      this.soulDir = prev;
      console.warn(`  ⚠ Soul: failed to load author snapshot at "${authorDir}" — keeping current Author: ${(err as Error)?.message || err}`);
    }
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
    const voicePath = join(this.soulDir, 'VOICE-PROFILE.md');
    const { writeFile } = await import('fs/promises');
    await writeFile(voicePath, analysis);
    this.voiceProfile = analysis;
  }
}
