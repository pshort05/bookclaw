import type { WorldDocCatalogRow, LibraryWorld, WorldDocumentType } from '@bookclaw/shared';

export interface DocDomainBucket { domain: string; rows: WorldDocCatalogRow[]; }
export interface DocTypeGroup { type: WorldDocumentType; domains: DocDomainBucket[]; count: number; }

/** Group rows by config document-type order, then by config domain order.
 *  Unknown types/domains fall to a trailing "Other" bucket. Filtered by `q`
 *  (matches title, summary, tags, classification). */
export function groupDocs(rows: WorldDocCatalogRow[], config: LibraryWorld, q = ''): DocTypeGroup[] {
  const query = q.trim().toLowerCase();
  const match = (r: WorldDocCatalogRow) =>
    !query || `${r.title} ${r.summary} ${r.tags.join(' ')} ${r.classification}`.toLowerCase().includes(query);
  const visible = rows.filter(match);
  const typeOrder = [...config.documentTypes, { id: '_other', label: 'Other' } as WorldDocumentType];
  const domainOrder = [...config.domains, '_other'];
  return typeOrder
    .map((type) => {
      const inType = visible.filter((r) => (type.id === '_other'
        ? !config.documentTypes.some((t) => t.id === r.type)
        : r.type === type.id));
      const domains = domainOrder
        .map((domain) => ({
          domain,
          rows: inType.filter((r) => (domain === '_other'
            ? !config.domains.includes(r.domain)
            : r.domain === domain)),
        }))
        .filter((b) => b.rows.length > 0);
      return { type, domains, count: inType.length };
    })
    .filter((g) => g.count > 0);
}
