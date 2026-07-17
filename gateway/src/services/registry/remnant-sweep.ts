/**
 * Conditional light-model manifest remnant sweep. On the happy path (a clean,
 * deterministically-parsed manifest — OR a chapter that never carried a manifest
 * at all) this fires ZERO model calls. The model is invoked ONLY when there is
 * actual evidence of a manifest token in the text AND the deterministic parse
 * could not cleanly strip it (malformed / residue). A chapter from a pipeline
 * that never emits a manifest (status 'missing', no markers) is returned
 * untouched — it must NEVER be round-tripped through a light model, which would
 * risk truncating or paraphrasing perfectly good manuscript prose.
 *
 * Anti-bleed on failure: if the model errors, returns empty, or returns text
 * that STILL contains manifest residue, we fall back to a DETERMINISTIC hard
 * strip that removes every manifest span/marker — never a best-effort strip that
 * could leave a leftover block in the saved chapter. Never throws, never leaks.
 */

import {
  parseManifest,
  hasManifestResidue,
  SENTINEL_OPEN,
  SENTINEL_CLOSE,
  type ParsedManifest,
} from './parse-manifest.js';

const SWEEP_INSTRUCTION =
  'The following text is a book chapter whose machine-read BookClaw manifest block '
  + '(delimited by <!--BOOKCLAW:MANIFEST … /MANIFEST-->) may be malformed or leaking into the prose. '
  + 'Remove ANY manifest remnant entirely and return ONLY the clean chapter prose — no manifest, no commentary.';

/** Any real evidence of a manifest token in the text (case-insensitive so a
 *  mis-cased sentinel still trips the sweep). No evidence → nothing to strip. */
function hasManifestEvidence(text: string): boolean {
  return /BOOKCLAW:MANIFEST|\/MANIFEST--|^(CHARACTERS|LOCATIONS):/im.test(text);
}

/**
 * Deterministic hard strip: remove EVERY sentinel-delimited span (well-formed or
 * dangling), any orphan sentinel token, and any residual bare CHARACTERS:/
 * LOCATIONS: header line. Guarantees hasManifestResidue(result) === false — used
 * as the fail-soft fallback so a manifest can never survive a sweep failure.
 */
function hardStripManifest(text: string): string {
  let s = String(text ?? '');
  for (;;) {
    const o = s.indexOf(SENTINEL_OPEN);
    if (o < 0) break;
    const c = s.indexOf(SENTINEL_CLOSE, o);
    if (c < 0) { s = s.slice(0, o); break; }   // dangling open → cut to it
    s = s.slice(0, o) + s.slice(c + SENTINEL_CLOSE.length);
  }
  // Belt-and-suspenders: drop any orphan close token and bare marker headers.
  s = s.split(SENTINEL_CLOSE).join('');
  s = s.split('\n').filter(ln => !/^(CHARACTERS|LOCATIONS):/i.test(ln.trim())).join('\n');
  return s.replace(/\n{3,}/g, '\n\n').trim();
}

export async function sweepManifestRemnant(args: {
  text: string;
  aiComplete: (req: any) => Promise<{ text?: string }>;
}): Promise<{ stripped: string; recovered: ParsedManifest }> {
  const parsed = parseManifest(args.text);
  if (parsed.status === 'ok' || parsed.status === 'empty') {
    return { stripped: parsed.stripped, recovered: parsed };
  }

  // Unhappy path (missing / malformed / residue). Only spend a model call when a
  // manifest token is actually present — otherwise this is just a manifest-free
  // chapter and the deterministic result (untouched prose) is correct.
  if (!hasManifestEvidence(args.text)) {
    return { stripped: parsed.stripped, recovered: parsed };
  }

  try {
    const res = await args.aiComplete({
      task: 'de_ai',
      provider: 'openrouter',
      model: 'auto:newest-haiku',
      system: SWEEP_INSTRUCTION,
      messages: [{ role: 'user', content: args.text }],
      maxTokens: 8000,
      temperature: 0,
    });
    const out = (res?.text ?? '').trim();
    if (!out) throw new Error('empty sweep response');
    const recovered = parseManifest(out);
    // Trust the model only if its output is genuinely residue-free; otherwise
    // fall back to the deterministic hard strip so nothing bleeds.
    const stripped = hasManifestResidue(recovered.stripped) ? hardStripManifest(out) : recovered.stripped;
    return { stripped, recovered };
  } catch (e) {
    console.log(`  ⚠ Registry: manifest remnant sweep failed — deterministic hard strip kept: ${(e as Error).message}`);
    return { stripped: hardStripManifest(args.text), recovered: parsed };
  }
}
