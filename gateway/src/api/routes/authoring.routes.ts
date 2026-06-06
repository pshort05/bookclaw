import { Application, Request, Response } from 'express';
import { join } from 'path';
import { readFile, writeFile, mkdir, rm } from 'fs/promises';
import { existsSync } from 'fs';
import { safePath } from './_shared.js';

/**
 * Authoring endpoints: edit the author **prompts** (workspace/soul/*.md) and
 * **skills** (SKILL.md) from the dashboard, with hot-reload — no redeploy.
 *
 * Persistence model: built-in skills (shipped in skills/) are read-only; user
 * edits/new skills are written to the persisted workspace/skills/** overlay,
 * which SkillLoader merges over the built-ins by name. Prompt files already
 * live in workspace/soul/. All writes are path-whitelisted via safePath; these
 * are internal prompt files (no external side effect, so no confirmation gate).
 */
export function mountAuthoring(app: Application, gateway: any, baseDir: string): void {
  const services = gateway.getServices();
  const soulDir = join(baseDir, 'workspace', 'soul');
  const wsSkillsDir = join(baseDir, 'workspace', 'library', 'skills');

  const PROMPT_FILES = ['SOUL.md', 'STYLE-GUIDE.md', 'VOICE-PROFILE.md', 'PERSONALITY.md'];
  const SKILL_CATEGORIES = ['core', 'author', 'marketing', 'ops'];

  // ── Prompts (author identity) ──────────────────────────────────────────────

  app.get('/api/prompts', async (_req: Request, res: Response) => {
    const files = [];
    for (const file of PROMPT_FILES) {
      const p = join(soulDir, file);
      const exists = existsSync(p);
      files.push({ file, exists, content: exists ? await readFile(p, 'utf-8') : '' });
    }
    res.json({ files });
  });

  app.put('/api/prompts/:file', async (req: Request, res: Response) => {
    const file = String(req.params.file);
    if (!PROMPT_FILES.includes(file)) {
      return res.status(400).json({ error: `Unknown prompt file. One of: ${PROMPT_FILES.join(', ')}` });
    }
    const { content } = req.body || {};
    if (typeof content !== 'string') return res.status(400).json({ error: 'content (string) required' });
    const dest = safePath(soulDir, file);
    if (!dest) return res.status(403).json({ error: 'Path traversal blocked' });
    try {
      await mkdir(soulDir, { recursive: true });
      await writeFile(dest, content, 'utf-8');
      await services.soul.reload();
      res.json({ success: true, file });
    } catch (error) {
      res.status(500).json({ error: 'Failed to save prompt: ' + String(error) });
    }
  });

  // ── Skills ──────────────────────────────────────────────────────────────────

  // Catalog of all loaded skills (built-in + workspace), each tagged with source.
  app.get('/api/skills', (_req: Request, res: Response) => {
    res.json({ skills: services.skills.getSkillCatalog() });
  });

  // Full content of one skill (for viewing / using as an edit template).
  app.get('/api/skills/:name', (req: Request, res: Response) => {
    const skill = services.skills.getSkillByName(String(req.params.name));
    if (!skill) return res.status(404).json({ error: 'Skill not found' });
    res.json({ skill });
  });

  // Create or update a skill in the workspace overlay (overrides a built-in of
  // the same name). body: { category, content } where content is the full
  // SKILL.md (YAML frontmatter + markdown body).
  app.put('/api/skills/:name', async (req: Request, res: Response) => {
    const name = String(req.params.name);
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(name)) {
      return res.status(400).json({ error: 'Invalid skill name (lowercase letters, digits, hyphens)' });
    }
    const { category, content } = req.body || {};
    if (!SKILL_CATEGORIES.includes(category)) {
      return res.status(400).json({ error: `category must be one of: ${SKILL_CATEGORIES.join(', ')}` });
    }
    if (typeof content !== 'string' || !/^---\n[\s\S]*?\n---/.test(content)) {
      return res.status(400).json({ error: 'content must be a SKILL.md starting with YAML frontmatter (--- … ---)' });
    }
    if (!/\bdescription\s*:/.test(content) || !/\btriggers\s*:/.test(content)) {
      return res.status(400).json({ error: 'frontmatter must include description and triggers' });
    }
    const dir = safePath(wsSkillsDir, join(category, name));
    if (!dir) return res.status(403).json({ error: 'Path traversal blocked' });
    try {
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'SKILL.md'), content, 'utf-8');
      await services.skills.reload();
      res.json({ success: true, name, category, source: 'workspace' });
    } catch (error) {
      res.status(500).json({ error: 'Failed to save skill: ' + String(error) });
    }
  });

  // Delete a skill — workspace (user) skills only; built-ins are read-only.
  // Removing a workspace skill that shadowed a built-in reverts to the built-in.
  app.delete('/api/skills/:name', async (req: Request, res: Response) => {
    const name = String(req.params.name);
    const skill = services.skills.getSkillByName(name);
    if (!skill) return res.status(404).json({ error: 'Skill not found' });
    if (skill.source !== 'workspace') {
      return res.status(400).json({ error: 'Only workspace (user) skills can be deleted; built-in skills are read-only' });
    }
    const dir = safePath(wsSkillsDir, join(skill.category, name));
    if (!dir) return res.status(403).json({ error: 'Path traversal blocked' });
    try {
      await rm(dir, { recursive: true, force: true });
      await services.skills.reload();
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to delete skill: ' + String(error) });
    }
  });

  // Manual reload (re-read prompts + skills from disk).
  app.post('/api/authoring/reload', async (_req: Request, res: Response) => {
    await services.skills.reload();
    await services.soul.reload();
    res.json({ success: true, skills: services.skills.getLoadedCount() });
  });
}
