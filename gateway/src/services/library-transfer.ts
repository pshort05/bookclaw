/**
 * BookClaw Library Transfer Service (book-container Phase 12).
 *
 * Library entry ⇆ portable .zip. export() reads the RESOLVED entry through
 * LibraryService.get (built-ins are exportable too) and zips a uniform shape:
 * `library-entry.json` manifest + `files/<...>`. The import side mirrors the
 * book-transfer flow: extract the UNTRUSTED zip into an isolated staging dir
 * with the shared zip guards, validate the manifest + per-kind shape, scan
 * every staged text file with InjectionDetector, and only on finalize write
 * into the WORKSPACE OVERLAY (create-or-override by name — never built-ins).
 * Finalize is one-shot: it consumes the staging dir, so replays throw.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { randomUUID } from 'crypto';
import AdmZip from 'adm-zip';
import { ENTRY_NAME_RE, type LibraryService, type LibraryWriteBody } from './library.js';
import type { InjectionDetector } from '../security/injection.js';
import { LIBRARY_KINDS, type LibraryKind } from './library-types.js';
import { MD_FILE_RE, parsePipelineJson } from './book-types.js';
import { parseSequence } from './sequence-parse.js';
import { parseEditor } from './editor-parse.js';
import { parsePrompt } from './prompt-parse.js';
import { isUnsafeEntry, isSymlinkEntry, scannableFiles, scanStagedText, checkZipBudget, type ImportFinding } from './transfer-security.js';
import { SKILL_CATEGORIES, parseSteps } from '../skills/loader.js';

export const ENTRY_FORMAT_VERSION = 1;

const MANIFEST_NAME = 'library-entry.json';
/** Top-level paths allowed inside an exported/imported entry zip. */
const WHITELIST_PREFIXES = [MANIFEST_NAME, 'files/'];
/** Same frontmatter shape SkillLoader.parseSkill requires (it returns null without it). */
const FRONTMATTER_RE = /^---\n[\s\S]*?\n---/;
// SkillLoader only scans SKILL_CATEGORIES; a skill written under any other
// directory would silently never load, so the importer clamps the category to
// that set (imported from the loader to stay in sync). Default mirrors synthetics.
const DEFAULT_SKILL_CATEGORY = 'author';

export interface EntryManifest {
  formatVersion: number;
  kind: LibraryKind;
  name: string;
  description?: string;
  category?: string;   // skills only
  appVersion?: string;
  exportedAt?: string;
}

export interface EntryStageResult {
  stagingId: string;
  manifest?: EntryManifest;
  findings: ImportFinding[];
  structuralError?: string;
}

export interface EntrySummary { kind: LibraryKind; name: string; source: 'workspace'; }

/** Clamp a manifest category to a loader-loadable one (default mirrors synthetics). */
function sanitizeCategory(category: string | undefined): string {
  return category && (SKILL_CATEGORIES as readonly string[]).includes(category)
    ? category : DEFAULT_SKILL_CATEGORY;
}

export class LibraryTransferService {
  constructor(
    private library: LibraryService,
    private injection: InjectionDetector,
    private stagingDir: string,
    private workspaceSkillsDir: string,
    private reloadSkills?: () => Promise<void>,
  ) {}

