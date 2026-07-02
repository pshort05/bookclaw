/**
 * Regression test for bug L4: the Telegram `/files <subdir>` picker stored bare
 * basenames (as returned by listFiles, relative to the subdir), so a later
 * `/read #` / `/export #` called readFile with just the basename — which never
 * probes workspace/<subdir>/<name> and returns "File not found". The picker must
 * store the workspace-relative path (subdir-prefixed) so readFile can resolve it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TelegramBridge } from '../../gateway/src/bridges/telegram.js';

test('/files <subdir> then /read # resolves the subdir-prefixed path', async () => {
  const bridge: any = new TelegramBridge('t', {});
  bridge.sendMessage = async () => {};

  const readFileCalls: string[] = [];
  bridge.setCommandHandlers({
    listFiles: async (s: string) => (s === 'exports' ? ['📄 report.md'] : []),
    readFile: async (filename: string) => {
      readFileCalls.push(filename);
      return { content: 'ok' };
    },
  });

  await bridge.handleInput(1, '/files exports', 'u');
  await bridge.handleInput(1, '/read 1', 'u');

  assert.deepEqual(readFileCalls, ['exports/report.md']);
});

test('/files (no subdir) keeps bare basenames in the picker', async () => {
  const bridge: any = new TelegramBridge('t', {});
  bridge.sendMessage = async () => {};

  const readFileCalls: string[] = [];
  bridge.setCommandHandlers({
    listFiles: async () => ['📄 premise.md'],
    readFile: async (filename: string) => {
      readFileCalls.push(filename);
      return { content: 'ok' };
    },
  });

  await bridge.handleInput(1, '/files', 'u');
  await bridge.handleInput(1, '/read 1', 'u');

  assert.deepEqual(readFileCalls, ['premise.md']);
});
