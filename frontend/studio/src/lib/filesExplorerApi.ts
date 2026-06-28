import { api, apiBase, authToken } from '@bookclaw/shared';

export { buildTree, isTextName, type TreeNode } from './fileTree.js';

// Previews/edits need the raw file body; api() parses JSON, so fetch text directly.
async function fetchText(path: string): Promise<string> {
  const t = authToken();
  const res = await fetch(apiBase() + path, { headers: t ? { Authorization: `Bearer ${t}` } : {} });
  if (!res.ok) throw new Error(String(res.status));
  return res.text();
}

async function uploadForm(path: string, fd: FormData): Promise<{ path?: string }> {
  const t = authToken();
  const res = await fetch(apiBase() + path, { method: 'POST', headers: t ? { Authorization: `Bearer ${t}` } : {}, body: fd });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || String(res.status));
  return res.json().catch(() => ({}));
}

// Download via fetch + Blob so the bearer token stays in the Authorization header
// (out of the URL / browser history / access log / Referer). Throws on failure so
// the caller can surface an error.
export async function downloadFile(apiPath: string, saveAs: string): Promise<void> {
  const t = authToken();
  const sep = apiPath.includes('?') ? '&' : '?';
  const res = await fetch(`${apiBase()}${apiPath}${sep}download=1`, { headers: t ? { Authorization: `Bearer ${t}` } : {} });
  if (!res.ok) throw new Error(String(res.status));
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url; a.download = saveAs;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

// ── Book files (data/ + templates/) ──────────────────────────────────────────
export const listBookFiles = (slug: string) =>
  api<{ files: { path: string; group: string; bytes: number; modified: string }[] }>(`/api/books/${encodeURIComponent(slug)}/runner-files`);
export const readBookFile = (slug: string, path: string) =>
  fetchText(`/api/books/${encodeURIComponent(slug)}/file?path=${encodeURIComponent(path)}`);
export const writeBookFile = (slug: string, path: string, content: string) =>
  api(`/api/books/${encodeURIComponent(slug)}/file`, { method: 'PUT', body: JSON.stringify({ path, content }) });
export const bookFilePath = (slug: string, path: string): string =>
  `/api/books/${encodeURIComponent(slug)}/file?path=${encodeURIComponent(path)}`;
export const uploadToBookDir = (slug: string, dir: string, file: File) => {
  const fd = new FormData(); fd.append('dir', dir); fd.append('file', file);
  return uploadForm(`/api/books/${encodeURIComponent(slug)}/upload`, fd);
};

// ── Workspace documents (view/download/delete only) ───────────────────────────
export const listDocuments = () =>
  api<{ documents: { filename: string; size: number; wordCount?: number }[] }>('/api/documents');
export const readDocumentText = (name: string) => fetchText(`/api/documents/${encodeURIComponent(name)}`);
export const documentPath = (name: string): string => `/api/documents/${encodeURIComponent(name)}`;
export const deleteDocument = (name: string) => api(`/api/documents/${encodeURIComponent(name)}`, { method: 'DELETE' });
export const uploadDocument = (file: File) => {
  const fd = new FormData(); fd.append('file', file);
  return uploadForm('/api/documents/upload', fd);
};