  /** Zip one resolved library entry (manifest + files/). Throws if unknown. */
  export(kind: LibraryKind, name: string): Buffer {
    if (!(LIBRARY_KINDS as readonly string[]).includes(kind)) throw new Error(`Invalid kind: ${kind}`);
    if (!ENTRY_NAME_RE.test(name)) throw new Error(`Invalid name: ${name}`);
    if (kind === 'world') throw new Error('world transfer is not supported yet (Phase 1)');
    const entry = this.library.get(kind, name);
    if (!entry) throw new Error(`Entry not found: ${kind}/${name}`);
    if (kind === 'skill' && entry.source === 'synthetic') {
      throw new Error('synthetic skills are generated at runtime and cannot be exported');
    }
    const zip = new AdmZip();
    if (kind === 'pipeline') {
      // get() returns the parsed pipeline only; import re-validates via parsePipelineJson.
      zip.addFile('files/pipeline.json', Buffer.from(JSON.stringify(entry.pipeline, null, 2) + '\n', 'utf-8'));
    } else if (kind === 'sequence') {
      // get() returns the parsed sequence only; import re-validates via parseSequence.
      zip.addFile('files/sequence.json', Buffer.from(JSON.stringify(entry.sequence, null, 2) + '\n', 'utf-8'));
    } else if (kind === 'editor') {
      // get() returns the parsed editor only; import re-validates via parseEditor.
      zip.addFile('files/editor.json', Buffer.from(JSON.stringify(entry.editor, null, 2) + '\n', 'utf-8'));
    } else if (kind === 'prompt') {
      // get() returns the parsed prompt only; import re-validates via parsePrompt.
      zip.addFile('files/prompt.json', Buffer.from(JSON.stringify(entry.prompt, null, 2) + '\n', 'utf-8'));
    } else if (kind === 'section') {
      zip.addFile(`files/${name}.md`, Buffer.from(entry.content ?? '', 'utf-8'));
    } else if (kind === 'skill') {
      // category is NOT in LibraryService's skill read surface — omitted; the importer defaults.
      zip.addFile('files/SKILL.md', Buffer.from(entry.content ?? '', 'utf-8'));
      // Executable skills (multi-step) carry a sibling steps.json so they round-trip.
      if (entry.steps && entry.steps.length) {
        zip.addFile('files/steps.json', Buffer.from(JSON.stringify({ retries: entry.retries ?? 0, steps: entry.steps }, null, 2) + '\n', 'utf-8'));
      }
    } else {
      // author / voice / genre: the entry's .md files
      const files = entry.files ?? {};
      if (Object.keys(files).length === 0) throw new Error(`Entry has no files: ${kind}/${name}`);
      for (const [fname, content] of Object.entries(files)) {
        zip.addFile(`files/${fname}`, Buffer.from(content, 'utf-8'));
      }
    }
    const manifest: EntryManifest = {
      formatVersion: ENTRY_FORMAT_VERSION,
      kind,
      name,
      ...(entry.description !== undefined ? { description: entry.description } : {}),
      exportedAt: new Date().toISOString(),
    };
    zip.addFile(MANIFEST_NAME, Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf-8'));
    return zip.toBuffer();
  }

  // ── Import: validate + stage (the zip is UNTRUSTED) ─────────────────────────

  /** Extract an uploaded zip into an isolated staging dir, validate, scan. */
  validateAndStage(zip: Buffer): EntryStageResult {
    const stagingId = randomUUID();
    const stageDir = join(this.stagingDir, stagingId);
    mkdirSync(stageDir, { recursive: true });
    const fail = (msg: string): EntryStageResult => {
      try { rmSync(stageDir, { recursive: true, force: true }); } catch { /* noop */ }
      return { stagingId, findings: [], structuralError: msg };
    };
    let entries;
    try { entries = new AdmZip(zip).getEntries(); } catch { return fail('not a valid zip'); }
    const budgetError = checkZipBudget(entries);
    if (budgetError) return fail(budgetError);
    for (const e of entries) {
      if (e.isDirectory) continue;
      const name = e.entryName;
      // Reject symlink-mode entries (adm-zip writes regular files, but be explicit).
      const attr = (e.header as unknown as { attr?: number })?.attr;
      if (isSymlinkEntry(attr)) return fail(`symlink entry rejected: ${name}`);
      if (isUnsafeEntry(name, stageDir, WHITELIST_PREFIXES)) return fail(`unsafe entry rejected: ${name}`);
      const dest = join(stageDir, name);
      try {
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, e.getData());
      } catch {
        return fail(`failed to extract entry: ${name}`);
      }
    }
    const mfPath = join(stageDir, MANIFEST_NAME);
    if (!existsSync(mfPath)) return fail(`${MANIFEST_NAME} missing`);
    let manifest: EntryManifest;
    try { manifest = JSON.parse(readFileSync(mfPath, 'utf-8')) as EntryManifest; } catch { return fail(`${MANIFEST_NAME} is not valid JSON`); }
    // formatVersion is fail-closed: unknown → reject, never coerce.
    if (manifest.formatVersion !== ENTRY_FORMAT_VERSION) return fail(`unsupported formatVersion: ${manifest.formatVersion}`);
    if (!(LIBRARY_KINDS as readonly string[]).includes(manifest.kind)) return fail(`unknown kind: ${manifest.kind}`);
    if (manifest.kind === 'world') return fail('world transfer is not supported yet (Phase 1)');
    if (typeof manifest.name !== 'string' || !ENTRY_NAME_RE.test(manifest.name)) return fail('invalid entry name');
    const shapeError = this.validateKindShape(stageDir, manifest.kind);
    if (shapeError) return fail(shapeError);
    if (manifest.kind === 'skill') manifest.category = sanitizeCategory(manifest.category);
    const findings = scanStagedText(stageDir, scannableFiles(stageDir, ['files'], [MANIFEST_NAME]), this.injection);
    return { stagingId, manifest, findings };
  }

