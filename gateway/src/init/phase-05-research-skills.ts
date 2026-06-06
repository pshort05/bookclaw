import { join } from 'path';
import { existsSync, mkdirSync, renameSync } from 'fs';
import { ResearchGate } from '../services/research.js';
import { SkillLoader } from '../skills/loader.js';
import { AuthorOSService } from '../services/author-os.js';
import { LibraryService } from '../services/library.js';
import { ROOT_DIR } from '../paths.js';
import type { BookClawGateway } from '../index.js';

/**
 * Phases 5, 6, 6a, 6b: research gate, skills, SKILLS.txt reference, and
 * Author OS auto-discovery (synthetic skills registered when present).
 */
/**
 * One-time migration: the user skill overlay moved from workspace/skills/ to
 * workspace/library/skills/ when skills were folded into the template library
 * (book-container Phase 1). Move the legacy dir once; never clobber the new one.
 * Fail-soft: a migration error must not block startup.
 */
export function migrateSkillOverlay(workspaceDir: string): void {
  const oldDir = join(workspaceDir, 'skills');
  const newDir = join(workspaceDir, 'library', 'skills');
  if (!existsSync(oldDir) || existsSync(newDir)) return;
  try {
    mkdirSync(join(workspaceDir, 'library'), { recursive: true });
    renameSync(oldDir, newDir);
    console.log('  ✓ Migrated skill overlay workspace/skills → workspace/library/skills');
  } catch (err) {
    console.warn(`  ⚠ Skill-overlay migration skipped: ${(err as Error)?.message || err}`);
  }
}

export async function initResearchAndSkills(gw: BookClawGateway): Promise<void> {
  // ── Phase 5: Research Gate ──
  gw.research = new ResearchGate(
    join(ROOT_DIR, 'config', 'research-allowlist.json'),
    gw.audit
  );
  await gw.research.initialize();
  console.log(`  ✓ Research gate: ${gw.research.getAllowedDomainCount()} approved domains`);

  // ── Phase 6: Skills ──
  // Built-in skills (baked, read-only) + a user overlay under the persisted
  // workspace volume that overrides built-ins by name (survives Docker rebuilds).
  migrateSkillOverlay(join(ROOT_DIR, 'workspace'));
  gw.skills = new SkillLoader(join(ROOT_DIR, 'skills'), gw.permissions, join(ROOT_DIR, 'workspace', 'library', 'skills'));
  await gw.skills.loadAll();
  const premiumCount = gw.skills.getPremiumSkillCount();
  const premiumLabel = premiumCount > 0 ? `, ${premiumCount} premium ★` : '';
  console.log(`  ✓ Skills: ${gw.skills.getLoadedCount()} loaded (${gw.skills.getAuthorSkillCount()} author-specific${premiumLabel})`);

  gw.library = new LibraryService(
    join(ROOT_DIR, 'library'),
    join(ROOT_DIR, 'workspace', 'library'),
    gw.skills,
  );
  await gw.library.loadAll();
  console.log(`  ✓ Library: ${gw.library.getLoadedCount()} templates (authors/genres/pipelines/sections + skills)`);

  // ── Phase 6a: Auto-generate SKILLS.txt reference file ──
  await gw.writeSkillsReference(ROOT_DIR);

  // ── Phase 6b: Author OS Tools ──
  // Author OS is a SEPARATE project. If installed alongside BookClaw, we
  // auto-discover and integrate; otherwise BookClaw works fine without it.
  const homeDir = process.env.HOME || process.env.USERPROFILE || '~';
  const authorOSCandidates = [
    process.env.AUTHOR_OS_PATH || '',                           // Explicit env var (highest priority)
    '/app/author-os',                                           // Docker mount
    join(homeDir, 'author-os'),                                 // ~/author-os (Linux/macOS)
    join(homeDir, 'Author OS'),                                 // ~/Author OS (with space)
    join(ROOT_DIR, '..', 'Author OS'),                          // Sibling to BookClaw
    join(ROOT_DIR, '..', '..', 'Author OS'),                    // Automations/Author OS/ (Windows default)
    join(ROOT_DIR, '..', 'author-os'),                          // sibling lowercase
  ].filter(Boolean);
  const authorOSPath = authorOSCandidates.find(p => existsSync(p)) || '';
  gw.authorOS = new AuthorOSService(authorOSPath);
  if (authorOSPath) {
    await gw.authorOS.initialize();
    const osTools = gw.authorOS.getAvailableTools();
    if (osTools.length > 0) {
      console.log(`  ✓ Author OS: ${osTools.length} tools found at ${authorOSPath}`);
      console.log(`    (${osTools.join(', ')})`);

      // Auto-generate synthetic skills from Author OS tools.
      try {
        const synthSkills = await gw.authorOS.generateSyntheticSkills();
        const added = gw.skills.registerSynthetic(synthSkills);
        if (added > 0) {
          console.log(`  ✓ Author OS skills auto-registered: ${added} skill(s) (${synthSkills.map(s => s.name).join(', ')})`);
          // Refresh SKILLS.txt so the synthetic skills are visible to the AI's prompt context.
          await gw.writeSkillsReference(ROOT_DIR);
        }
      } catch (err) {
        console.warn(`  ⚠ Could not auto-generate Author OS skills: ${(err as Error)?.message || err}`);
      }
    } else {
      console.log(`  ℹ Author OS folder found at ${authorOSPath} but no recognized tools inside.`);
      console.log(`    Expected subfolders: "Author Workflow Engine", "Book Bible Engine", "Manuscript Autopsy", "AI Author Library".`);
    }
  } else {
    console.log('  ℹ Author OS: not installed (optional — BookClaw works without it).');
    console.log('    To enable: place the Author OS folder next to BookClaw, or set AUTHOR_OS_PATH in .env');
  }
}
