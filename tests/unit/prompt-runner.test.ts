import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPrompt } from '../../gateway/src/services/prompt-runner.ts';

test('runPrompt sends the prompt system + user content and returns text', async () => {
  let captured: any = null;
  const aiRouter = {
    complete: async (req: any) => { captured = req; return { text: 'OUT', tokensUsed: 10, estimatedCost: 0.001 }; },
  };
  const prompts = { get: (n: string) => (n === 'p' ? { name: 'p', systemPrompt: 'SYS' } : null) };
  const out = await runPrompt({ prompts, aiRouter }, 'p', 'INPUT');
  assert.deepEqual(out, { text: 'OUT' });
  assert.equal(captured.system, 'SYS');
  assert.equal(captured.messages[0].content, 'INPUT');
});

test('runPrompt returns null for an unknown prompt', async () => {
  const aiRouter = { complete: async () => { throw new Error('should not be called'); } };
  const prompts = { get: (_n: string) => null };
  const out = await runPrompt({ prompts, aiRouter }, 'missing', 'x');
  assert.equal(out, null);
});
