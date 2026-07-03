import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyScene } from '../../gateway/src/services/casting/heat-classify.js';

const MODEL = { provider: 'gemini' };

test('parses a clean JSON heat score', async () => {
  const complete = async () => ({ text: '{"spice":8,"violence":2}' });
  const score = await classifyScene('two lovers kiss', complete, MODEL);
  assert.deepEqual(score, { spice: 8, violence: 2 });
});

test('garbage response fails soft to zeros', async () => {
  const complete = async () => ({ text: 'not json at all, sorry cannot help' });
  const score = await classifyScene('a quiet scene', complete, MODEL);
  assert.deepEqual(score, { spice: 0, violence: 0 });
});

test('out-of-range values are clamped to 0-10', async () => {
  const complete = async () => ({ text: '{"spice":15,"violence":-3}' });
  const score = await classifyScene('an intense scene', complete, MODEL);
  assert.deepEqual(score, { spice: 10, violence: 0 });
});

test('a thrown completion also fails soft to zeros', async () => {
  const complete = async () => { throw new Error('provider down'); };
  const score = await classifyScene('a scene', complete, MODEL);
  assert.deepEqual(score, { spice: 0, violence: 0 });
});

// C1 regression: classifyScene used to only set provider/model on the request
// when a model arg was passed at all, so a caller that forgot the 3rd arg (as
// _shared.ts's resolveIntimacyRouting did) silently produced a providerless
// request → AIRouter.complete threw "Provider undefined not found" → caught
// → {0,0} → the whole heat/intimacy feature went inert. The 3rd arg is now
// required, and the request must always carry a concrete provider + system.
test('always sets a concrete, non-empty provider on the completion request', async () => {
  let seenProvider: unknown;
  const complete = async (req: any) => { seenProvider = req.provider; return { text: '{"spice":1,"violence":0}' }; };
  await classifyScene('a scene', complete, { provider: 'gemini' });
  assert.equal(typeof seenProvider, 'string');
  assert.ok((seenProvider as string).length > 0);
});

test('always sets a non-empty system prompt on the completion request', async () => {
  let seenSystem: unknown;
  const complete = async (req: any) => { seenSystem = req.system; return { text: '{"spice":1,"violence":0}' }; };
  await classifyScene('a scene', complete, MODEL);
  assert.equal(typeof seenSystem, 'string');
  assert.ok((seenSystem as string).length > 0);
});
