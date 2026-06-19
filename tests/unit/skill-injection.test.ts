/**
 * Unit tests for config-not-code pipelines follow-up F2: passiveSkillBlock centralizes
 * passive step-skill content injection so the studio run paths (projects.routes.ts
 * /execute + /auto-execute) get the same guidance the bridge path already injected.
 * It prefers the book's FROZEN snapshot (copy-on-create isolation), then falls back
 * to the mutable global SkillLoader.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { passiveSkillBlock } from '../../gateway/src/services/skill-runner.js';

const globalSkills = {
  getSkillByName(n: string) {
    return n === 'write' ? { name: 'write', content: 'GLOBAL write guidance' } : undefined;
  },
};

test('returns empty string when no skill name is given', () => {
  assert.equal(passiveSkillBlock({ skills: globalSkills }, undefined, 'book-a'), '');
  assert.equal(passiveSkillBlock({ skills: globalSkills }, '', 'book-a'), '');
});

test("prefers the book's frozen snapshot when present", () => {
  const books = { skillContentOf: (_slug: string | null, name: string) => (name === 'write' ? 'SNAPSHOT write guidance' : null) };
  const block = passiveSkillBlock({ skills: globalSkills, books }, 'write', 'book-a');
  assert.equal(block, '\n\n# Skill: write\n\nSNAPSHOT write guidance');
});

test('falls back to the global SkillLoader when the book has no snapshot', () => {
  const books = { skillContentOf: () => null };
  const block = passiveSkillBlock({ skills: globalSkills, books }, 'write', 'book-a');
  assert.equal(block, '\n\n# Skill: write\n\nGLOBAL write guidance');
});

test('uses the global SkillLoader when the project is not bound to a book', () => {
  const books = { skillContentOf: () => 'should-not-be-used' };
  // no bookSlug → snapshot lookup is skipped entirely, global is used
  const block = passiveSkillBlock({ skills: globalSkills, books }, 'write', null);
  assert.equal(block, '\n\n# Skill: write\n\nGLOBAL write guidance');
});

test('returns empty string when neither snapshot nor global skill resolves', () => {
  const books = { skillContentOf: () => null };
  assert.equal(passiveSkillBlock({ skills: globalSkills, books }, 'nonexistent', 'book-a'), '');
});
