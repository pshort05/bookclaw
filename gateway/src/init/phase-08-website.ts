import { join } from 'path';
import { WebsiteSiteService } from '../services/website-sites.js';
import { BlogPostDrafterService } from '../services/blog-post-drafter.js';
import { WebsiteDeployService } from '../services/website-deploy.js';
import { OrchestratorService } from '../services/orchestrator.js';
import { ROOT_DIR } from '../paths.js';
import type { BookClawGateway } from '../index.js';

/**
 * Phase 6h: website management + the two project-completion hooks
 * (auto-add-book, and user-model/auto-skill observation), then Phase 6h2:
 * orchestrator (script manager).
 */
export async function initWebsiteAndOrchestrator(gw: BookClawGateway): Promise<void> {
  // ── Phase 6h: Website management — auto-add-book, blog drafter, deploy ──
  gw.websiteSites = new WebsiteSiteService(join(ROOT_DIR, 'workspace'));
  await gw.websiteSites.initialize();
  gw.blogPostDrafter = new BlogPostDrafterService();
  gw.websiteDeploy = new WebsiteDeployService();
  const sitesCount = gw.websiteSites.list().length;
  console.log(`  ✓ Website management: ${sitesCount} site${sitesCount === 1 ? '' : 's'} registered, blog drafter + deploy adapters ready`);

  // Register the project-completion hook for auto-add-book.
  // When a book-production project completes AND has linked sites, the book is
  // auto-added to each site's books list (idempotent on slug). Author still has
  // to render + deploy explicitly — auto-publishing would be too aggressive.
  gw.projectEngine.onProjectCompleted(async (project: any) => {
    try {
      const isBookProject = project.type === 'book-production' || project.type === 'novel-pipeline';
      if (!isBookProject) return;
      const linkedSites = gw.websiteSites.findSitesForProject(project.id);
      if (linkedSites.length === 0) return;

      const persona = project.personaId ? gw.personas.get?.(project.personaId) : null;
      const authorName = persona?.penName || 'BookClaw';
      const slug = String(project.title || 'untitled').toLowerCase()
        .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

      const book: import('../services/website-builder.js').WebsiteBook = {
        slug,
        title: project.title,
        subtitle: project.context?.subtitle,
        blurb: gw.escapeBasicHTML(String(project.description || '')),
        releaseDate: new Date().toISOString().split('T')[0],
        seriesName: project.context?.seriesName,
        seriesNumber: project.context?.seriesNumber,
        genre: project.context?.genre,
        formats: ['ebook'],
      };

      for (const site of linkedSites) {
        await gw.websiteSites.autoAddBook(site.id, book);
        gw.activityLog.log({
          type: 'file_saved',
          source: 'internal',
          goalId: project.id,
          message: `Auto-added "${project.title}" to site "${site.config.siteName}". Render + deploy when ready.`,
          metadata: { siteId: site.id, bookSlug: slug, authorName },
        });
      }
    } catch (err) {
      console.warn('  [website-sites] auto-add-book hook failed:', (err as Error)?.message || err);
    }
  });

  // ── Wire project-completion hooks ──
  // When a project finishes, observe the event for the user model AND give the
  // auto-skill drafter a chance to capture the workflow.
  gw.projectEngine.onProjectCompleted((project: any) => {
    // User-model observation
    try {
      gw.userModel?.observe({
        type: 'project_completed',
        metadata: { projectId: project.id, type: project.type, stepCount: project.steps?.length || 0 },
        personaId: project.personaId || gw.memory.getActivePersonaId(),
      });
    } catch { /* never block completion */ }
    // Auto-skill draft (fire-and-forget; AI may take a few seconds)
    gw.autoSkill?.maybeDraftFromProject({
      id: project.id,
      type: project.type,
      title: project.title,
      description: project.description,
      steps: project.steps || [],
    }).catch(err => console.error('[auto-skill] draft error:', err));
  });

  // ── Phase 6h2: Orchestrator (script manager) ──
  gw.orchestrator = new OrchestratorService(join(ROOT_DIR, 'workspace'));
  await gw.orchestrator.initialize();
  const scriptCount = gw.orchestrator.getConfigs().length;
  console.log(`  ✓ Orchestrator: ${scriptCount} script(s) configured`);
  await gw.orchestrator.autoStartAll();
  gw.orchestrator.startHealthCheck();
}
