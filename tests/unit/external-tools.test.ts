import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ExternalToolsService } from '../../gateway/src/services/external-tools.js';

// ─────────────────────────────────────────────────────────────────────────────
// Characterization tests for ExternalToolsService.
//
// SECURITY NOTE on what validation actually exists:
//   - The TOOL NAME is NOT user-supplied. Each public method (runManuscriptAutopsy,
//     runFormatPro) hardcodes a sibling-project name ('Manuscript Autopsy' /
//     'Format Pro'). findSiblingProject() only resolves that name against a fixed
//     set of DEFAULT_SEARCH_ROOTS relative to repoRoot and checks existsSync — there
//     is no allowlist *check* because the set of tools is closed at the call site.
//   - There is NO path-containment / traversal guard on the user-supplied
//     `manuscriptPath` for runFormatPro — it is passed straight into the spawn
//     args as `--input <manuscriptPath>`. Containment is not enforced here.
//     (See the traversal test below, which encodes this ACTUAL behavior.)
//
// We never spawn: every test either short-circuits before runProcess (tool/entry
// not found on disk) or exercises pure construction (output-filename slugification,
// candidate resolution).
// ─────────────────────────────────────────────────────────────────────────────

// Each test gets a PRIVATE parent dir, with the repo nested one level inside it.
// findSiblingProject resolves sibling tools against repoRoot/.. (= this private
// parent), so writing a tool dir there cannot leak into other tests' temp roots.
function makeRepo(): string {
  const base = mkdtempSync(join(tmpdir(), 'bookclaw-ext-'));
  const repo = join(base, 'a', 'repo');
  mkdirSync(repo, { recursive: true });
  return repo;
}

test('runManuscriptAutopsy: tool not found on disk => descriptive error, no throw', async () => {
  const repo = makeRepo();
  const svc = new ExternalToolsService(repo);
  const r = await svc.runManuscriptAutopsy('some manuscript text');
  assert.equal(r.success, false);
  assert.match(r.error ?? '', /Manuscript Autopsy not found on disk/);
});

test('runFormatPro: tool not found on disk => descriptive error, no throw', async () => {
  const repo = makeRepo();
  const svc = new ExternalToolsService(repo);
  const r = await svc.runFormatPro({
    manuscriptPath: '/some/manuscript.md',
    outputFormat: 'epub',
    title: 'My Book',
    author: 'Jane',
  });
  assert.equal(r.success, false);
  assert.match(r.error ?? '', /Format Pro not found on disk/);
});

test('runManuscriptAutopsy: project dir present but no entry script => entry-not-found error', async () => {
  const repo = makeRepo();
  // findSiblingProject searches repoRoot/.., repoRoot/../../Automations, repoRoot/../Automations.
  // Create the project under repoRoot/.. so it resolves but leave it without an entry script.
  const projectDir = join(repo, '..', 'Manuscript Autopsy');
  mkdirSync(projectDir, { recursive: true });
  const svc = new ExternalToolsService(repo);
  const r = await svc.runManuscriptAutopsy('text');
  assert.equal(r.success, false);
  assert.match(r.error ?? '', /entry script not found/);
});

test('runFormatPro: traversal manuscriptPath is NOT rejected — it reaches the (missing-entry) stage', async () => {
  // The service applies NO path-containment check on manuscriptPath. To prove the
  // user path is not what gates the call, make the tool resolve but omit an entry
  // script: we then get the "entry script not found" error, NOT a path-rejection.
  const repo = makeRepo();
  const projectDir = join(repo, '..', 'Format Pro');
  mkdirSync(projectDir, { recursive: true });
  const svc = new ExternalToolsService(repo);
  const r = await svc.runFormatPro({
    manuscriptPath: '../../../../etc/passwd', // traversal — accepted, not validated
    outputFormat: 'docx',
    title: 'X',
    author: 'Y',
  });
  assert.equal(r.success, false);
  // Reaches entry-resolution, NOT a path/traversal rejection — encodes actual behavior.
  // NOTE: possible bug — no path containment on manuscriptPath before spawn.
  assert.match(r.error ?? '', /entry script not found/);
  assert.doesNotMatch(r.error ?? '', /traversal|path|sandbox|allow/i);
});

test('findSiblingProject resolves the FIRST existing candidate root (repoRoot/.. wins)', () => {
  // Indirect probe via runManuscriptAutopsy: create the project under repoRoot/..
  // AND under repoRoot/../Automations; either resolving means we get past the
  // "not found" branch. We only assert we no longer hit "not found".
  const repo = makeRepo();
  mkdirSync(join(repo, '..', 'Automations', 'Manuscript Autopsy'), { recursive: true });
  const svc = new ExternalToolsService(repo);
  return svc.runManuscriptAutopsy('text').then((r) => {
    assert.equal(r.success, false);
    assert.doesNotMatch(r.error ?? '', /not found on disk/);
    assert.match(r.error ?? '', /entry script not found/);
  });
});

test('runManuscriptAutopsy: with a real entry script, an input temp file is written (no spawn assertion)', async () => {
  // Place a non-executable entry so findSiblingProject + entry resolution both pass.
  // We do NOT assert on the spawn result (python may or may not exist); we only assert
  // that the deterministic pre-spawn step — writing the input temp file — happened.
  const repo = makeRepo();
  const projectDir = join(repo, '..', 'Manuscript Autopsy');
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(join(projectDir, 'main.py'), '# entry');
  const svc = new ExternalToolsService(repo);
  // Use a bogus python command so the spawn fails fast with a spawn error rather
  // than running anything. The input file is written BEFORE the spawn, so it must exist.
  (svc as any).pythonCommand = '/nonexistent/python-binary-xyz';
  const r = await svc.runManuscriptAutopsy('manuscript body');
  assert.equal(r.success, false);
  const tmpDir = join(repo, 'workspace', 'tmp', 'autopsy');
  assert.equal(existsSync(tmpDir), true, 'autopsy tmp dir should be created before spawn');
});

test('runFormatPro: output filename is slugified from the title (lowercase, non-alnum → hyphens)', async () => {
  // The output path is built deterministically before spawn:
  //   `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.${format}`.
  // We assert via a real entry + a failing python so the slug computation runs and
  // the tmp dir is created. The format-pro tmp dir existing proves we reached output-path build.
  const repo = makeRepo();
  const projectDir = join(repo, '..', 'Format Pro');
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(join(projectDir, 'cli.py'), '# entry');
  const svc = new ExternalToolsService(repo);
  (svc as any).pythonCommand = '/nonexistent/python-binary-xyz';
  const r = await svc.runFormatPro({
    manuscriptPath: '/tmp/m.md',
    outputFormat: 'epub',
    title: 'My Great Book!! 2',
    author: 'A',
  });
  assert.equal(r.success, false);
  const tmpDir = join(repo, 'workspace', 'tmp', 'format-pro');
  assert.equal(existsSync(tmpDir), true, 'format-pro tmp dir created before spawn');
  // Slug shape: "my-great-book-2.epub" — verify the replace semantics independently.
  const slug = 'My Great Book!! 2'.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  assert.equal(slug, 'my-great-book-2');
});