  /** Per-kind structural validation of the staged files/ tree. Null = ok. */
  private validateKindShape(stageDir: string, kind: LibraryKind): string | null {
    const filesDir = join(stageDir, 'files');
    const items = existsSync(filesDir) ? readdirSync(filesDir, { withFileTypes: true }) : [];
    if (items.some(e => !e.isFile())) return 'files/ must contain plain files only';
    const names = items.map(e => e.name);
    if (kind === 'pipeline') {
      if (names.length !== 1 || names[0] !== 'pipeline.json') return 'pipeline requires exactly files/pipeline.json';
      try { parsePipelineJson(readFileSync(join(filesDir, 'pipeline.json'), 'utf-8')); }
      catch (err) { return `invalid pipeline.json: ${(err as Error).message}`; }
      return null;
    }
    if (kind === 'sequence') {
      if (names.length !== 1 || names[0] !== 'sequence.json') return 'sequence requires exactly files/sequence.json';
      try { parseSequence(JSON.parse(readFileSync(join(filesDir, 'sequence.json'), 'utf-8'))); }
      catch (err) { return `invalid sequence.json: ${(err as Error).message}`; }
      return null;
    }
    if (kind === 'prompt') {
      if (names.length !== 1 || names[0] !== 'prompt.json') return 'prompt requires exactly files/prompt.json';
      try { parsePrompt(JSON.parse(readFileSync(join(filesDir, 'prompt.json'), 'utf-8'))); }
      catch (err) { return `invalid prompt.json: ${(err as Error).message}`; }
      return null;
    }
    if (kind === 'editor') {
      if (names.length !== 1 || names[0] !== 'editor.json') return 'editor requires exactly files/editor.json';
      try { parseEditor(JSON.parse(readFileSync(join(filesDir, 'editor.json'), 'utf-8'))); }
      catch (err) { return `invalid editor.json: ${(err as Error).message}`; }
      return null;
    }
    if (kind === 'section') {
      if (names.length !== 1 || !MD_FILE_RE.test(names[0])) return 'section requires exactly one .md file';
      return null;
    }
    if (kind === 'skill') {
      // SKILL.md is required; steps.json (executable skills) is the only allowed extra.
      if (!names.includes('SKILL.md')) return 'skill requires files/SKILL.md';
      const extras = names.filter(n => n !== 'SKILL.md');
      if (extras.some(n => n !== 'steps.json')) return 'skill allows only files/SKILL.md and files/steps.json';
      if (!FRONTMATTER_RE.test(readFileSync(join(filesDir, 'SKILL.md'), 'utf-8'))) return 'SKILL.md is missing YAML frontmatter';
      if (names.includes('steps.json') && !parseSteps(readFileSync(join(filesDir, 'steps.json'), 'utf-8'))) {
        return 'invalid steps.json: each phase needs a non-empty model + prompt';
      }
      return null;
    }
    // author / voice / genre: ≥1 .md file, every filename valid
    if (names.length === 0) return `${kind} requires at least one .md file`;
    for (const n of names) { if (!MD_FILE_RE.test(n)) return `invalid file name: ${n}`; }
    return null;
  }

