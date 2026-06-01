import { Application, Request, Response } from 'express';
import path from 'path';
import { upload, makeGatherChapters } from './_shared.js';

/** Export-side features: KDP blurb, Track Changes (DOCX roundtrip), external tool wrappers, cover typography, manuscript hub, beta reader + dialogue auditor. */
export function mountExport(app: Application, gateway: any, baseDir: string): void {
  const services = gateway.getServices();
  const gatherChapters = makeGatherChapters(baseDir);

  // ═══════════════════════════════════════════════════════════
  // KDP Blurb Export
  // ═══════════════════════════════════════════════════════════

  // Export an arbitrary blurb (doesn't require a project)
  app.post('/api/kdp/export-blurb', (req: Request, res: Response) => {
    const exporter = services.kdpExporter;
    if (!exporter) return res.status(503).json({ error: 'KDP exporter not initialized' });
    const { blurb } = req.body || {};
    if (!blurb || typeof blurb !== 'string') {
      return res.status(400).json({ error: 'blurb (string) required' });
    }
    try {
      const result = exporter.exportBlurb(blurb);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Export failed' });
    }
  });

  // ═══════════════════════════════════════════════════════════
  // Track Changes — DOCX editor roundtrip
  // ═══════════════════════════════════════════════════════════

  // Upload an edited .docx; return the structured diff report.
  app.post('/api/track-changes/parse', upload.single('file'), async (req: Request, res: Response) => {
    const tc = services.trackChanges;
    if (!tc) return res.status(503).json({ error: 'Track-changes service not initialized' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const ext = '.' + (req.file.originalname.split('.').pop() || '').toLowerCase();
    if (ext !== '.docx') {
      return res.status(400).json({ error: 'Only .docx files are supported for track-changes parsing' });
    }

    try {
      const report = tc.parseDocx(req.file.buffer);
      // Cache the file on disk so the apply-decisions endpoint can reuse it.
      const { mkdir: mkd, writeFile: wf } = await import('fs/promises');
      const cacheDir = path.join(baseDir, 'workspace', 'tmp', 'track-changes');
      await mkd(cacheDir, { recursive: true });
      // Sanitize filename to prevent traversal.
      const safeName = req.file.originalname
        .replace(/[\x00-\x1f]/g, '')
        .replace(/[\\/:*?"<>|]/g, '_')
        .replace(/\.\.+/g, '_')
        .slice(0, 200);
      const cacheKey = `${Date.now()}-${safeName}`;
      await wf(path.join(cacheDir, cacheKey), req.file.buffer);
      res.json({ cacheKey, report });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Parse failed' });
    }
  });

  // Apply accept/reject decisions to produce clean Markdown.
  app.post('/api/track-changes/apply', async (req: Request, res: Response) => {
    const tc = services.trackChanges;
    if (!tc) return res.status(503).json({ error: 'Track-changes service not initialized' });

    const { cacheKey, decisions } = req.body || {};
    if (!cacheKey || !decisions || typeof decisions !== 'object') {
      return res.status(400).json({ error: 'cacheKey (from /parse) and decisions ({ [changeId]: "accepted"|"rejected" }) required' });
    }

    // Validate cacheKey — must match the expected format and stay inside the tmp dir.
    if (!/^[\d]+-[^\\/]+$/.test(cacheKey)) {
      return res.status(400).json({ error: 'Invalid cacheKey' });
    }

    const { readFile: rf } = await import('fs/promises');
    const { existsSync: ex } = await import('fs');
    const cachePath = path.join(baseDir, 'workspace', 'tmp', 'track-changes', cacheKey);
    if (!ex(cachePath)) return res.status(404).json({ error: 'Cached upload not found. Re-upload and try again.' });

    try {
      const buffer = await rf(cachePath);
      const decisionMap = new Map<string, 'accepted' | 'rejected' | 'pending'>();
      for (const [id, status] of Object.entries(decisions)) {
        if (status === 'accepted' || status === 'rejected' || status === 'pending') {
          decisionMap.set(id, status);
        }
      }
      const markdown = tc.applyDecisions(buffer, decisionMap);
      res.json({ markdown, charCount: markdown.length, wordCount: markdown.split(/\s+/).filter(Boolean).length });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Apply failed' });
    }
  });

  // ═══════════════════════════════════════════════════════════
  // External Tool Wrappers — sibling Python apps in ../Automations/
  // ═══════════════════════════════════════════════════════════

  app.post('/api/projects/:id/pacing-heatmap', async (req: Request, res: Response) => {
    const tools = services.externalTools;
    if (!tools) return res.status(503).json({ error: 'External tools not initialized' });

    const engine = gateway.getProjectEngine?.();
    const project = engine?.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const chapters = await gatherChapters(project);
    if (chapters.length === 0) {
      return res.status(400).json({ error: 'No completed chapters found.' });
    }
    const manuscript = chapters.map(c => `# Chapter ${c.number}: ${c.title}\n\n${c.text}`).join('\n\n');
    const result = await tools.runManuscriptAutopsy(manuscript);
    res.json(result);
  });

  app.post('/api/projects/:id/format-pro', async (req: Request, res: Response) => {
    const tools = services.externalTools;
    if (!tools) return res.status(503).json({ error: 'External tools not initialized' });

    const engine = gateway.getProjectEngine?.();
    const project = engine?.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const { outputFormat, trimSize, author } = req.body || {};
    const fmt = outputFormat || 'docx';
    if (!['docx', 'epub', 'pdf', 'md'].includes(fmt)) {
      return res.status(400).json({ error: 'outputFormat must be docx|epub|pdf|md' });
    }

    // Compile the manuscript first so Format Pro has an input file.
    const chapters = await gatherChapters(project);
    if (chapters.length === 0) return res.status(400).json({ error: 'No completed chapters to format.' });

    const { join: j, resolve: r } = await import('path');
    const { mkdir: mkd, writeFile: wf } = await import('fs/promises');
    const tmpDir = j(baseDir, 'workspace', 'tmp', 'format-input');
    await mkd(tmpDir, { recursive: true });
    const inputPath = j(tmpDir, `${project.id}.md`);
    const manuscript = chapters.map(c => `# Chapter ${c.number}: ${c.title}\n\n${c.text}`).join('\n\n');
    await wf(inputPath, manuscript, 'utf-8');

    const result = await tools.runFormatPro({
      manuscriptPath: r(inputPath),
      outputFormat: fmt,
      title: project.title,
      author: author || 'Anonymous',
      trimSize,
    });
    res.json(result);
  });

  // ═══════════════════════════════════════════════════════════
  // Cover Typography — overlay title/author on an AI-generated PNG
  // ═══════════════════════════════════════════════════════════

  app.post('/api/covers/apply-typography', async (req: Request, res: Response) => {
    const typo = services.coverTypography;
    if (!typo) return res.status(503).json({ error: 'Cover typography service not initialized' });

    const { imagePath, title, author, subtitle, seriesBadge, genre, titleColor, authorColor, width, height } = req.body || {};
    if (!imagePath || !title || !author) {
      return res.status(400).json({ error: 'imagePath, title, and author are required' });
    }

    // Harden against path traversal — imagePath must be inside workspace.
    const { resolve } = await import('path');
    const workspaceDir = path.join(baseDir, 'workspace');
    const resolved = resolve(String(imagePath));
    if (!resolved.startsWith(resolve(workspaceDir))) {
      return res.status(400).json({ error: 'imagePath must be inside workspace/' });
    }

    try {
      const result = await typo.apply({
        imagePath: resolved, title, author, subtitle, seriesBadge, genre,
        titleColor, authorColor, width, height,
      });
      if (!result.success) return res.status(500).json(result);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Typography failed' });
    }
  });

  // ═══════════════════════════════════════════════════════════
  // Manuscript Hub — aggregated dashboard stats
  // ═══════════════════════════════════════════════════════════

  app.get('/api/hub', async (_req: Request, res: Response) => {
    const hub = services.manuscriptHub;
    const engine = gateway.getProjectEngine?.();
    const activityLog = gateway.getActivityLog?.();
    if (!hub || !engine || !activityLog) {
      return res.status(503).json({ error: 'Manuscript hub services not initialized' });
    }
    try {
      const projects = engine.listProjects();
      const dailyWordGoal = services.config.get('autonomous.dailyWordGoal', 1000) || 1000;
      const report = await hub.build(projects, activityLog, dailyWordGoal);
      res.json(report);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Hub build failed' });
    }
  });

  // ═══════════════════════════════════════════════════════════
  // Beta Reader + Dialogue Auditor
  // ═══════════════════════════════════════════════════════════

  // Helper: gather completed writing-phase chapters for a project.

  // Get available beta reader archetypes
  app.get('/api/beta-reader/archetypes', (_req: Request, res: Response) => {
    const beta = services.betaReader;
    if (!beta) return res.json({ archetypes: [] });
    res.json({ archetypes: beta.getArchetypes() });
  });

  // Run beta reader panel on a project (async — uses SSE/socket for progress)
  app.post('/api/projects/:id/beta-reader', async (req: Request, res: Response) => {
    const beta = services.betaReader;
    if (!beta) return res.status(503).json({ error: 'Beta reader not initialized' });

    const engine = gateway.getProjectEngine?.();
    const project = engine?.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const chapters = await gatherChapters(project);
    if (chapters.length === 0) {
      return res.status(400).json({ error: 'No completed chapters found. Write some chapters first.' });
    }

    const archetypes = Array.isArray(req.body?.archetypes) && req.body.archetypes.length > 0
      ? req.body.archetypes
      : undefined;

    // Respond immediately — client subscribes to progress via socket.
    res.json({ status: 'started', chapters: chapters.length, archetypes: (archetypes || beta.getArchetypes()).length });

    const aiCompleteFn = (r: any) => services.aiRouter.complete(r);
    const aiSelectFn = (t: string) => services.aiRouter.selectProvider(t);

    (async () => {
      try {
        const report = await beta.scanManuscript(
          project.id, chapters, aiCompleteFn, aiSelectFn, archetypes,
          (msg: string) => {
            try { (gateway as any).io?.emit?.('beta-reader-progress', { projectId: project.id, message: msg }); } catch {}
          }
        );
        // Store the report alongside context data.
        try {
          const { join: j } = await import('path');
          const { writeFile: wf, mkdir: mkd } = await import('fs/promises');
          const dir = j(baseDir, 'workspace', 'beta-reports');
          await mkd(dir, { recursive: true });
          await wf(j(dir, `${project.id}.json`), JSON.stringify(report, null, 2));
        } catch { /* non-fatal */ }
        try { (gateway as any).io?.emit?.('beta-reader-complete', { projectId: project.id, report }); } catch {}
      } catch (err: any) {
        try { (gateway as any).io?.emit?.('beta-reader-error', { projectId: project.id, error: err?.message || String(err) }); } catch {}
      }
    })();
  });

  // Get the stored beta-reader report
  app.get('/api/projects/:id/beta-reader/report', async (req: Request, res: Response) => {
    const { join: j } = await import('path');
    const { readFile: rf } = await import('fs/promises');
    const { existsSync: ex } = await import('fs');
    const file = j(baseDir, 'workspace', 'beta-reports', `${req.params.id}.json`);
    if (!ex(file)) return res.json({ report: null });
    try {
      const raw = await rf(file, 'utf-8');
      res.json({ report: JSON.parse(raw) });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Could not read report' });
    }
  });

  // Run dialogue audit on a project
  app.post('/api/projects/:id/dialogue-audit', async (req: Request, res: Response) => {
    const auditor = services.dialogueAuditor;
    if (!auditor) return res.status(503).json({ error: 'Dialogue auditor not initialized' });

    const engine = gateway.getProjectEngine?.();
    const project = engine?.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const chapters = await gatherChapters(project);
    if (chapters.length === 0) {
      return res.status(400).json({ error: 'No completed chapters found.' });
    }

    // Combine all chapters then audit across the whole manuscript.
    const combined = chapters.map(c => `# ${c.title}\n\n${c.text}`).join('\n\n');
    try {
      const report = auditor.audit(combined, project.id);
      res.json({ report });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Audit failed' });
    }
  });

  // Export the active blurb from a project's compiled output, if present
  app.post('/api/projects/:id/export-blurb', async (req: Request, res: Response) => {
    const exporter = services.kdpExporter;
    if (!exporter) return res.status(503).json({ error: 'KDP exporter not initialized' });

    const engine = gateway.getProjectEngine?.();
    const project = engine?.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    // Priority: req.body.blurb > the most recent step whose label contains "blurb"
    let blurb: string | undefined = req.body?.blurb;
    if (!blurb) {
      const blurbStep = [...project.steps].reverse().find((s: any) =>
        /blurb|description/i.test(s.label) && s.status === 'completed' && s.result
      );
      blurb = blurbStep?.result;
    }
    if (!blurb) {
      return res.status(400).json({ error: 'No blurb found. Pass { blurb: "..." } or run the blurb-writer skill first.' });
    }
    try {
      const result = exporter.exportBlurb(blurb);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Export failed' });
    }
  });

}
