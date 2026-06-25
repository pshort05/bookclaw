import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPromptRunReport } from '../../gateway/src/services/reports/render-prompt-run.js';

test('renders metadata block and output', () => {
  const out = renderPromptRunReport({
    prompt: 'line-edit', file: 'data/chapter-1.md', output: 'Edited prose here.',
    meta: { provider: 'openrouter', model: 'google/gemini-2.5-flash', tokensUsed: 1200, estimatedCost: 0.0012, ms: 4200 },
  });
  assert.equal(out.title, 'Prompt Run report');
  assert.match(out.markdown, /# Prompt Run report/);
  assert.match(out.markdown, /line-edit/);
  assert.match(out.markdown, /data\/chapter-1\.md/);
  assert.match(out.markdown, /openrouter\/google\/gemini-2\.5-flash/);
  assert.match(out.markdown, /## Output/);
  assert.match(out.markdown, /Edited prose here\./);
  assert.match(out.summary, /line-edit/);
});

test('handles missing meta', () => {
  const out = renderPromptRunReport({ prompt: 'p', file: 'data/x.md', output: 'o' });
  assert.match(out.markdown, /# Prompt Run report/);
  assert.match(out.markdown, /## Output/);
});
