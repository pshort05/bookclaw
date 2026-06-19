/**
 * EditorService — per-channel active developmental-editor pointers.
 *
 * Mirrors BookService.channelBooks: a small Map persisted to
 * workspace/.config/channel-editors.json, restored on init with a stale-prune
 * of pointers to editors the library no longer knows. The editor configs
 * themselves live in the library (`editor` kind); this service only tracks
 * which editor (if any) each channel is in session with.
 */
import { writeFile, mkdir } from 'fs/promises';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import type { LibraryEditor } from './library-types.js';
import type { EditorMode } from './editor-prompt.js';

interface LibraryLike {
  get(kind: string, name: string): { editor?: LibraryEditor } | undefined;
  list(): Array<{ kind: string; name: string; label?: string; description?: string }>;
}
export interface ActiveEditor { editor: string; withBook: boolean; mode: EditorMode; }

export class EditorService {
  private library: LibraryLike;
  private channelEditors = new Map<string, ActiveEditor>();
  private readonly ptrPath: string;

  constructor(workspaceDir: string, library: LibraryLike) {
    this.library = library;
    this.ptrPath = join(workspaceDir, '.config', 'channel-editors.json');
  }

  async initialize(): Promise<void> {
    this.channelEditors.clear();
    try {
      if (!existsSync(this.ptrPath)) return;
      const raw = JSON.parse(readFileSync(this.ptrPath, 'utf-8'));
      const obj = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw as Record<string, any> : {};
      let pruned = obj !== raw;
      for (const [ch, v] of Object.entries(obj)) {
        const name = v && typeof v === 'object' ? v.editor : undefined;
        if (typeof name === 'string' && this.get(name)) {
          // Legacy records (pre-mode) have no `mode` — default to brainstorm.
          const mode: EditorMode = v.mode === 'critique' ? 'critique' : 'brainstorm';
          this.channelEditors.set(ch, { editor: name, withBook: !!v.withBook, mode });
        } else { pruned = true; }
      }
      if (pruned) await this.persist();
    } catch { /* fail-soft: no editor sessions */ }
  }

  list(): Array<{ name: string; label?: string; description?: string; specialty?: string }> {
    return this.library.list().filter((e) => e.kind === 'editor')
      .map((e) => {
        // The catalog row may not carry `label`/`specialty`; resolve from the parsed editor.
        const full = this.get(e.name);
        return { name: e.name, label: full?.label ?? e.label, description: full?.description ?? e.description, specialty: full?.specialty };
      });
  }
  get(name: string): LibraryEditor | null {
    return this.library.get('editor', name)?.editor ?? null;
  }
  getChannelEditor(channel: string): ActiveEditor | null {
    return this.channelEditors.get(channel) ?? null;
  }
  async setChannelEditor(channel: string, name: string, withBook: boolean, mode: EditorMode = 'brainstorm'): Promise<void> {
    this.channelEditors.set(channel, { editor: name, withBook, mode });
    await this.persist();
  }
  async clearChannelEditor(channel: string): Promise<void> {
    this.channelEditors.delete(channel);
    await this.persist();
  }
  private async persist(): Promise<void> {
    try {
      await mkdir(dirname(this.ptrPath), { recursive: true });
      const obj: Record<string, ActiveEditor> = {};
      for (const [ch, v] of this.channelEditors) obj[ch] = v;
      await writeFile(this.ptrPath, JSON.stringify(obj, null, 2), 'utf-8');
    } catch { /* non-fatal */ }
  }
}
