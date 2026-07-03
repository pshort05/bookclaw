import { join } from 'path';
import { existsSync, mkdirSync, renameSync } from 'fs';
import { ResearchGate } from '../services/research.js';
import { SkillLoader } from '../skills/loader.js';
import { AuthorOSService } from '../services/author-os.js';
import { LibraryService } from '../services/library.js';
import { WorldService } from '../services/world.js';
import { BookService } from '../services/book.js';
import { ReportsService } from '../services/reports.js';
import { appVersion } from './phase-01-config.js';
import { ROOT_DIR } from '../paths.js';
import type { BookClawGateway } from '../index.js';
import type { CostTracker } from '../services/costs.js';

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
  if (!existsSync(oldDir)) return;
  if (existsSync(newDir)) {
    // Never clobber the new overlay. Warn so the orphaned legacy dir is visible
    // rather than silently dropped (its skills are no longer loaded).
    console.warn('  ⚠ Skill overlay: legacy workspace/skills/ left in place because workspace/library/skills/ already exists — those legacy skills are NOT loaded; merge them manually if needed.');
    return;
  }
  try {
    mkdirSync(join(workspaceDir, 'library'), { recursive: true });
    renameSync(oldDir, newDir);
    console.log('  ✓ Migrated skill overlay workspace/skills → workspace/library/skills');
  } catch (err) {
    console.warn(`  ⚠ Skill-overlay migration skipped: ${(err as Error)?.message || err}`);
  }
}

/**
 * C1 fix (Flagship Plan 6 code review): re-apply every book's per-book cost
 * budget (manifest.costBudget) into the CostTracker. The tracker holds
 * budgets only in memory (set via setBookBudget); without this, a book
 * created on a prior boot has its budget silently forgotten on restart and
 * wouldExceedBook() never trips for it again. Fail-soft per book: an
 * unreadable manifest is skipped, not fatal to startup.
 */
export async function applyBookBudgets(books: BookService, costs: CostTracker): Promise<void> {
  for (const b of books.list()) {
    try {
      const opened = await books.open(b.slug);
      if (opened && typeof opened.manifest.costBudget === 'number') {
        costs.setBookBudget(b.slug, opened.manifest.costBudget);
      }
    } catch {
      // Fail-soft: skip a book whose manifest can't be read.
    }
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
  // Fail-soft (project convention): a library load failure must not abort
  // startup. loadKind() is the primary boundary — it isolates per-dir and
  // per-item failures so one unreadable overlay dir (e.g. wrong ownership under
  // a fresh host bind-mount before deploy.sh's chown) can't drop other kinds or
  // their built-ins. This try/catch is a backstop for anything unforeseen;
  // either way we degrade to whatever loaded and continue.
  try {
    await gw.library.loadAll();
    console.log(`  ✓ Library: ${gw.library.getLoadedCount()} templates (authors/voices/genres/pipelines/sections + skills)`);
  } catch (err) {
    console.warn(`  ⚠ Library: load failed, continuing with degraded library — ${(err as Error)?.message || err}`);
  }

  gw.world = new WorldService(gw.library, join(ROOT_DIR, 'workspace', 'library'));
  console.log(`  ✓ World repository: ${gw.world.list().length} world(s)`);

  gw.books = new BookService(
    join(ROOT_DIR, 'workspace', 'books'),
    gw.library,
    await appVersion(),
  );
  await gw.books.initialize();
  // World Repository Phase 3: wire the WorldService into BookService so world-doc
  // re-pull can read the library document side (setter injection, fail-soft).
  gw.books.setWorldService(gw.world);
  console.log(`  ✓ Books: ${gw.books.list().length} book(s)`);

  // C1 fix (Flagship Plan 6 code review): re-seed each book's cost budget into
  // the tracker on every boot — see applyBookBudgets doc comment above.
  await applyBookBudgets(gw.books, gw.costs);

  // Generic reports subsystem: analysis engines emit downloadable .md/.json
  // reports under each book's data/reports/ (keep-last-N per kind).
  gw.reports = new ReportsService(gw.books);
  console.log('  ✓ Reports: per-book downloadable report store ready');

  // ── Phase 3a: resolve the active book (seed a Default Book on first run) ──
  const activeBook = await gw.books.seedDefaultBook();
  console.log(`  ✓ Books: active book = ${activeBook ?? '(none)'}`);

  // Phase 3 read-path: let memory-search index EVERY book's data/ dir (generation
  // outputs land there per-book, not the legacy flat projects/ tree). Indexing
  // only the active book left concurrently-run books unsearchable (bug-review #24).
  gw.memorySearch?.setDataDirsResolver?.(() =>
    (gw.books?.list() ?? [])
      .map((b) => gw.books?.dataDirOf?.(b.slug) ?? null)
      .filter((d): d is string => !!d),
  );

  // ── Phase 3b: re-point the Author identity to the active book's snapshot ──
  // SoulService was constructed against workspace/soul/ in phase-03; once a book
  // is active it must read that book's templates/author/. Fail-soft inside
  // useBook() keeps the default Author if the snapshot is missing.
  const activeAuthorDir = gw.books.activeAuthorDir();
  if (activeAuthorDir) {
    await gw.soul.useBook(activeAuthorDir, gw.books.activeVoiceDir());
    console.log(`  ✓ Soul: using active book's Author + Voice ("${gw.soul.getName()}")`);
  }

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
