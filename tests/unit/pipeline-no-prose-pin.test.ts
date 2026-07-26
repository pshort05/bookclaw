import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Every prose pipeline: the author/book role-model layer only takes effect if the
// scene_brief/draft steps do NOT carry a baked modelOverride (which would win as a
// manual pin and shadow the author default). This guards against a pin being re-added.
const FILES = [
  'romance-spicy-deterministic', 'romance-sweet-deterministic', 'romance-spicy-full',
  'romance-sweet-full', 'romance-sweet-full-legacy', 'romance-spicy', 'romance-sweet',
  'msf-phase4-prose', 'nerdynovelistai-stage5-chapters', 'romantasy-production',
  'technothriller-production', 'scene-drafter',
];

function walkSteps(node: unknown, out: any[] = []): any[] {
  if (Array.isArray(node)) { for (const n of node) walkSteps(n, out); return out; }
  if (node && typeof node === 'object') {
    const o = node as Record<string, unknown>;
    if (typeof o.role === 'string' && ('promptTemplate' in o || 'skill' in o || 'label' in o)) out.push(o);
    for (const v of Object.values(o)) walkSteps(v, out);
  }
  return out;
}

test('no prose pipeline pins a model on scene_brief/draft steps', () => {
  for (const name of FILES) {
    const json = JSON.parse(readFileSync(join(ROOT, 'library', 'pipelines', `${name}.json`), 'utf-8'));
    for (const step of walkSteps(json)) {
      if (step.role === 'scene_brief' || step.role === 'draft') {
        assert.equal(step.modelOverride, undefined, `${name}: ${step.role} step still has a modelOverride`);
      }
    }
  }
});
