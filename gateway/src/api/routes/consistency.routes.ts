import { Application, Request, Response } from 'express';
import { SLUG_RE } from '../../services/book-types.js';
import { renderConsistencyReport } from '../../services/reports/render-consistency.js';
import { validateConsistencyModelSelection, resolveConsistencyModel, consistencyCapabilityError } from '../../services/consistency/model-selection.js';
import { FIXABLE, type ProposedEdit, type ConfirmedEdit, type ApplyOutcome } from '../../services/consistency/fix-types.js';
import { resolveChapterFile } from '../../services/consistency/fix-resolve.js';
import { buildFixPrompt, parseFixProposals } from '../../services/consistency/fix-proposer.js';
import { applyEditsToText } from '../../services/consistency/fix-apply.js';
import { writeWithVersion } from '../../services/file-versions.js';
import { safePath } from './_shared.js';
import type { ConsistencyFinding } from '../../services/consistency/types.js';

/**
 * Consistency Auditor API (consistency-auditor plan Task 5).
 * GET  /api/books/:slug/consistency-report  — return stored report (or null)
 * POST /api/books/:slug/consistency-audit   — kick off async audit, emit socket events
 */
export function mountConsistency(app: Application, gateway: any, _baseDir: string): void {
  const services = gateway.getServices();

  // Return the stored consistency report for a book (null if not yet run)
  app.get('/api/books/:slug/consistency-report', async (req: Request, res: Response) => {
    try {
      const slug = String(req.params.slug);
      if (!SLUG_RE.test(slug) || !services.books?.exists?.(slug)) {
        return res.status(404).json({ error: 'Book not found' });
      }
      if (!services.consistencyStore?.isAvailable()) {
        return res.status(503).json({ error: 'Consistency DB unavailable' });
      }
      // `running` lets a reconnecting client rehydrate the in-progress UI instead
      // of offering to start a second (ledger-corrupting) run.
      // `consistencyModel` rehydrates the studio's per-book model picker.
      const consistencyModel = (await services.books.open(slug) as any)?.manifest?.consistency ?? null;
      res.json({
        report: services.consistencyStore?.getReport(slug) ?? null,
        running: gateway.consistencyJobs.isRunning(slug),
        job: gateway.consistencyJobs.get(slug),
        consistencyModel,
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Run consistency audit asynchronously; respond immediately and stream progress via socket
  app.post('/api/books/:slug/consistency-audit', async (req: Request, res: Response) => {
    try {
      const slug = String(req.params.slug);
      if (!SLUG_RE.test(slug) || !services.books?.exists?.(slug)) {
        return res.status(404).json({ error: 'Book not found' });
      }
      if (!services.consistencyStore?.isAvailable()) {
        return res.status(503).json({ error: 'Consistency DB unavailable' });
      }

      // Per-run model override (this run only; does not change the saved
      // default). Validate before claiming the job slot or responding.
      const selErr = validateConsistencyModelSelection(req.body);
      if (selErr) return res.status(400).json({ error: selErr });
      const override = {
        provider: typeof req.body?.provider === 'string' ? req.body.provider : undefined,
        model: typeof req.body?.model === 'string' ? req.body.model : undefined,
      };

      // Capability gate: consistency needs a large-context model (not Ollama).
      // Resolve the effective selection (per-run → per-book → auto) and confirm a
      // capable provider is actually configured — fail loudly up front instead of
      // silently dropping every chapter when only an unsuitable model is present.
      const manifest = (await services.books.open(slug) as any)?.manifest;
      const sel = resolveConsistencyModel(override, manifest?.consistency);
      const availableIds = (services.aiRouter?.getActiveProviders?.() ?? []).map((p: any) => p.id);
      const capErr = consistencyCapabilityError(sel, availableIds);
      if (capErr) return res.status(422).json({ error: capErr });

      // Concurrency guard: a second audit for the same book while one is in
      // flight would interleave with the leading clearBookFacts() and corrupt
      // the ledger. Claim the slot atomically; reject if already running.
      if (!gateway.consistencyJobs.start(slug)) {
        return res.status(409).json({
          error: 'A consistency audit is already running for this book',
          running: gateway.consistencyJobs.get(slug),
        });
      }

      gateway.activityLog?.log({
        type: 'step_started',
        source: 'internal',
        message: `Consistency audit started for "${slug}"`,
        metadata: { book: slug },
      });

      // Respond immediately; audit runs in the background
      res.json({ status: 'started', slug });

      services.consistencyAudit(
        slug,
        (msg: string) => {
          gateway.consistencyJobs.progress(slug, msg);
          try { (gateway as any).io?.emit?.('consistency-progress', { slug, message: msg }); } catch {}
        },
        override
      ).then((report: any) => {
        gateway.activityLog?.log({
          type: 'step_completed',
          source: 'internal',
          message: `Consistency audit complete for "${slug}": ${report?.chaptersScanned ?? 0} chapters, ${report?.findings?.length ?? 0} findings`,
          metadata: { book: slug, chaptersScanned: report?.chaptersScanned, findings: report?.findings?.length, factCount: report?.factCount },
        });
        // Emit a downloadable report (fail-soft: must not break the audit).
        try {
          const r = renderConsistencyReport(report);
          services.reports?.write(slug, 'consistency', { title: r.title, markdown: r.markdown, json: report, summary: r.summary });
        } catch { /* report emission is best-effort */ }
        try { (gateway as any).io?.emit?.('consistency-complete', { slug, report }); } catch {}
      }).catch((err: any) => {
        gateway.activityLog?.log({
          type: 'step_failed',
          source: 'internal',
          message: `Consistency audit failed for "${slug}": ${err?.message ?? String(err)}`,
          metadata: { book: slug },
        });
        try { (gateway as any).io?.emit?.('consistency-error', { slug, error: err?.message ?? String(err) }); } catch {}
      }).finally(() => {
        gateway.consistencyJobs.finish(slug);
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Persist the per-book default model for the consistency audit. Empty body clears it.
  app.put('/api/books/:slug/consistency-model', async (req: Request, res: Response) => {
    try {
      const slug = String(req.params.slug);
      if (!SLUG_RE.test(slug) || !services.books?.exists?.(slug)) {
        return res.status(404).json({ error: 'Book not found' });
      }
      const selErr = validateConsistencyModelSelection(req.body);
      if (selErr) return res.status(400).json({ error: selErr });
      await services.books.setConsistencyModel(slug, {
        provider: typeof req.body?.provider === 'string' ? req.body.provider : undefined,
        model: typeof req.body?.model === 'string' ? req.body.model : undefined,
      });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── Apply-Fix: propose surgical prose edits for selected findings (no write) ──
  // Body: { findingIds: string[], provider?, model? }. The model only PROPOSES;
  // application is the deterministic find/replace in the apply route below.
  app.post('/api/books/:slug/consistency-fix/propose', async (req: Request, res: Response) => {
    try {
      const slug = String(req.params.slug);
      if (!SLUG_RE.test(slug) || !services.books?.exists?.(slug)) {
        return res.status(404).json({ error: 'Book not found' });
      }
      if (!services.consistencyStore?.isAvailable?.()) {
        return res.status(503).json({ error: 'Consistency DB unavailable' });
      }
      const selErr = validateConsistencyModelSelection(req.body);
      if (selErr) return res.status(400).json({ error: selErr });

      const dataDir = services.books?.dataDirOf?.(slug);
      if (!dataDir) return res.status(404).json({ error: 'Book data directory not found' });

      const findingIds: string[] = Array.isArray(req.body?.findingIds)
        ? req.body.findingIds.filter((x: unknown) => typeof x === 'string')
        : [];

      // Reload findings from the authoritative SQLite store (no re-audit). Keep
      // only the requested ids that are phrase-swappable; silently drop the rest
      // (knowledge-violation, unknown ids).
      const report = services.consistencyStore?.getReport?.(slug);
      const allFindings: ConsistencyFinding[] = report?.findings ?? [];
      const wanted = new Set(findingIds);
      const selected = allFindings.filter(
        (f) => f.id && wanted.has(f.id) && FIXABLE.includes(f.category),
      );
      if (selected.length === 0) return res.json({ proposals: [] });

      // Resolve + capability-gate the model (same posture as the audit route).
      const manifest = (await services.books.open(slug) as any)?.manifest;
      const sel = resolveConsistencyModel(
        {
          provider: typeof req.body?.provider === 'string' ? req.body.provider : undefined,
          model: typeof req.body?.model === 'string' ? req.body.model : undefined,
        },
        manifest?.consistency,
      );
      const availableIds = (services.aiRouter?.getActiveProviders?.() ?? []).map((p: any) => p.id);
      const capErr = consistencyCapabilityError(sel, availableIds);
      if (capErr) return res.status(422).json({ error: capErr });

      // Group selected findings by detection chapter (`a.chapter`): one model call
      // per chapter keeps edits coherent and the cost bounded.
      const byChapter = new Map<string, ConsistencyFinding[]>();
      for (const f of selected) {
        const ch = f.a?.chapter;
        if (!ch) continue;
        const list = byChapter.get(ch);
        if (list) list.push(f);
        else byChapter.set(ch, [f]);
      }

      const proposals: ProposedEdit[] = [];
      for (const [chapterLabel, chapterFindings] of byChapter) {
        const resolved = resolveChapterFile(dataDir, chapterLabel);
        if (!resolved) {
          // Couldn't locate the chapter file — surface every finding as unanchored
          // rather than dropping it. The author still sees it in the preview.
          for (const f of chapterFindings) {
            proposals.push(unanchoredProposal(f, chapterLabel));
          }
          continue;
        }
        try {
          const { system, user } = buildFixPrompt(resolved.chapterText, chapterFindings);
          const result = await services.aiRouter.complete({
            provider: sel.provider,
            model: sel.model,
            system,
            messages: [{ role: 'user', content: user }],
            temperature: 0,
            // Generous so a chapter with many findings doesn't truncate the JSON
            // edit array mid-array (which would silently drop the trailing edits).
            maxTokens: 16000,
          });
          const raw = (result as any)?.content ?? (result as any)?.text ?? '';
          const parsed = parseFixProposals(raw);
          const byId = new Map(parsed.map((p) => [p.findingId, p]));
          for (const f of chapterFindings) {
            const p = byId.get(f.id!);
            if (!p) {
              proposals.push(unanchoredProposal(f, chapterLabel));
              continue;
            }
            // Anchor against the WHOLE file (combined manuscripts edit a substring
            // of the full file). Dry-run: exactly one application = anchored.
            const dry = applyEditsToText(resolved.fileText, [
              { findingId: f.id!, oldPhrase: p.oldPhrase, newPhrase: p.newPhrase },
            ]);
            proposals.push({
              findingId: f.id!,
              category: f.category,
              entity: f.entity,
              attribute: f.attribute,
              canonicalValue: p.canonicalValue,
              targetChapter: chapterLabel,
              oldPhrase: p.oldPhrase,
              newPhrase: p.newPhrase,
              note: p.note,
              anchored: dry.applied.length === 1,
            });
          }
        } catch {
          // Best-effort per chapter: a failed chapter contributes unanchored
          // proposals, never a 500.
          for (const f of chapterFindings) {
            proposals.push(unanchoredProposal(f, chapterLabel));
          }
        }
      }

      // Cache the anchored proposals server-side (per slug) so the apply route can
      // verify each confirmed edit was actually proposed here — the model output
      // is the only authority for what oldPhrase→newPhrase is a legitimate fix.
      const anchoredProposals = proposals.filter((p) => p.anchored);
      (gateway.consistencyFixProposals ??= new Map()).set(slug, anchoredProposals);

      res.json({ proposals });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── Apply-Fix: apply the author-confirmed edits deterministically ──
  // Body: { edits: ConfirmedEdit[] }. Each edited chapter is version-snapshotted
  // first (writeWithVersion), so every fix is revertible. The model is never here.
  app.post('/api/books/:slug/consistency-fix/apply', async (req: Request, res: Response) => {
    try {
      const slug = String(req.params.slug);
      if (!SLUG_RE.test(slug) || !services.books?.exists?.(slug)) {
        return res.status(404).json({ error: 'Book not found' });
      }
      const dataDir = services.books?.dataDirOf?.(slug);
      if (!dataDir) return res.status(404).json({ error: 'Book data directory not found' });
      if (!services.consistencyStore?.isAvailable?.()) {
        return res.status(503).json({ error: 'Consistency DB unavailable' });
      }

      const edits: ConfirmedEdit[] = Array.isArray(req.body?.edits)
        ? req.body.edits.filter(
            (e: any) =>
              e &&
              typeof e.findingId === 'string' &&
              typeof e.targetChapter === 'string' &&
              typeof e.oldPhrase === 'string' &&
              typeof e.newPhrase === 'string',
          )
        : [];

      // Trust boundary: apply only edits that match an anchored proposal this
      // server generated in the preceding propose call (not arbitrary client
      // find/replace). The cache is per-slug + ephemeral; if it's gone, the author
      // must re-prepare so they re-review the diff.
      const cached: ProposedEdit[] | undefined = gateway.consistencyFixProposals?.get(slug);
      if (!cached) {
        return res.status(409).json({ error: 'No proposed fixes to confirm — run "Prepare fixes" first.' });
      }
      const vetted = new Set(cached.map((p) => `${p.findingId} ${p.oldPhrase} ${p.newPhrase}`));
      const labelOf = new Map(edits.map((e) => [e.findingId, e.targetChapter]));

      const outcome: ApplyOutcome = { applied: [], skipped: [] };
      const chaptersWritten: string[] = [];

      // Resolve each edit to its on-disk file and group by FILENAME so a combined
      // manuscript (many chapter labels → one file) is read/applied/written once.
      const byFile = new Map<string, { fileText: string; edits: ConfirmedEdit[] }>();
      for (const e of edits) {
        if (!vetted.has(`${e.findingId} ${e.oldPhrase} ${e.newPhrase}`)) {
          outcome.skipped.push({ findingId: e.findingId, targetChapter: e.targetChapter, oldPhrase: e.oldPhrase, reason: 'unverified' });
          continue;
        }
        const resolved = resolveChapterFile(dataDir, e.targetChapter);
        if (!resolved) {
          outcome.skipped.push({ findingId: e.findingId, targetChapter: e.targetChapter, oldPhrase: e.oldPhrase, reason: 'not-found' });
          continue;
        }
        // Path-safety: skip (don't abort mid-batch — earlier files may be written).
        if (!safePath(dataDir, resolved.filename)) {
          outcome.skipped.push({ findingId: e.findingId, targetChapter: e.targetChapter, oldPhrase: e.oldPhrase, reason: 'path-blocked' });
          continue;
        }
        const g = byFile.get(resolved.filename);
        if (g) g.edits.push(e);
        else byFile.set(resolved.filename, { fileText: resolved.fileText, edits: [e] });
      }

      for (const [filename, grp] of byFile) {
        const applyResult = applyEditsToText(
          grp.fileText,
          grp.edits.map((e) => ({ findingId: e.findingId, oldPhrase: e.oldPhrase, newPhrase: e.newPhrase })),
        );
        for (const a of applyResult.applied) {
          outcome.applied.push({ findingId: a.findingId, targetChapter: labelOf.get(a.findingId) ?? filename, oldPhrase: a.oldPhrase, newPhrase: a.newPhrase });
        }
        for (const s of applyResult.skipped) {
          outcome.skipped.push({ findingId: s.findingId, targetChapter: labelOf.get(s.findingId) ?? filename, oldPhrase: s.oldPhrase, reason: s.reason });
        }
        if (applyResult.applied.length > 0) {
          await writeWithVersion(dataDir, filename, applyResult.newText);
          chaptersWritten.push(filename);
          services.activityLog?.log?.({
            type: 'file_saved',
            source: 'api',
            message: `Applied ${applyResult.applied.length} consistency fix(es) to ${filename}`,
            metadata: { book: slug, fileName: filename, fixesApplied: applyResult.applied.length },
          });
        }
      }

      res.json({ ...outcome, chaptersWritten });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });
}

/** A proposal for a finding we couldn't get an anchored edit for (file missing,
 * model omitted it, or the chapter call failed). Surfaced as anchored:false so the
 * author sees it in the preview rather than silently losing it. */
function unanchoredProposal(f: ConsistencyFinding, chapterLabel: string): ProposedEdit {
  return {
    findingId: f.id!,
    category: f.category,
    entity: f.entity,
    attribute: f.attribute,
    canonicalValue: '',
    targetChapter: chapterLabel,
    oldPhrase: '',
    newPhrase: '',
    note: f.suggestedFix ?? '',
    anchored: false,
  };
}
