/**
 * Bug L11: the POST /api/projects/:id/upload handler mutates the live project
 * returned by getProject() (the Map reference) but never flushes persistState,
 * so on restart the uploaded-manuscript context is lost. The fix exposes a
 * public saveState() the route calls after mutating context.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectEngine } from '../../gateway/src/services/projects.js';

const DEBOUNCE_WAIT = 1200; // persistState debounces at 1000ms

test('L11: saveState() persists mutated context.uploads across a restart', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-upload-persist-'));
  const eng = new ProjectEngine(undefined, root);
  const project = eng.createProject('custom' as any, 'Upload Persist', 'desc');

  // Simulate the upload route mutating the live project context.
  if (!project.context.uploads) project.context.uploads = [];
  project.context.uploads.push({ filename: 'manuscript.docx', wordCount: 42 });
  eng.saveState();

  await new Promise(r => setTimeout(r, DEBOUNCE_WAIT));

  // Fresh engine on the same root re-runs loadState in its constructor.
  const reloaded = new ProjectEngine(undefined, root);
  const after = reloaded.getProject(project.id);
  assert.ok(after, 'project should reload from disk');
  assert.ok(Array.isArray(after!.context.uploads), 'context.uploads should survive restart');
  assert.equal(after!.context.uploads.length, 1);
  assert.equal(after!.context.uploads[0].filename, 'manuscript.docx');
});

test('L11 (negative): without saveState the mutation is lost on restart', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-upload-nopersist-'));
  const eng = new ProjectEngine(undefined, root);
  const project = eng.createProject('custom' as any, 'Upload NoPersist', 'desc');
  // createProject itself persists; wait it out so the baseline is on disk.
  await new Promise(r => setTimeout(r, DEBOUNCE_WAIT));

  // Mutate context but do NOT call saveState — reproduces the dropped-context bug.
  if (!project.context.uploads) project.context.uploads = [];
  project.context.uploads.push({ filename: 'manuscript.docx', wordCount: 42 });

  await new Promise(r => setTimeout(r, DEBOUNCE_WAIT));

  const reloaded = new ProjectEngine(undefined, root);
  const after = reloaded.getProject(project.id);
  assert.ok(after, 'project should reload from disk');
  assert.ok(!after!.context.uploads || after!.context.uploads.length === 0,
    'uploads mutation must NOT be present without saveState');
});
