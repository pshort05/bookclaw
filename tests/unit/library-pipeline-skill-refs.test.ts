/**
 * Data-integrity guard (run-review 2026-07-01 B5): every `skill` referenced by a
 * shipped library pipeline must resolve to an installed, non-archived skill. A
 * dangling reference (e.g. a step whose skill was accidentally set to the
 * pipeline's own name) makes BookService.snapshot log
 * `⚠ skill "…" referenced by pipeline not found — skipping snapshot`, silently
 * dropping that skill from the book's template snapshot.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Installed skill identifiers (frontmatter `name`, falling back to dir basename),
 *  excluding the _archived tree and the gitignored premium overlay. */
function installedSkillNames(): Set<string> {
  const names = new Set<string>();
  const skillsRoot = join(REPO_ROOT, 'skills');
  for (const cat of readdirSync(skillsRoot)) {
    if (cat === '_archived' || cat === 'premium') continue;
    let subs: string[];
    try { subs = readdirSync(join(skillsRoot, cat)); } catch { continue; }
    for (const s of subs) {
      try {
        const md = readFileSync(join(skillsRoot, cat, s, 'SKILL.md'), 'utf8');
        const m = md.match(/^name:\s*(.+)$/m);
        names.add(m ? m[1].trim() : s);
      } catch { /* not a skill dir */ }
    }
  }
  return names;
}

test('every shipped library pipeline references only installed skills', () => {
  const installed = installedSkillNames();
  assert.ok(installed.has('cover-designer'), 'sanity: cover-designer skill is installed');

  const pipelinesDir = join(REPO_ROOT, 'library', 'pipelines');
  const missing: string[] = [];
  for (const f of readdirSync(pipelinesDir)) {
    if (!f.endsWith('.json')) continue;
    const pipeline = JSON.parse(readFileSync(join(pipelinesDir, f), 'utf8'));
    for (const step of pipeline.steps ?? []) {
      if (typeof step.skill === 'string' && step.skill.length > 0 && !installed.has(step.skill)) {
        missing.push(`${f}: step "${step.label}" → skill "${step.skill}"`);
      }
    }
  }
  assert.deepEqual(missing, [], `dangling pipeline skill references:\n${missing.join('\n')}`);
});