  /** Delete one staging dir (guarded to the staging root). */
  purgeStaging(stagingId: string): void {
    if (!stagingId || stagingId.includes('/') || stagingId.includes('..')) return;
    const p = join(this.stagingDir, stagingId);
    if (p.startsWith(this.stagingDir + '/')) { try { rmSync(p, { recursive: true, force: true }); } catch { /* noop */ } }
  }

  // ── Import: finalize (one-shot — consumes the staging dir) ──────────────────

  /** Write the staged entry into the workspace overlay (create-or-override by name). */
  async finalizeImport(stagingId: string): Promise<EntrySummary> {
    if (!stagingId || stagingId.includes('/') || stagingId.includes('..')) throw new Error('invalid stagingId');
    const stageDir = join(this.stagingDir, stagingId);
    const mfPath = join(stageDir, MANIFEST_NAME);
    if (!existsSync(mfPath)) throw new Error('staged entry missing (consumed or expired?)');
    const manifest = JSON.parse(readFileSync(mfPath, 'utf-8')) as EntryManifest;
    const { kind, name } = manifest;
    // Defense in depth: re-validate before interpolating into write paths
    // (validateAndStage already checked, but don't trust staged bytes).
    if (!(LIBRARY_KINDS as readonly string[]).includes(kind) || typeof name !== 'string' || !ENTRY_NAME_RE.test(name)) {
      throw new Error('staged manifest invalid');
    }
    const filesDir = join(stageDir, 'files');
    if (kind === 'skill') {
      const category = sanitizeCategory(manifest.category);
      const content = readFileSync(join(filesDir, 'SKILL.md'), 'utf-8');
      const destDir = join(this.workspaceSkillsDir, category, name);
      mkdirSync(destDir, { recursive: true });
      writeFileSync(join(destDir, 'SKILL.md'), content, 'utf-8');
      // Executable skills: re-validate the staged steps.json and write it through
      // normalized (parseSteps re-runs the loader's own validation — defense in depth).
      const stepsPath = join(filesDir, 'steps.json');
      if (existsSync(stepsPath)) {
        const parsed = parseSteps(readFileSync(stepsPath, 'utf-8'));
        if (parsed) writeFileSync(join(destDir, 'steps.json'), JSON.stringify({ retries: parsed.retries, steps: parsed.steps }, null, 2) + '\n', 'utf-8');
      }
      await this.reloadSkills?.();
    } else {
      const body: LibraryWriteBody = {};
      if (typeof manifest.description === 'string') body.description = manifest.description;
      if (kind === 'pipeline') {
        body.content = readFileSync(join(filesDir, 'pipeline.json'), 'utf-8');
      } else if (kind === 'sequence') {
        body.content = readFileSync(join(filesDir, 'sequence.json'), 'utf-8');
      } else if (kind === 'editor') {
        body.content = readFileSync(join(filesDir, 'editor.json'), 'utf-8');
      } else if (kind === 'prompt') {
        body.content = readFileSync(join(filesDir, 'prompt.json'), 'utf-8');
      } else if (kind === 'section') {
        const md = readdirSync(filesDir).find(n => n.endsWith('.md'));
        if (!md) throw new Error('staged section .md missing');
        body.content = readFileSync(join(filesDir, md), 'utf-8');
      } else {
        const files: Record<string, string> = {};
        for (const n of readdirSync(filesDir)) {
          if (n.endsWith('.md')) files[n] = readFileSync(join(filesDir, n), 'utf-8');
        }
        body.files = files;
      }
      // writeEntry re-runs the library's own validation — defense in depth.
      await this.library.writeEntry(kind, name, body);
      await this.library.reload();
    }
    this.purgeStaging(stagingId);
    return { kind, name, source: 'workspace' };
  }
}
