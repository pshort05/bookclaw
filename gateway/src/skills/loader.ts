/**
 * BookClaw Skill Loader
 * Discovers, validates, and loads skills from the skills directory
 */

import { readFile, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { PermissionManager } from '../security/permissions.js';

/** Where a loaded skill came from: shipped (read-only), user workspace overlay, or runtime-generated. */
export type SkillSource = 'builtin' | 'workspace' | 'synthetic';

/** One phase of an executable (multi-step) skill — its own OpenRouter model + settings. */
export interface SkillStep {
  name?: string;
  model: string;          // OpenRouter model id
  temperature?: number;
  prompt: string;         // template: {{input}} {{previous}} {{guidance}}
}

export interface Skill {
  name: string;
  description: string;
  category: 'core' | 'author' | 'marketing' | 'premium' | 'ops' | 'toolkit';
  triggers: string[];
  permissions: string[];
  content: string;
  source: SkillSource;
  // Multi-step skills Phase A: present (≥1) → executable; absent → passive.
  steps?: SkillStep[];
  retries?: number;       // 0–4, per failing phase
}

/** Parse + validate a skill's sibling steps.json. Returns null when absent/invalid (→ passive). */
export function parseSteps(raw: string): { steps: SkillStep[]; retries: number } | null {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return null; }
  const p = parsed as { steps?: unknown; retries?: unknown };
  if (!Array.isArray(p.steps) || p.steps.length === 0) return null;
  const steps: SkillStep[] = [];
  for (const s of p.steps as unknown[]) {
    const st = s as { name?: unknown; model?: unknown; temperature?: unknown; prompt?: unknown };
    if (typeof st.model !== 'string' || !st.model.trim() || typeof st.prompt !== 'string' || !st.prompt.trim()) return null;
    steps.push({
      ...(typeof st.name === 'string' ? { name: st.name } : {}),
      model: st.model,
      ...(typeof st.temperature === 'number' ? { temperature: st.temperature } : {}),
      prompt: st.prompt,
    });
  }
  const retries = Math.max(0, Math.min(4, typeof p.retries === 'number' ? Math.floor(p.retries) : 0));
  return { steps, retries };
}

export interface SkillCatalogEntry {
  name: string;
  description: string;
  category: string;
  triggers: string[];
  premium: boolean;
  source: SkillSource;
}

export const SKILL_CATEGORIES = ['core', 'author', 'marketing', 'premium', 'ops', 'toolkit'] as const;

export class SkillLoader {
  private skillsDir: string;
  private workspaceSkillsDir: string | null;
  private permissions: PermissionManager;
  private skills: Map<string, Skill> = new Map();
  // Runtime synthetic skills (e.g. from Author OS tools), kept so a reload()
  // re-applies them after re-reading the on-disk skills.
  private syntheticInputs: Array<{ name: string; description: string; triggers: string[]; permissions?: string[] }> = [];

  constructor(skillsDir: string, permissions: PermissionManager, workspaceSkillsDir?: string) {
    this.skillsDir = skillsDir;
    this.permissions = permissions;
    this.workspaceSkillsDir = workspaceSkillsDir || null;
  }

  async loadAll(): Promise<void> {
    this.skills.clear();
    // Built-in skills (shipped, read-only — baked into the Docker image).
    await this.loadFromDir(this.skillsDir, 'builtin');
    // User overlay from the persisted workspace volume — overrides built-ins by
    // name, so edits survive Docker rebuilds and stay separate from shipped skills.
    if (this.workspaceSkillsDir) await this.loadFromDir(this.workspaceSkillsDir, 'workspace');
    // Re-apply runtime synthetic skills (without overriding authored files).
    this.applySynthetics();
  }

  /** Re-read all skills from disk (after an in-dashboard edit). Preserves synthetics. */
  async reload(): Promise<void> {
    await this.loadAll();
  }

