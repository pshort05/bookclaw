import { Application, Request, Response } from 'express';
import { SLUG_RE, type BookFormat } from '../../services/book-types.js';
import { resolveStructure, evaluateBeatMapping, type StoryStructure } from '../../services/story-structures.js';
import { getForm, validateFormFit } from '../../services/story-forms.js';
import {
  countChapterWords, loadLengthOverrides, saveLengthOverrides, buildLengthReview, parseGenreWordRange,
  loadStructureReview, saveStructureReview, parseBeatMappingResponse,
} from '../../services/format-review.js';

/**
 * Book Format & Structure — review surface (Phase 3).
 * Checks the manuscript against the book's DECLARED format (manifest.format).
 */
export function mountFormatReview(app: Application, gateway: any, _baseDir: string): void {
  const services = gateway.getServices();

  // Resolve the declared format + its structure + data dir; or an error response.
  async function ctx(slug: string): Promise<{ format: BookFormat; structure: StoryStructure | null; dataDir: string } | { error: string; code: number }> {
    if (!SLUG_RE.test(slug) || !services.books?.exists?.(slug)) return { error: 'Book not found', code: 404 };
    const opened = await services.books.open(slug);
    const format: BookFormat | undefined = opened?.manifest?.format;
    if (!format) return { error: 'format not configured', code: 400 };
    const structure = resolveStructure({ structureId: format.structureId, customStructure: format.customStructure as StoryStructure | undefined }, services.storyStructures);
    const dataDir = services.books.dataDirOf(slug) || '';
    return { format, structure, dataDir };
  }

  app.get('/api/books/:slug/structure-review', async (req: Request, res: Response) => {
    try {
      const c = await ctx(String(req.params.slug));
      if ('error' in c) return res.status(c.code).json({ error: c.error });
      const sr = loadStructureReview(c.dataDir);
      // Guard against a malformed custom structure (no beats array) — report stays null rather than 500.
      const report = (c.structure && Array.isArray(c.structure.beats) && c.structure.beats.length > 0)
        ? evaluateBeatMapping(c.structure, sr.mapping, c.format.chapterCount)
        : null;
      res.json({ structure: c.structure, outline: sr.outline, mapping: sr.mapping, report });
    } catch (err) { res.status(500).json({ error: String(err) }); }
  });

  app.post('/api/books/:slug/structure-review/propose', async (req: Request, res: Response) => {
    try {
      const c = await ctx(String(req.params.slug));
      if ('error' in c) return res.status(c.code).json({ error: c.error });
      const sr = loadStructureReview(c.dataDir);
      // Outline source: the editable sidecar if present, else the chapter list.
      const outline = sr.outline.length > 0
        ? sr.outline.map((o) => `Chapter ${o.chapter}: ${o.summary}`)
        : countChapterWords(c.dataDir).map((ch, i) => `Chapter ${i + 1}: ${ch.chapter}`);
      const wantCustom = c.format.structureId === 'custom' && (!c.structure || c.structure.beats.length === 0);
      const beatList = c.structure?.beats.map((b) => `- ${b.name} (~${b.expectedPct}%): ${b.description}`).join('\n') || '(no beats defined yet)';
      const system = `You map a novel's chapter outline onto a story structure's beats. Return STRICT JSON only:\n{ "mapping": { "<beat name>": [<1-based chapter numbers>] }${wantCustom ? ', "customBeats": [ { "name": string, "expectedPct": number, "pctRange": [number,number], "description": string } ]' : ''} }\nUse the exact beat names given. Omit a beat if no chapter fits.`;
      const user = `STRUCTURE: ${c.structure?.name ?? c.format.structureId}\nBEATS:\n${beatList}\n\nOUTLINE (${outline.length} chapters):\n${outline.join('\n')}${wantCustom ? '\n\nThis is a CUSTOM structure with no beats yet — also propose a "customBeats" scaffold that fits this outline.' : ''}`;
      const provider = services.aiRouter.selectProvider('consistency');
      const result = await services.aiRouter.complete({ provider: provider.id, system, messages: [{ role: 'user', content: user }], maxTokens: 1500, temperature: 0.2 });
      const parsed = parseBeatMappingResponse(result.text);
      res.json(parsed);
    } catch (err) {
      // Fail-soft: an LLM/parse failure yields an empty mapping (the UI/smoke skips).
      res.json({ mapping: {} });
    }
  });

  app.put('/api/books/:slug/structure-review', async (req: Request, res: Response) => {
    try {
      const slug = String(req.params.slug);
      const c = await ctx(slug);
      if ('error' in c) return res.status(c.code).json({ error: c.error });
      const body = req.body || {};
      const outline = Array.isArray(body.outline) ? body.outline.filter((o: any) => o && typeof o.summary === 'string').map((o: any) => ({ chapter: Number(o.chapter) || 0, summary: String(o.summary) })) : [];
      const mapping: Record<string, number[]> = {};
      if (body.mapping && typeof body.mapping === 'object') {
        for (const [k, v] of Object.entries(body.mapping)) if (Array.isArray(v)) mapping[k] = (v as unknown[]).map(Number).filter((n) => Number.isFinite(n) && n >= 1);
      }
      saveStructureReview(c.dataDir, { outline, mapping });
      // Persist edited custom-structure beats back onto the manifest format. Require a
      // well-formed beats array so a later GET can't be poisoned into a 500.
      if (c.format.structureId === 'custom' && body.customStructure && typeof body.customStructure === 'object') {
        if (!Array.isArray((body.customStructure as { beats?: unknown }).beats)) {
          return res.status(400).json({ error: 'customStructure.beats must be an array' });
        }
        await services.books.setFormat(slug, { ...c.format, customStructure: body.customStructure });
      }
      res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: String(err) }); }
  });

  app.get('/api/books/:slug/length-review', async (req: Request, res: Response) => {
    try {
      const slug = String(req.params.slug);
      const c = await ctx(slug);
      if ('error' in c) return res.status(c.code).json({ error: c.error });
      const chapters = countChapterWords(c.dataDir);
      const overrides = loadLengthOverrides(c.dataDir);
      const form = getForm(c.format.formId);
      const genreRange = parseGenreWordRange(services.books.genreGuideOf(slug) ?? '');
      res.json(buildLengthReview({ chapters, wordsPerChapter: c.format.wordsPerChapter, overrides, form, genreRange }));
    } catch (err) { res.status(500).json({ error: String(err) }); }
  });

  app.put('/api/books/:slug/length-targets', async (req: Request, res: Response) => {
    try {
      const slug = String(req.params.slug);
      const c = await ctx(slug);
      if ('error' in c) return res.status(c.code).json({ error: c.error });
      const body = req.body || {};
      const overrides: Record<string, number> = {};
      if (body.overrides && typeof body.overrides === 'object') {
        for (const [k, v] of Object.entries(body.overrides)) if (typeof v === 'number' && v > 0) overrides[k] = Math.floor(v);
      }
      // Re-validate the resulting total against the form band (hard block).
      const chapters = countChapterWords(c.dataDir);
      const form = getForm(c.format.formId);
      if (form && chapters.length > 0) {
        const totalTarget = chapters.reduce((a, ch) => a + (overrides[ch.chapter] ?? c.format.wordsPerChapter), 0);
        const fit = validateFormFit(form, chapters.length, Math.round(totalTarget / chapters.length));
        if (!fit.ok) return res.status(400).json({ error: fit.message });
      }
      saveLengthOverrides(c.dataDir, overrides);
      res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: String(err) }); }
  });
}
