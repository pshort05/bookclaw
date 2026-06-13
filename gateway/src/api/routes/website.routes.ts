import { Application, Request, Response } from 'express';
import path from 'path';
import { addWaveDisclaimer, asyncHandler, requireApprovedConfirmation } from './_shared.js';

/** Website site registry — management layer over the static-site builder (render/deploy/books). */
export function mountWebsite(app: Application, gateway: any, baseDir: string): void {
  const services = gateway.getServices();

  // ═══════════════════════════════════════════════════════════
  // Website Site Registry (management layer over the static-site builder)
  // ═══════════════════════════════════════════════════════════

  /** GET /api/sites — list all registered sites + their freshness status. */
  app.get('/api/sites', (_req: Request, res: Response) => {
    if (!services.websiteSites) return res.status(503).json({ error: 'Site registry not initialized' });
    res.json({ sites: services.websiteSites.list() });
  });

  app.get('/api/sites/:siteId', (req: Request, res: Response) => {
    if (!services.websiteSites) return res.status(503).json({ error: 'Site registry not initialized' });
    const site = services.websiteSites.get(req.params.siteId);
    if (!site) return res.status(404).json({ error: 'Site not found' });
    res.json(site);
  });

  app.post('/api/sites', async (req: Request, res: Response) => {
    if (!services.websiteSites) return res.status(503).json({ error: 'Site registry not initialized' });
    const { config, linkedProjectIds, deploy } = req.body || {};
    if (!config?.slug || !config?.siteName || !config?.authorName || !config?.baseUrl) {
      return res.status(400).json({ error: 'config with slug, siteName, authorName, baseUrl required' });
    }
    try {
      const site = await services.websiteSites.create({ config, linkedProjectIds, deploy });
      res.json({ site });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Site create failed' });
    }
  });

  app.patch('/api/sites/:siteId', asyncHandler(async (req: Request, res: Response) => {
    if (!services.websiteSites) return res.status(503).json({ error: 'Site registry not initialized' });
    const site = await services.websiteSites.update(req.params.siteId, req.body || {});
    if (!site) return res.status(404).json({ error: 'Site not found' });
    res.json({ site });
  }));

  app.delete('/api/sites/:siteId', asyncHandler(async (req: Request, res: Response) => {
    if (!services.websiteSites) return res.status(503).json({ error: 'Site registry not initialized' });
    const removed = await services.websiteSites.delete(req.params.siteId);
    res.json({ success: removed });
  }));

  app.post('/api/sites/:siteId/link-project', asyncHandler(async (req: Request, res: Response) => {
    if (!services.websiteSites) return res.status(503).json({ error: 'Site registry not initialized' });
    const { projectId } = req.body || {};
    if (!projectId) return res.status(400).json({ error: 'projectId required' });
    const site = await services.websiteSites.linkProject(req.params.siteId, projectId);
    if (!site) return res.status(404).json({ error: 'Site not found' });
    res.json({ site });
  }));

  app.post('/api/sites/:siteId/unlink-project', asyncHandler(async (req: Request, res: Response) => {
    if (!services.websiteSites) return res.status(503).json({ error: 'Site registry not initialized' });
    const { projectId } = req.body || {};
    const site = await services.websiteSites.unlinkProject(req.params.siteId, projectId);
    if (!site) return res.status(404).json({ error: 'Site not found' });
    res.json({ site });
  }));

  /** Add or replace a book on a site (manual; the auto-hook does this on
   *  project completion when projects are linked). */
  app.post('/api/sites/:siteId/books', asyncHandler(async (req: Request, res: Response) => {
    if (!services.websiteSites) return res.status(503).json({ error: 'Site registry not initialized' });
    const book = req.body;
    if (!book?.title || !book?.blurb) return res.status(400).json({ error: 'book.title + book.blurb required' });
    const site = await services.websiteSites.autoAddBook(req.params.siteId, book);
    if (!site) return res.status(404).json({ error: 'Site not found' });
    res.json({ site });
  }));

  app.delete('/api/sites/:siteId/books/:bookSlug', asyncHandler(async (req: Request, res: Response) => {
    if (!services.websiteSites) return res.status(503).json({ error: 'Site registry not initialized' });
    const site = await services.websiteSites.removeBook(req.params.siteId, req.params.bookSlug);
    if (!site) return res.status(404).json({ error: 'Site not found' });
    res.json({ site });
  }));

  // ── Blog post management ──

  app.post('/api/sites/:siteId/blog-posts', asyncHandler(async (req: Request, res: Response) => {
    if (!services.websiteSites) return res.status(503).json({ error: 'Site registry not initialized' });
    const post = req.body;
    if (!post?.title || !post?.bodyHTML) return res.status(400).json({ error: 'post.title + post.bodyHTML required' });
    if (!post.slug) post.slug = String(post.title).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 80);
    if (!post.date) post.date = new Date().toISOString();
    const site = await services.websiteSites.addBlogPost(req.params.siteId, post);
    if (!site) return res.status(404).json({ error: 'Site not found' });
    res.json({ site });
  }));

  app.delete('/api/sites/:siteId/blog-posts/:postSlug', asyncHandler(async (req: Request, res: Response) => {
    if (!services.websiteSites) return res.status(503).json({ error: 'Site registry not initialized' });
    const site = await services.websiteSites.removeBlogPost(req.params.siteId, req.params.postSlug);
    if (!site) return res.status(404).json({ error: 'Site not found' });
    res.json({ site });
  }));

  /**
   * Draft a blog post from a project. Author reviews + edits + adds to site
   * via the /api/sites/:siteId/blog-posts endpoint above.
   *
   * Body: { siteId?, postType, projectId, excerptText?, authorAngle?, preferredProvider? }
   * If siteId is provided, the draft is auto-added to the site's blog queue
   * (unrendered + unpublished — author still has to render + deploy).
   */
  app.post('/api/blog-posts/draft', async (req: Request, res: Response) => {
    if (!services.blogPostDrafter) return res.status(503).json({ error: 'Blog drafter not initialized' });
    const { postType, projectId, excerptText, authorAngle, preferredProvider, siteId } = req.body || {};
    if (!postType || !projectId) return res.status(400).json({ error: 'postType + projectId required' });
    const validTypes = ['release_announcement', 'behind_the_scenes', 'excerpt', 'teaser'];
    if (!validTypes.includes(postType)) return res.status(400).json({ error: `postType must be one of: ${validTypes.join(', ')}` });

    const engine = gateway.getProjectEngine?.();
    const project = engine?.getProject(projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const persona = (project as any).personaId ? services.personas?.get?.((project as any).personaId) : null;

    // Pull artifacts: chapter summaries from ContextEngine if behind-the-scenes,
    // user-model narrative if available, voice signature if Style Clone has run.
    const artifacts: any = {};
    if ((postType === 'behind_the_scenes' || postType === 'release_announcement') && services.contextEngine) {
      try {
        const ctx = await services.contextEngine.loadContext(projectId);
        artifacts.chapterSummaries = (ctx?.summaries || []).map((s: any) => ({
          chapterNumber: s.chapterNumber,
          summary: s.summary || s.endingState || '',
        }));
      } catch { /* non-fatal */ }
    }
    if (postType === 'behind_the_scenes' && services.userModel) {
      const snap = services.userModel.getSnapshot();
      if (snap?.narrative?.text) artifacts.userModelNarrative = snap.narrative.text;
    }

    try {
      const result = await services.blogPostDrafter.draft(
        { postType, projectId, excerptText, authorAngle, preferredProvider },
        {
          id: project.id,
          title: project.title,
          description: project.description,
          type: project.type,
          genre: (project as any).context?.genre || persona?.genre,
          personaId: (project as any).personaId,
          authorName: persona?.penName,
          buyLinks: (project as any).context?.buyLinks,
          comps: (project as any).context?.comps,
          releaseDate: (project as any).context?.releaseDate,
        },
        artifacts,
        {
          aiComplete: (r: any) => services.aiRouter.complete(r),
          aiSelectProvider: (taskType: string) => services.aiRouter.selectProvider(taskType),
        },
      );

      // If a siteId was provided, auto-add the draft to that site's queue.
      if (siteId && services.websiteSites) {
        await services.websiteSites.addBlogPost(siteId, result.post);
      }

      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Draft failed' });
    }
  });

  // ── Render + deploy ──

  /** Render the site's HTML using the WebsiteBuilder. Sets lastRenderedAt. */
  app.post('/api/sites/:siteId/render', async (req: Request, res: Response) => {
    if (!services.websiteSites || !services.websiteBuilder) {
      return res.status(503).json({ error: 'Required services not initialized' });
    }
    const site = services.websiteSites.get(req.params.siteId);
    if (!site) return res.status(404).json({ error: 'Site not found' });
    try {
      const result = await services.websiteBuilder.build({
        config: site.config,
        books: site.books,
        blogPosts: site.blogPosts,
        aboutHTML: site.aboutHTML,
        contactHTML: site.contactHTML,
      });
      await services.websiteSites.markRendered(site.id);
      addWaveDisclaimer(res);
      res.json({ rendered: true, site, result });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Render failed' });
    }
  });

  // ── Deploy / publish are Wave-3 irreversible external side effects
  // (netlify/vercel/gh-pages/rsync) → gated through the ConfirmationGate, then
  // executed by the /api/sites/deploy/finalize endpoint after approval. Mirrors
  // the book-import gated-finalize pattern in books.routes.ts. ────────────────

  /** Run the actual deploy (and, for publish, the render) for an approved
   *  confirmation. Shared by the deploy + publish finalize path. */
  async function executeDeploy(
    site: any,
    deployConfig: any,
    withBuild: boolean,
  ): Promise<{ build?: any; deploy: any }> {
    let siteDir = path.join(baseDir, 'workspace', 'website', site.id);
    let build: any;
    if (withBuild) {
      build = await services.websiteBuilder.build({
        config: site.config,
        books: site.books,
        blogPosts: site.blogPosts,
        aboutHTML: site.aboutHTML,
        contactHTML: site.contactHTML,
      });
      await services.websiteSites.markRendered(site.id);
      siteDir = build.outputDir;
    }
    const deploy = await services.websiteDeploy.deploy({
      siteId: site.id,
      deployConfig,
      siteDir,
      workspaceDir: path.join(baseDir, 'workspace'),
    });
    if (deploy.success) await services.websiteSites.markDeployed(site.id);
    return withBuild ? { build, deploy } : { deploy };
  }

  /** Deploy the site using its configured target — creates a confirmation. */
  app.post('/api/sites/:siteId/deploy', asyncHandler(async (req: Request, res: Response) => {
    if (!services.websiteSites || !services.websiteDeploy) {
      return res.status(503).json({ error: 'Required services not initialized' });
    }
    const site = services.websiteSites.get(req.params.siteId);
    if (!site) return res.status(404).json({ error: 'Site not found' });
    if (!site.lastRenderedAt) {
      return res.status(400).json({ error: 'Site has not been rendered yet. POST /api/sites/:siteId/render first.' });
    }
    const deployConfig = req.body?.deployConfig || site.deploy;
    const target = deployConfig?.target || 'unknown';
    const conf = await services.confirmationGate.createRequest({
      service: 'website-deploy',
      action: 'deploy',
      platform: String(target),
      description: `Deploy site "${site.config?.siteName || site.id}" to ${target}`,
      payload: { siteId: site.id, action: 'deploy', deployConfig },
      riskLevel: 'high',
      isReversible: false,
    });
    addWaveDisclaimer(res);
    res.status(202).json({ pendingConfirmation: conf.id });
  }));

  /** Combined render + deploy — creates a confirmation. */
  app.post('/api/sites/:siteId/publish', asyncHandler(async (req: Request, res: Response) => {
    if (!services.websiteSites || !services.websiteBuilder || !services.websiteDeploy) {
      return res.status(503).json({ error: 'Required services not initialized' });
    }
    const site = services.websiteSites.get(req.params.siteId);
    if (!site) return res.status(404).json({ error: 'Site not found' });
    const deployConfig = req.body?.deployConfig || site.deploy;
    const target = deployConfig?.target || 'unknown';
    const conf = await services.confirmationGate.createRequest({
      service: 'website-deploy',
      action: 'publish',
      platform: String(target),
      description: `Render + deploy site "${site.config?.siteName || site.id}" to ${target}`,
      payload: { siteId: site.id, action: 'publish', deployConfig },
      riskLevel: 'high',
      isReversible: false,
    });
    addWaveDisclaimer(res);
    res.status(202).json({ pendingConfirmation: conf.id });
  }));

  /** Finalize an approved deploy/publish confirmation and run it. */
  app.post('/api/sites/deploy/finalize', asyncHandler(async (req: Request, res: Response) => {
    if (!services.websiteSites || !services.websiteBuilder || !services.websiteDeploy) {
      return res.status(503).json({ error: 'Required services not initialized' });
    }
    const id = typeof req.body?.confirmationId === 'string' ? req.body.confirmationId : '';
    const gate = requireApprovedConfirmation(services.confirmationGate, { id, expectedService: 'website-deploy' });
    if (!gate.ok) return res.status(gate.status).json({ error: gate.error });
    const { siteId, action, deployConfig } = gate.request.payload || {};
    const site = services.websiteSites.get(String(siteId));
    if (!site) return res.status(404).json({ error: 'Site not found' });
    try {
      const result = await executeDeploy(site, deployConfig, action === 'publish');
      await services.confirmationGate.recordOutcome(id, {
        success: !!result.deploy?.success,
        message: result.deploy?.success ? 'Deploy succeeded' : (result.deploy?.error || 'Deploy failed'),
        executedAt: new Date().toISOString(),
      });
      addWaveDisclaimer(res);
      res.json(result);
    } catch (err: any) {
      await services.confirmationGate.recordOutcome(id, {
        success: false, message: err?.message || 'Deploy failed', executedAt: new Date().toISOString(),
      }).catch(() => {});
      res.status(500).json({ error: err?.message || 'Deploy failed' });
    }
  }));

  /** Doctor — which deploy targets are usable on this machine.
   *  Lives at /api/site-deploy/doctor (NOT /api/sites/deploy-doctor) so
   *  it doesn't get shadowed by the `/api/sites/:siteId` parameter route. */
  app.get('/api/site-deploy/doctor', async (_req: Request, res: Response) => {
    if (!services.websiteDeploy) return res.status(503).json({ error: 'Deploy not initialized' });
    res.json(await services.websiteDeploy.doctor());
  });
}
