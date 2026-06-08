import { api, type LibraryEntry, type LibraryEntryFull, type LibraryKind, type RepullAsset } from '@bookclaw/shared';

export type Scope = 'library' | 'book';

export async function listEntries(scope: Scope, kind: LibraryKind): Promise<LibraryEntry[]> {
  if (scope === 'library') {
    const r = await api<{ entries: LibraryEntry[] }>(`/api/library/${kind}`);
    return r.entries ?? [];
  }
  // book scope: sections list comes from the templates endpoint; others are single wired assets
  if (kind === 'section') {
    const r = await api<{ entries?: string[] }>(`/api/books/active/templates/section`);
    return (r.entries ?? []).map((name) => ({ kind, name, source: 'workspace' as const }));
  }
  // Book-scope skill editing is not supported in this UI; the endpoint 400s on list
  // (skill requires a name). Return empty without a server round-trip.
  if (kind === 'skill') return [];
  // author/voice/genre/pipeline: one wired entry named by the book's snapshot
  const t = await api<{ wired: boolean; description?: string }>(`/api/books/active/templates/${kind}`).catch(() => null);
  return t && t.wired ? [{ kind, name: kind, source: 'workspace', description: t.description }] : [];
}

export async function readEntry(scope: Scope, kind: LibraryKind, name: string): Promise<LibraryEntryFull> {
  if (scope === 'library') return (await api<{ entry: LibraryEntryFull }>(`/api/library/${kind}/${encodeURIComponent(name)}`)).entry;
  const seg = kind === 'section' || kind === 'skill' ? `/${encodeURIComponent(name)}` : '';
  const t = await api<Record<string, unknown>>(`/api/books/active/templates/${kind}${seg}`);
  const files = t.files as Record<string, string> | undefined;
  const content = t.content as string | undefined;
  const description = t.description as string | undefined;
  return { kind, name, source: 'workspace', files, content, description, pipeline: content ? safeParse(content) : undefined };
}

export async function writeEntry(scope: Scope, kind: LibraryKind, name: string, body: { files?: Record<string,string>; content?: string; description?: string }): Promise<void> {
  if (scope === 'library') { await api(`/api/library/${kind}/${encodeURIComponent(name)}`, { method: 'PUT', body: JSON.stringify(body) }); return; }
  const seg = kind === 'section' || kind === 'skill' ? `/${encodeURIComponent(name)}` : '';
  await api(`/api/books/active/templates/${kind}${seg}`, { method: 'PUT', body: JSON.stringify(body) });
}

export const createLibraryEntry = (kind: LibraryKind, name: string, body: object) => api(`/api/library/${kind}`, { method: 'POST', body: JSON.stringify({ name, ...body }) });
export const deleteLibraryEntry = (kind: LibraryKind, name: string) => api(`/api/library/${kind}/${encodeURIComponent(name)}`, { method: 'DELETE' });
export const repullStatus = () => api<{ assets: RepullAsset[] }>(`/api/books/active/repull`);
export const repullExecute = (kind: string, name: string, resolution?: 'take-library'|'keep-book') => api<{ hadConflicts: boolean }>(`/api/books/active/repull/${kind}/${encodeURIComponent(name)}`, { method: 'POST', body: JSON.stringify(resolution ? { resolution } : {}) });

function safeParse(s: string) { try { return JSON.parse(s); } catch { return undefined; } }
