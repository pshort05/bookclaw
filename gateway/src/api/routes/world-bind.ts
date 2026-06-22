import { serializeWorldDoc } from '../../services/world-parse.js';

/** Max docs auto-proposed into a book's initial bible at bind time (user trims). */
export const AUTO_PROPOSE_CAP = 15;

export interface BindResult { world: string; worldDocs: string[]; proposed: number; }

/**
 * Bind a book to a world: relevance-pull (capped) → snapshot as the initial bible.
 * snapshotWorldDocs sets pulledFrom.world + worldDocs atomically. Idempotent /
 * re-bindable (rm+rewrite of the snapshot). Throws on unknown world / unwritable book.
 */
export async function bindBookWorld(services: any, slug: string, worldName: string): Promise<BindResult> {
  const world = services.world;
  const books = services.books;
  if (!world || !books) throw new Error('World/Books service not initialized');
  if (!world.getConfig(worldName)) throw new Error(`World not found: ${worldName}`);

  const opened = await books.open(slug);
  if (!opened) throw new Error(`Book not found: ${slug}`);

  const signals = {
    title: opened.manifest.title,
    description: '',
    genre: opened.manifest.pulledFrom?.genre?.name ?? null,
    knownEntities: books.worldbuildingOf?.(slug) ?? '',
  };
  const ai = {
    complete: (r: any) => services.aiRouter.complete(r),
    select: (t: string) => services.aiRouter.selectProvider(t),
  };
  const proposals = await world.proposeWorldDocs(slug, signals, worldName, ai);
  const docIds = proposals.slice(0, AUTO_PROPOSE_CAP).map((p: any) => p.docId);

  const source = services.library?.get?.('world', worldName)?.source ?? 'workspace';
  const getConfigRaw = (n: string) => { const c = world.getConfig(n); return c ? JSON.stringify(c, null, 2) : null; };
  const getDocSerialized = (n: string, id: string) => { const d = world.getDocument(n, id); return d ? serializeWorldDoc(d.meta, d.body) : null; };

  const { written } = await books.snapshotWorldDocs(slug, { name: worldName, source }, docIds, getConfigRaw, getDocSerialized);
  return { world: worldName, worldDocs: written, proposed: proposals.length };
}

/** Unbind a book's world (clear binding + bible). Returns false if the book is gone. */
export async function unbindBookWorld(services: any, slug: string): Promise<boolean> {
  const books = services.books;
  if (!books) throw new Error('Books service not initialized');
  return books.clearWorld(slug);
}
