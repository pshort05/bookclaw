/**
 * BookClaw Skill Loader
 * Discovers, validates, and loads skills from the skills directory
 */

import { readFile, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { PermissionManager } from '../security/permissions.js';
import { AI_PROVIDER_IDS } from '../ai/router.js';

/** Where a loaded skill came from: shipped (read-only), user workspace overlay, or runtime-generated. */
export type SkillSource = 'builtin' | 'workspace' | 'synthetic';

/** One phase of an executable (multi-step) skill — its own provider + model + settings. */
export interface SkillStep {
  name?: string;
  provider?: string;      // one of AI_PROVIDERS; absent → 'openrouter' at run time
  model?: string;         // provider model id; absent → provider default (router resolves)
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
    const st = s as { name?: unknown; provider?: unknown; model?: unknown; temperature?: unknown; prompt?: unknown };
    if (typeof st.prompt !== 'string' || !st.prompt.trim()) return null; // prompt is the only required field
    // Trust boundary: reject an unknown provider here (save/import time) rather than
    // letting it surface as a runtime "Provider X not found" on every skill run.
    if (typeof st.provider === 'string' && st.provider.trim() && !(AI_PROVIDER_IDS as readonly string[]).includes(st.provider)) return null;
    steps.push({
      ...(typeof st.name === 'string' ? { name: st.name } : {}),
      ...(typeof st.provider === 'string' && st.provider.trim() ? { provider: st.provider } : {}),
      ...(typeof st.model === 'string' && st.model.trim() ? { model: st.model } : {}),
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

// Skill-match token cap: matchSkills() used to inject the FULL body of every
// trigger-matched skill with no limit — some skill files run 15-23KB, so a
// message matching several of them could push tens of thousands of untracked
// chars into the system prompt. Rank matches by trigger-match quality, keep
// only the top MAX_MATCHED_SKILLS, and bound total injected content at
// CONTENT_BUDGET_CHARS (truncating/omitting as the budget runs out).
const MAX_MATCHED_SKILLS = 3;
const CONTENT_BUDGET_CHARS = 8000;
const TRUNCATION_MARKER = '\n[truncated]';
// Below this much remaining budget, omit the skill entirely rather than emit
// a near-empty truncated fragment.
const MIN_TRUNCATION_REMAINING = 50;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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
    const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
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

  /**
   * Score every skill against the input by trigger-match quality, sort
   * descending, and return the top MAX_MATCHED_SKILLS. Shared by matchSkills
   * and matchSkillNames so the two can never disagree on which skills (or
   * what order) were selected.
   *
   * Scoring: each trigger the input contains adds a base weight — a
   * word-bounded match (trigger surrounded by non-alphanumeric chars or
   * string edges) scores higher than a bare substring — plus a length bonus
   * for longer (more specific) triggers. A skill with multiple trigger hits
   * gets an additional bonus. Only skills with >=1 hit are candidates.
   */
  private selectTopSkills(input: string): Skill[] {
    const lower = input.toLowerCase();
    const scored: Array<{ skill: Skill; score: number }> = [];

    for (const [, skill] of this.skills) {
      let score = 0;
      let hits = 0;
      for (const trigger of skill.triggers) {
        const t = trigger.toLowerCase().trim();
        if (!t || !lower.includes(t)) continue;
        hits++;
        const wordBounded = new RegExp(`(^|[^a-z0-9])${escapeRegExp(t)}([^a-z0-9]|$)`).test(lower);
        score += (wordBounded ? 10 : 4) + Math.min(t.length, 30) / 3;
      }
      if (hits > 0) {
        score += (hits - 1) * 5; // multiple trigger hits are a stronger signal
        scored.push({ skill, score });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, MAX_MATCHED_SKILLS).map((s) => s.skill);
  }

  /**
   * Match skills against user input, ranked by match quality and capped at
   * MAX_MATCHED_SKILLS, with total injected content bounded by
   * CONTENT_BUDGET_CHARS so skill bodies can't bloat the system prompt
   * unbounded. Returns each selected skill's raw content (frontmatter +
   * body), truncated with a `[truncated]` marker if it would overflow the
   * remaining budget, or omitted once the budget is exhausted.
   */
  /**
   * The single ranked selection + budget walk shared by matchSkills and
   * matchSkillNames. Returns ONLY the skills actually emitted into the prompt
   * (whole or truncated), name paired with body — a skill omitted because the
   * budget was exhausted appears in neither, so the two public methods can never
   * report a skill whose content was not injected.
   */
  private assembleSkills(input: string): Array<{ name: string; body: string }> {
    const selected = this.selectTopSkills(input);
    const emitted: Array<{ name: string; body: string }> = [];
    let used = 0;

    for (const skill of selected) {
      const remaining = CONTENT_BUDGET_CHARS - used;
      if (remaining <= 0) {
        console.log(`  ⚠ Skill "${skill.name}" omitted — ${CONTENT_BUDGET_CHARS}-char prompt content budget exhausted`);
        continue;
      }

      if (skill.content.length <= remaining) {
        emitted.push({ name: skill.name, body: skill.content });
        used += skill.content.length;
      } else if (remaining > MIN_TRUNCATION_REMAINING) {
        const sliceLen = remaining - TRUNCATION_MARKER.length;
        emitted.push({ name: skill.name, body: skill.content.slice(0, sliceLen) + TRUNCATION_MARKER });
        used = CONTENT_BUDGET_CHARS;
        console.log(`  ⚠ Skill "${skill.name}" body truncated to fit ${CONTENT_BUDGET_CHARS}-char prompt budget`);
      } else {
        used = CONTENT_BUDGET_CHARS;
        console.log(`  ⚠ Skill "${skill.name}" omitted — ${CONTENT_BUDGET_CHARS}-char prompt content budget exhausted`);
      }
    }

    return emitted;
  }

  matchSkills(input: string): string[] {
    return this.assembleSkills(input).map((e) => e.body);
  }

  /**
   * Like matchSkills but returns the matched skills' NAMES, for activity logging
   * and UI display. matchSkills returns each skill's full markdown, whose first
   * line is the `---` YAML frontmatter delimiter — logging that yields "---"
   * instead of a name. Derives from the same emitted set as matchSkills (post
   * budget walk), so the two always agree on which skills were actually injected
   * — a budget-omitted skill is reported by neither.
   */
  matchSkillNames(input: string): string[] {
    return this.assembleSkills(input).map((e) => e.name);
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
