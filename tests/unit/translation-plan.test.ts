import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TranslationPipelineService,
  type TargetLanguage,
} from '../../gateway/src/services/translation-pipeline.js';

// ─────────────────────────────────────────────────────────────────────────────
// Characterization tests for the PURE planning surface of the translation pipeline:
//   - plan(): cost estimate, ROI rankings, recommendedOrder sort, disclaimer lines
//   - proposeTranslation(): timeline math + fr-specific disclosure + France legal note,
//     exercised through a stub ConfirmationGateService (no real gate).
// The gate-execution path itself is smoke-covered elsewhere; here we only test the
// deterministic planning/estimate logic.
// ─────────────────────────────────────────────────────────────────────────────

const svc = new TranslationPipelineService();

// DEEPL (0.025) + POST_EDIT (0.015) = 0.04 per 1k words.
const COST_PER_1K = 0.04;

test('plan: cost = round(kWords * 0.04, 2 dp) per language', () => {
  const p = svc.plan({
    projectId: 'p1',
    bookTitle: 'Book',
    targetLangs: ['de'],
    estimatedWordCount: 80000,
  });
  // 80k words → 80 * 0.04 = 3.2
  assert.equal(p.estimatedCostByLang.de.usd, 3.2);
  assert.match(p.estimatedCostByLang.de.notes, /80,000 words/);
  assert.match(p.estimatedCostByLang.de.notes, /\$0\.040\/1k/);
});

test('plan: defaults sourceLang to "en"', () => {
  const p = svc.plan({ projectId: 'p', bookTitle: 'B', targetLangs: ['es'], estimatedWordCount: 1000 });
  assert.equal(p.sourceLang, 'en');
});

test('plan: explicit sourceLang is preserved', () => {
  const p = svc.plan({ projectId: 'p', bookTitle: 'B', sourceLang: 'sv', targetLangs: ['es'], estimatedWordCount: 1000 });
  assert.equal(p.sourceLang, 'sv');
});

test('plan: unknown target language is silently skipped (no cost, no roi entry)', () => {
  const p = svc.plan({
    projectId: 'p',
    bookTitle: 'B',
    targetLangs: ['de', 'xx' as TargetLanguage],
    estimatedWordCount: 50000,
  });
  assert.deepEqual(Object.keys(p.estimatedCostByLang), ['de']);
  assert.equal(p.roiRankings.length, 1);
  // But targetLangs echoes the original input verbatim (including the unknown).
  assert.deepEqual(p.targetLangs, ['de', 'xx']);
});

test('plan: roiRankings + recommendedOrder sorted by revenueMultiplier desc', () => {
  // de revenue 1.1, fr 0.6, nl 0.9  → order: de(1.1), nl(0.9), fr(0.6)
  const p = svc.plan({
    projectId: 'p',
    bookTitle: 'B',
    targetLangs: ['fr', 'nl', 'de'],
    estimatedWordCount: 10000,
  });
  assert.deepEqual(p.recommendedOrder, ['de', 'nl', 'fr']);
  assert.deepEqual(p.roiRankings.map(r => r.lang), ['de', 'nl', 'fr']);
});

test('plan: roiRankings carry market + multipliers + rationale from MARKET_PROFILES', () => {
  const p = svc.plan({ projectId: 'p', bookTitle: 'B', targetLangs: ['fr'], estimatedWordCount: 1000 });
  const fr = p.roiRankings[0];
  assert.equal(fr.market, 'France');
  assert.equal(fr.estimatedReaderMultiplier, 0.2);
  assert.equal(fr.estimatedRevenueMultiplier, 0.6);
  assert.match(fr.rationale, /AI-disclosure legally required/);
});

