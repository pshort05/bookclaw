// Pure builder for the POST /api/books body from a Starter Bundle.
// ZERO runtime imports: the only import is `import type` (erased by tsx/esbuild),
// so the backend unit test can import this under NodeNext without resolving a
// Vite alias, and the StarterBundle shape stays defined in exactly one place.
import type { StarterBundle } from '../data/bundles';

export function bundleToCreateBody(
  bundle: StarterBundle,
  title: string,
  pipelines: string[],
  preferredProvider?: string,
  preferredModel?: string,
): Record<string, unknown> {
  return {
    title: title.trim(),
    author: bundle.author,
    voice: bundle.voice,
    genre: bundle.genre,
    sequence: bundle.sequence,
    pipelineSequence: pipelines,
    structure: bundle.format.structure,
    form: bundle.format.form,
    chapterCount: bundle.format.chapterCount,
    wordsPerChapter: bundle.format.wordsPerChapter,
    ...(preferredProvider ? { preferredProvider } : {}),
    ...(preferredModel ? { preferredModel } : {}),
  };
}
