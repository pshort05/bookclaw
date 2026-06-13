import { Application, Request, Response } from 'express';
import path from 'path';
import { safePath } from './_shared.js';

/** Internet research (web search + extraction), image generation, and TTS/audio (incl. resolveVoiceForRequest). */
export function mountMedia(app: Application, gateway: any, baseDir: string): void {
  const services = gateway.getServices();

  // ═══════════════════════════════════════════════════════════
  // Internet Research (web search + content extraction)
  // ═══════════════════════════════════════════════════════════

  // ── Research Domain Management ──
  app.get('/api/research/domains', (_req: Request, res: Response) => {
    const research = services.research;
    if (!research) {
      return res.status(503).json({ error: 'Research gate not initialized' });
    }
    res.json({ domains: research.getAllowedDomains() });
  });

  app.post('/api/research/domains', async (req: Request, res: Response) => {
    const research = services.research;
    if (!research) {
      return res.status(503).json({ error: 'Research gate not initialized' });
    }
    const { domains } = req.body;
    if (!Array.isArray(domains)) {
      return res.status(400).json({ error: 'domains must be an array of strings' });
    }
    try {
      await research.setDomains(domains);
      res.json({ success: true, count: research.getAllowedDomainCount() });
    } catch (err) {
      res.status(500).json({ error: 'Failed to save domains: ' + String(err) });
    }
  });

  app.post('/api/research', async (req: Request, res: Response) => {
    const research = services.research;
    if (!research) {
      return res.status(503).json({ error: 'Research service not initialized' });
    }
    const { query, maxResults } = req.body;
    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: 'query required' });
    }

    try {
      // Search
      const searchResults = await research.search(query, maxResults || 5);

      // If search returned an error, pass it through
      if (searchResults.error && searchResults.results.length === 0) {
        return res.json({
          results: [],
          blocked: searchResults.blocked,
          totalFound: 0,
          error: searchResults.error,
        });
      }

      // Fetch and extract top 3 allowed results
      const enriched = await Promise.all(
        searchResults.results.slice(0, 3).map(async (r: any) => {
          const extracted = await research.fetchAndExtract(r.url);
          return {
            title: r.title,
            url: r.url,
            snippet: r.snippet,
            fullText: extracted.ok ? extracted.text?.substring(0, 5000) : undefined,
          };
        })
      );

      res.json({
        results: enriched,
        blocked: searchResults.blocked,
        totalFound: searchResults.results.length,
        error: searchResults.error,
      });
    } catch (error) {
      res.status(500).json({ error: 'Research failed: ' + String(error) });
    }
  });

  // ═══════════════════════════════════════════════════════════
  // Image Generation (Together AI + OpenAI)
  // ═══════════════════════════════════════════════════════════

  // Generate an image from a text prompt
  app.post('/api/images/generate', async (req: Request, res: Response) => {
    const imageGen = gateway.getImageGen?.();
    if (!imageGen) return res.status(503).json({ error: 'Image generation service not initialized' });

    const { prompt, provider, width, height, style } = req.body;
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'prompt is required' });
    }

    try {
      const result = await imageGen.generate(prompt, { provider, width, height, style });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: 'Image generation failed: ' + String(err) });
    }
  });

  // Generate a book cover
  app.post('/api/images/book-cover', async (req: Request, res: Response) => {
    const imageGen = gateway.getImageGen?.();
    if (!imageGen) return res.status(503).json({ error: 'Image generation service not initialized' });

    const { title, author, genre, description, style,
      subgenre, mood, era, setting, keyImagery, palette, avoidImagery,
      includeText, typographyNote, quality, provider } = req.body;
    if (!description) {
      return res.status(400).json({ error: 'description is required' });
    }

    // Resolve image provider preference: per-call override > global setting > 'auto'
    const resolvedProvider = provider
      || services.config?.get('ai.preferredImageProvider')
      || 'auto';

    try {
      const result = await imageGen.generateBookCover({
        title: title || 'Untitled',
        author: author || 'BookClaw',
        genre: genre || 'fiction',
        description,
        style,
        subgenre, mood, era, setting, keyImagery, palette, avoidImagery,
        includeText, typographyNote, quality, provider: resolvedProvider,
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: 'Book cover generation failed: ' + String(err) });
    }
  });

  /**
   * POST /api/images/cover-set
   * Generate the full set of standard cover sizes (ebook + print + audiobook
   * + social) in one call, all using the same visual brief so they look
   * cohesive across formats.
   *
   * Body fields (all optional except description):
   *   { title, author, genre, description,
   *     style?, subgenre?, mood?, era?, setting?, keyImagery?, palette?,
   *     avoidImagery?, variants?, quality?, provider? }
   */
  app.post('/api/images/cover-set', async (req: Request, res: Response) => {
    const imageGen = gateway.getImageGen?.();
    if (!imageGen) return res.status(503).json({ error: 'Image generation service not initialized' });
    if (!req.body?.description) return res.status(400).json({ error: 'description is required' });

    try {
      const result = await imageGen.generateCoverSet({
        title: req.body.title || 'Untitled',
        author: req.body.author || 'BookClaw',
        genre: req.body.genre || 'fiction',
        description: req.body.description,
        style: req.body.style,
        subgenre: req.body.subgenre,
        mood: req.body.mood,
        era: req.body.era,
        setting: req.body.setting,
        keyImagery: req.body.keyImagery,
        palette: req.body.palette,
        avoidImagery: req.body.avoidImagery,
        includeText: req.body.includeText,
        typographyNote: req.body.typographyNote,
        variants: req.body.variants,
        quality: req.body.quality,
        provider: req.body.provider || services.config?.get('ai.preferredImageProvider') || 'auto',
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: 'Cover-set generation failed: ' + String(err) });
    }
  });

  /**
   * POST /api/projects/:id/cover-set
   * Same as above but auto-fills title/author/genre/description from the project
   * (using the linked persona for `author` if present).
   */
  app.post('/api/projects/:id/cover-set', async (req: Request, res: Response) => {
    const imageGen = gateway.getImageGen?.();
    const engine = gateway.getProjectEngine?.();
    if (!imageGen || !engine) return res.status(503).json({ error: 'Required services not initialized' });
    const project = engine.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    // Resolve author name from linked persona if present.
    let authorName = 'BookClaw';
    if ((project as any).personaId && services.personas) {
      const persona = services.personas.get?.((project as any).personaId);
      if (persona?.penName) authorName = persona.penName;
    }

    try {
      const result = await imageGen.generateCoverSet({
        title: project.title,
        author: req.body?.author || authorName,
        genre: req.body?.genre || (project.context?.genre as string) || 'fiction',
        description: req.body?.description || project.description || '',
        style: req.body?.style,
        subgenre: req.body?.subgenre,
        mood: req.body?.mood,
        era: req.body?.era,
        setting: req.body?.setting,
        keyImagery: req.body?.keyImagery,
        palette: req.body?.palette,
        avoidImagery: req.body?.avoidImagery,
        variants: req.body?.variants,
        quality: req.body?.quality,
        provider: req.body?.provider,
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: 'Project cover-set generation failed: ' + String(err) });
    }
  });

  /** Return the available cover-variant specs (for the dashboard). */
  app.get('/api/images/cover-variants', async (_req: Request, res: Response) => {
    const { ImageGenService } = await import('../../services/image-gen.js');
    res.json({ variants: ImageGenService.getCoverVariants() });
  });

  // Check available image providers
  app.get('/api/images/providers', async (_req: Request, res: Response) => {
    const imageGen = gateway.getImageGen?.();
    if (!imageGen) return res.status(503).json({ error: 'Image generation service not initialized' });
    const providers = await imageGen.getAvailableProviders();
    res.json({ providers });
  });

  // Serve generated images
  app.get('/api/images/:filename', async (req: Request, res: Response) => {
    const imageGen = gateway.getImageGen?.();
    if (!imageGen) return res.status(503).json({ error: 'Image generation service not initialized' });

    const { existsSync: ex } = await import('fs');
    const fname = String(req.params.filename);
    const imageDir = imageGen.getImageDir();
    const filePath = safePath(imageDir, fname);

    if (!filePath) {
      return res.status(403).json({ error: 'Path traversal blocked' });
    }

    if (!ex(filePath) || !fname.match(/^cover-[a-f0-9]+\.png$/)) {
      return res.status(404).json({ error: 'Image not found' });
    }

    res.sendFile(filePath);
  });

  // ═══════════════════════════════════════════════════════════
  // TTS / Audio (Edge TTS free + ElevenLabs paid — pluggable providers)
  // ═══════════════════════════════════════════════════════════

  /**
   * Resolve voice priority: explicit voice > persona's voice > project preset > default.
   * Used by both /api/audio/generate and the project narration code.
   */
  async function resolveVoiceForRequest(opts: {
    explicitVoice?: string;
    personaId?: string;
    projectId?: string;
  }): Promise<{ voice?: string; provider?: 'edge' | 'elevenlabs' }> {
    if (opts.explicitVoice) return { voice: opts.explicitVoice };
    // Try project's linked persona. The engine is gateway.getProjectEngine(),
    // not a getServices() key, so resolve it here.
    const projectEngine = gateway.getProjectEngine?.();
    if (opts.projectId && projectEngine) {
      const project = projectEngine.getProject?.(opts.projectId);
      if (project?.personaId && services.personas) {
        const persona = services.personas.get?.(project.personaId);
        if (persona?.ttsVoice) return { voice: persona.ttsVoice };
      }
    }
    // Or direct personaId
    if (opts.personaId && services.personas) {
      const persona = services.personas.get?.(opts.personaId);
      if (persona?.ttsVoice) return { voice: persona.ttsVoice };
    }
    return {};
  }

  // Generate audio from text. Provider auto-detected from voice format
  // (Edge for "en-US-AriaNeural"-style, ElevenLabs for 20-char voice_ids).
  app.post('/api/audio/generate', async (req: Request, res: Response) => {
    const { text, voice, rate, pitch, volume, provider, personaId, projectId, elevenLabsModel } = req.body;
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Text required' });
    }
    if (text.length > 50000) {
      return res.status(400).json({ error: 'Text too long (max 50,000 chars)' });
    }

    if (!services.tts) {
      return res.status(503).json({ error: 'TTS service not initialized' });
    }

    // Resolve persona-aware voice if no explicit voice was passed.
    const resolved = await resolveVoiceForRequest({
      explicitVoice: voice,
      personaId,
      projectId,
    });

    const result = await services.tts.generate(text, {
      voice: resolved.voice,
      provider: provider || resolved.provider,
      rate, pitch, volume,
      elevenLabsModel,
    });
    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json(result);
    }
  });

  // List available voices from all configured providers.
  // Returns Edge presets always; adds ElevenLabs voices when an API key is configured.
  app.get('/api/audio/voices', async (_req: Request, res: Response) => {
    if (!services.tts) return res.status(503).json({ error: 'TTS service not initialized' });
    const presets = services.tts.listPresets();
    let elevenLabs: any[] = [];
    try {
      elevenLabs = await services.tts.listElevenLabsVoices();
    } catch { /* non-fatal — feature is optional */ }
    res.json({
      activeProvider: services.tts.getActiveProvider(),
      activeVoice: services.tts.getActiveVoice(),
      presets,
      elevenLabs,
    });
  });

  // Set the global default TTS provider/voice.
  app.post('/api/audio/config', async (req: Request, res: Response) => {
    if (!services.tts) return res.status(503).json({ error: 'TTS service not initialized' });
    const { voice, provider } = req.body || {};
    if (voice) await services.tts.setVoice(voice);
    if (provider === 'edge' || provider === 'elevenlabs') {
      await services.tts.setProvider(provider);
    }
    res.json({
      activeProvider: services.tts.getActiveProvider(),
      activeVoice: services.tts.getActiveVoice(),
    });
  });

  // Serve generated audio files
  app.get('/api/audio/file/:filename', async (req: Request, res: Response) => {
    const { existsSync: ex } = await import('fs');
    const fname = String(req.params.filename);
    const audioDir = path.join(baseDir, 'workspace', 'audio');
    const filePath = safePath(audioDir, fname);

    // Security: prevent path traversal
    if (!filePath) {
      return res.status(403).json({ error: 'Path traversal blocked' });
    }

    if (!ex(filePath)) {
      return res.status(404).json({ error: 'Audio file not found' });
    }

    const ext = fname.split('.').pop()?.toLowerCase();
    const mimeTypes: Record<string, string> = {
      mp3: 'audio/mpeg',
      ogg: 'audio/ogg',
      wav: 'audio/wav',
    };
    res.setHeader('Content-Type', mimeTypes[ext || ''] || 'audio/mpeg');
    res.setHeader('Content-Disposition', `inline; filename="${fname}"`);
    const { createReadStream } = await import('fs');
    createReadStream(filePath).pipe(res);
  });

  // Get/set the active voice
  app.get('/api/audio/voice', async (_req: Request, res: Response) => {
    res.json({ voice: services.tts?.getActiveVoice() || 'en-US-AriaNeural' });
  });

  app.post('/api/audio/voice', async (req: Request, res: Response) => {
    const { voice } = req.body;
    if (!voice || typeof voice !== 'string') {
      return res.status(400).json({ error: 'voice is required (e.g., "narrator_female" or "en-US-AriaNeural")' });
    }
    if (!services.tts) {
      return res.status(503).json({ error: 'TTS service not initialized' });
    }
    // Resolve preset name to voice ID before saving
    const resolvedVoice = services.tts.resolveVoice(voice);
    await services.tts.setVoice(resolvedVoice);
    res.json({ success: true, voice: resolvedVoice, message: `Voice set to ${resolvedVoice}. This persists across restarts.` });
  });

  // ── Backup & Restore ──
  // Legacy ad-hoc backup endpoints (POST/GET /api/backup/* writing to
  // workspace/backups/) were retired: they were unused (no frontend/bridge
  // caller) and restore-incompatible with the Phase-11 BackupService-backed
  // /api/backups (~/bookclaw-backups). Use /api/backups (see backups.routes.ts).

}