  private async loadFromDir(baseDir: string, source: 'builtin' | 'workspace'): Promise<void> {
    for (const category of SKILL_CATEGORIES) {
      const categoryDir = join(baseDir, category);
      if (!existsSync(categoryDir)) continue;

      const entries = await readdir(categoryDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (entry.name.startsWith('{')) continue;

          const skillPath = join(categoryDir, entry.name, 'SKILL.md');
          if (existsSync(skillPath)) {
            try {
              const content = await readFile(skillPath, 'utf-8');
              const skill = this.parseSkill(content, entry.name, category, source);
              if (skill) {
                // Multi-step skills: a sibling steps.json makes the skill executable (fail-soft).
                const stepsPath = join(categoryDir, entry.name, 'steps.json');
                if (existsSync(stepsPath)) {
                  try {
                    const parsed = parseSteps(await readFile(stepsPath, 'utf-8'));
                    if (parsed) { skill.steps = parsed.steps; skill.retries = parsed.retries; }
                    else console.log(`  ⚠ Skill "${skill.name}": invalid steps.json — treating as passive`);
                  } catch { console.log(`  ⚠ Skill "${skill.name}": could not read steps.json — treating as passive`); }
                }
                this.skills.set(skill.name, skill);
                if (category === 'premium') {
                  console.log(`  ★ Premium skill loaded: ${skill.name}`);
                }
              }
            } catch (error) {
              console.error(`  ⚠ Failed to load skill: ${entry.name}`, error);
            }
          }
        }
      }
    }
  }

  /**
   * Register synthetic skills generated at runtime — e.g., from Author OS tools.
   * No SKILL.md file is required; the data is provided directly.
   * Synthetic skills get category 'author' and are merged into the catalog.
   */
  registerSynthetic(skills: Array<{
    name: string;
    description: string;
    triggers: string[];
    permissions?: string[];
  }>): number {
    let added = 0;
    for (const s of skills) {
      if (!s.name || !s.description || !Array.isArray(s.triggers) || s.triggers.length === 0) continue;
      // Remember the input so reload() can re-apply it after re-reading disk.
      if (!this.syntheticInputs.some(x => x.name === s.name)) {
        this.syntheticInputs.push({ name: s.name, description: s.description, triggers: s.triggers, permissions: s.permissions });
      }
      if (this.applySynthetic(s)) added++;
    }
    return added;
  }

  /** Re-apply remembered synthetic skills (used after a disk reload). */
  private applySynthetics(): void {
    for (const s of this.syntheticInputs) this.applySynthetic(s);
  }

  /** Add one synthetic skill unless an authored (file-based) skill already owns the name. */
  private applySynthetic(s: { name: string; description: string; triggers: string[]; permissions?: string[] }): boolean {
    if (this.skills.has(s.name)) return false;
    this.skills.set(s.name, {
      name: s.name,
      description: s.description,
      category: 'author',
      triggers: s.triggers,
      permissions: s.permissions || ['memory_read'],
      content: `# ${s.name}\n\n${s.description}\n\n_(Auto-generated from Author OS tools.)_`,
      source: 'synthetic',
    });
    return true;
  }

  private parseSkill(content: string, name: string, category: 'core' | 'author' | 'marketing' | 'premium' | 'ops' | 'toolkit', source: 'builtin' | 'workspace'): Skill | null {
    // Parse YAML frontmatter
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatterMatch) return null;

    const frontmatter = frontmatterMatch[1];
    const triggers: string[] = [];
    const permissions: string[] = [];
    let description = '';
    let currentSection = '';

    for (const line of frontmatter.split('\n')) {
      const trimmed = line.trim();

      // Track which YAML key we're under
      if (trimmed.match(/^\w/)) {
        if (trimmed.startsWith('description:')) {
          description = trimmed.replace('description:', '').trim();
          currentSection = 'description';
        } else if (trimmed.startsWith('triggers:')) {
          currentSection = 'triggers';
        } else if (trimmed.startsWith('permissions:')) {
          currentSection = 'permissions';
        } else {
          currentSection = '';
        }
        continue;
      }

      // Parse list items under the current section
      if (trimmed.startsWith('- ')) {
        const value = trimmed.replace(/^- ["']?|["']$/g, '').trim();
        if (currentSection === 'triggers') {
          if (value) triggers.push(value);
        } else if (currentSection === 'permissions') {
          permissions.push(value);
        }
      }
    }

    return { name, description, category, triggers, permissions, content, source };
  }

  matchSkills(input: string): string[] {
    const matched: string[] = [];
    const lower = input.toLowerCase();

    for (const [, skill] of this.skills) {
      for (const trigger of skill.triggers) {
        if (lower.includes(trigger.toLowerCase())) {
          matched.push(skill.content);
          break;
        }
      }
    }

    return matched;
  }

  getLoadedCount(): number {
    return this.skills.size;
  }

  getAuthorSkillCount(): number {
    return Array.from(this.skills.values()).filter(s => s.category === 'author').length;
  }

  getPremiumSkillCount(): number {
    return Array.from(this.skills.values()).filter(s => s.category === 'premium').length;
  }

  getPremiumSkills(): Array<{ name: string; description: string }> {
    return Array.from(this.skills.values())
      .filter(s => s.category === 'premium')
      .map(s => ({ name: s.name, description: s.description }));
  }

  /**
   * Return a lightweight catalog of all loaded skills (for AI task planning).
   * Includes name, description, triggers, category — but NOT the full content.
   */
  getSkillCatalog(): SkillCatalogEntry[] {
    return Array.from(this.skills.values()).map(s => ({
      name: s.name,
      description: s.description,
      category: s.category,
      triggers: s.triggers,
      premium: s.category === 'premium',
      source: s.source,
    }));
  }

  /**
   * Get a specific skill by name (returns full content for injection into prompt).
   */
  getSkillByName(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  /**
   * Get skills grouped by category for dashboard display.
   */
  getSkillsByCategory(): Record<string, Array<{ name: string; description: string }>> {
    const grouped: Record<string, Array<{ name: string; description: string }>> = {};
    for (const skill of this.skills.values()) {
      if (!grouped[skill.category]) grouped[skill.category] = [];
      grouped[skill.category].push({ name: skill.name, description: skill.description });
    }
    return grouped;
  }
}