test('plan: disclaimerLines ALWAYS include the France legal-disclosure note', () => {
  // Even with NO French target, the disclaimer set is fixed and includes the France note.
  const p = svc.plan({ projectId: 'p', bookTitle: 'B', targetLangs: ['de'], estimatedWordCount: 1000 });
  assert.equal(p.disclaimerLines.length, 4);
  assert.ok(p.disclaimerLines.some(l => /France \(Code de la consommation/.test(l)));
});

test('plan: empty targetLangs => empty cost map, empty rankings, empty recommended order', () => {
  const p = svc.plan({ projectId: 'p', bookTitle: 'B', targetLangs: [], estimatedWordCount: 1000 });
  assert.deepEqual(p.estimatedCostByLang, {});
  assert.deepEqual(p.roiRankings, []);
  assert.deepEqual(p.recommendedOrder, []);
  assert.equal(p.disclaimerLines.length, 4); // still present
});

// ── proposeTranslation: timeline math + fr disclosure, via a stub gate ──────────

interface CapturedRequest {
  service: string;
  action: string;
  platform: string;
  disclosures: string[];
  dryRunResult: string;
  estimatedCost: number;
  isReversible: boolean;
  riskLevel: string;
}

function stubGate(): { gate: any; captured: CapturedRequest[] } {
  const captured: CapturedRequest[] = [];
  const gate = {
    createRequest: async (req: any) => {
      captured.push(req);
      return { id: 'conf-123' };
    },
  };
  return { gate, captured };
}

test('proposeTranslation: throws if gate not wired', async () => {
  const fresh = new TranslationPipelineService();
  await assert.rejects(
    fresh.proposeTranslation({ projectId: 'p', bookTitle: 'B', targetLang: 'de', estimatedWordCount: 1000 }),
    /not wired to confirmation gate/,
  );
});

test('proposeTranslation: unsupported target language throws', async () => {
  const fresh = new TranslationPipelineService();
  const { gate } = stubGate();
  fresh.setGate(gate);
  await assert.rejects(
    fresh.proposeTranslation({ projectId: 'p', bookTitle: 'B', targetLang: 'xx' as TargetLanguage, estimatedWordCount: 1000 }),
    /Unsupported target language: xx/,
  );
});

test('proposeTranslation (fr): injects French disclosure text + FRANCE LEGAL NOTE', async () => {
  const fresh = new TranslationPipelineService();
  const { gate, captured } = stubGate();
  fresh.setGate(gate);
  const res = await fresh.proposeTranslation({
    projectId: 'p', bookTitle: 'My Book', targetLang: 'fr', estimatedWordCount: 60000,
  });
  assert.equal(res.confirmationId, 'conf-123');
  const req = captured[0];
  assert.equal(req.action, 'translate-to-fr');
  assert.equal(req.platform, 'France');
  assert.equal(req.isReversible, false);
  assert.equal(req.riskLevel, 'high');
  // fr disclosure text
  assert.ok(req.disclosures[0].includes('Traduction assistée par intelligence artificielle'));
  assert.match(req.dryRunResult, /FRANCE LEGAL NOTE/);
  // estimatedCost = 60k → 60 * 0.04 = 2.4
  assert.equal(req.estimatedCost, 60000 / 1000 * COST_PER_1K);
});

test('proposeTranslation (non-fr): generic disclosure, NO France legal note, review-rating note instead', async () => {
  const fresh = new TranslationPipelineService();
  const { gate, captured } = stubGate();
  fresh.setGate(gate);
  await fresh.proposeTranslation({ projectId: 'p', bookTitle: 'B', targetLang: 'de', estimatedWordCount: 30000 });
  const req = captured[0];
  assert.ok(req.disclosures[0].includes('Translated with AI assistance and human review'));
  assert.doesNotMatch(req.dryRunResult, /FRANCE LEGAL NOTE/);
  assert.match(req.dryRunResult, /rate undisclosed machine translations lower/);
});

test('proposeTranslation: timeline = ceil(words/30000) DeepL days + ceil(words/20000) post-edit days', async () => {
  const fresh = new TranslationPipelineService();
  const { gate, captured } = stubGate();
  fresh.setGate(gate);
  // 50000 words → ceil(50000/30000)=2 DeepL days, ceil(50000/20000)=3 post-edit days.
  await fresh.proposeTranslation({ projectId: 'p', bookTitle: 'B', targetLang: 'de', estimatedWordCount: 50000 });
  const req = captured[0];
  assert.match(req.dryRunResult, /2 day\(s\) for DeepL \+ 3 day\(s\) for Claude post-edit/);
});

// ── generateRightsPitch: deterministic markdown one-pager ───────────────────────

test('generateRightsPitch: fills market/lang/genre and lists comps when provided', () => {
  const pkg = svc.generateRightsPitch({
    targetLang: 'de', bookTitle: 'Storm', authorName: 'Ada', genre: 'Romantasy',
    wordCountApprox: 95000, comps: ['Comp A', 'Comp B'],
  });
  assert.equal(pkg.market, 'Germany / DACH');
  assert.match(pkg.pitchOnePager, /# Storm — Rights Pitch \(Germany \/ DACH\)/);
  assert.match(pkg.pitchOnePager, /- Comp A/);
  assert.match(pkg.pitchOnePager, /- Comp B/);
  assert.equal(pkg.metadataTemplate.comps.length, 2);
});

test('generateRightsPitch: no comps => placeholder line, metadata comps = []', () => {
  const pkg = svc.generateRightsPitch({
    targetLang: 'es', bookTitle: 'B', authorName: 'A', genre: 'SF', wordCountApprox: 1000,
  });
  assert.match(pkg.pitchOnePager, /Author: add 3-5 recent bestsellers/);
  assert.deepEqual(pkg.metadataTemplate.comps, []);
});
