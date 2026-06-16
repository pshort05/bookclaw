import { readFile, writeFile, mkdir, readdir, stat, rm } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

const vdir = (dataDir: string, filename: string) => join(dataDir, '.versions', filename);

/** Keep at most this many prior versions per file (oldest pruned). */
const MAX_VERSIONS = 20;

async function snapshot(dataDir: string, filename: string): Promise<void> {
  const src = join(dataDir, filename);
  if (!existsSync(src)) return;
  const dir = vdir(dataDir, filename);
  await mkdir(dir, { recursive: true });
  const prior = await readFile(src, 'utf-8');
  const id = new Date().toISOString().replace(/[:.]/g, '-') + '-' + Math.random().toString(36).slice(2, 6);
  await writeFile(join(dir, `${id}.md`), prior, 'utf-8');
  // Prune oldest beyond MAX_VERSIONS so the sidecar can't grow without bound.
  const ids = (await readdir(dir)).filter((f) => f.endsWith('.md')).sort(); // ids sort chronologically (ISO ts prefix)
  for (const old of ids.slice(0, Math.max(0, ids.length - MAX_VERSIONS))) {
    await rm(join(dir, old), { force: true });
  }
}

export async function writeWithVersion(dataDir: string, filename: string, content: string): Promise<void> {
  await snapshot(dataDir, filename);
  await mkdir(dataDir, { recursive: true });
  await writeFile(join(dataDir, filename), content, 'utf-8');
}
export async function listVersions(dataDir: string, filename: string): Promise<Array<{ id: string; at: string; bytes: number }>> {
  const dir = vdir(dataDir, filename);
  if (!existsSync(dir)) return [];
  const out: Array<{ id: string; at: string; bytes: number }> = [];
  for (const f of await readdir(dir)) {
    if (!f.endsWith('.md')) continue;
    const st = await stat(join(dir, f));
    out.push({ id: f.replace(/\.md$/, ''), at: st.mtime.toISOString(), bytes: st.size });
  }
  return out.sort((a, b) => b.id.localeCompare(a.id)); // newest first
}
export async function restoreVersion(dataDir: string, filename: string, id: string): Promise<void> {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('invalid version id');
  const vfile = join(vdir(dataDir, filename), `${id}.md`);
  if (!existsSync(vfile)) throw new Error('version not found');
  const content = await readFile(vfile, 'utf-8');
  await snapshot(dataDir, filename); // current snapshotted so a restore is itself undoable
  await writeFile(join(dataDir, filename), content, 'utf-8');
}
