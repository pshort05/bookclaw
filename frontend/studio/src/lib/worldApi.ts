import { api, type LibraryWorld, type WorldDocCatalogRow, type WorldDocument, type WorldDocMeta, type WorldProposal, type AppendixEntry } from '@bookclaw/shared';

export interface WorldListRow { name: string; label?: string; description?: string; source: 'builtin' | 'workspace' | 'synthetic'; }

export const listWorlds = () =>
  api<{ worlds: WorldListRow[] }>('/api/worlds').then((r) => r.worlds ?? []);

export const getWorldConfig = (name: string) =>
  api<{ world: LibraryWorld }>(`/api/worlds/${encodeURIComponent(name)}`).then((r) => r.world);

export const listWorldDocs = (name: string) =>
  api<{ documents: WorldDocCatalogRow[] }>(`/api/worlds/${encodeURIComponent(name)}/documents`).then((r) => r.documents ?? []);

export const getWorldDoc = (name: string, docId: string) =>
  api<{ document: WorldDocument }>(`/api/worlds/${encodeURIComponent(name)}/documents/${encodeURIComponent(docId)}`).then((r) => r.document);

// create: classification optional (server auto-assigns when omitted)
export const createWorldDoc = (
  name: string,
  body: { meta: Omit<WorldDocMeta, 'classification'> & { classification?: string }; body: string },
) => api<{ document: WorldDocument }>(`/api/worlds/${encodeURIComponent(name)}/documents`, { method: 'POST', body: JSON.stringify(body) }).then((r) => r.document);

export const updateWorldDoc = (name: string, docId: string, body: { meta: WorldDocMeta; body: string }) =>
  api<{ document: WorldDocument }>(`/api/worlds/${encodeURIComponent(name)}/documents/${encodeURIComponent(docId)}`, { method: 'PUT', body: JSON.stringify(body) }).then((r) => r.document);

export const deleteWorldDoc = (name: string, docId: string) =>
  api<{ deleted: boolean }>(`/api/worlds/${encodeURIComponent(name)}/documents/${encodeURIComponent(docId)}`, { method: 'DELETE' });

// book binding / pull / appendix
export const proposeWorldDocs = (slug: string) =>
  api<{ proposals: WorldProposal[] }>(`/api/books/${encodeURIComponent(slug)}/world/propose`, { method: 'POST', body: '{}' }).then((r) => r.proposals ?? []);

export const saveWorldDocs = (slug: string, world: string, docIds: string[]) =>
  api<{ worldDocs: string[] }>(`/api/books/${encodeURIComponent(slug)}/world/docs`, { method: 'PUT', body: JSON.stringify({ world, docIds }) });

export const saveAppendix = (slug: string, appendix: AppendixEntry[]) =>
  api<{ appendix: AppendixEntry[] }>(`/api/books/${encodeURIComponent(slug)}/world/appendix`, { method: 'PUT', body: JSON.stringify({ appendix }) });

export const bindWorld = (slug: string, world: string) =>
  api<{ world: string; worldDocs: string[]; proposed: number }>(`/api/books/${encodeURIComponent(slug)}/world`, { method: 'PUT', body: JSON.stringify({ world }) });

export const unbindWorld = (slug: string) =>
  api<{ unbound: boolean }>(`/api/books/${encodeURIComponent(slug)}/world`, { method: 'DELETE' });
