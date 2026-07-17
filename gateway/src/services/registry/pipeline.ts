/**
 * Draft-completion seam helper. Called at every draft-strip site (headless
 * index.ts + studio /execute + /auto-execute) immediately after
 * stripMetaCommentary and BEFORE the chapter file is written — so a manifest
 * can NEVER survive into the saved chapter prose. Strips the manifest (with the
 * conditional light-model remnant sweep on failure) and diffs the result into
 * review-gate name candidates. Fully fail-soft: any error keeps the chapter
 * as-is with zero candidates (never crash, never block, never leak).
 */

import { sweepManifestRemnant } from './remnant-sweep.js';
import { diffManifest, type NameCandidate } from './candidates.js';
import type { NameRegistry } from './types.js';

export async function processDraftManifest(args: {
  chapter: string;
  registry: NameRegistry;
  aiComplete: (req: any) => Promise<{ text?: string }>;
}): Promise<{ chapter: string; candidates: NameCandidate[] }> {
  try {
    const swept = await sweepManifestRemnant({ text: args.chapter, aiComplete: args.aiComplete });
    return {
      chapter: swept.stripped,
      candidates: diffManifest(swept.recovered, args.registry).filter(c => c.kind !== 'known'),
    };
  } catch (e) {
    console.log(`  ⚠ Registry: manifest processing failed — chapter kept as-is: ${(e as Error).message}`);
    return { chapter: args.chapter, candidates: [] };
  }
}
