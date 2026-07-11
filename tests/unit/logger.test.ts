/**
 * Unit tests for gateway/src/util/logger.ts — a Python-`logging`-style leveled
 * logger (debug/info/warning/error) with named per-module loggers.
 * Network-free; captures console.log/console.error around each assertion.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLogger, parseLogLevel } from '../../gateway/src/util/logger.js';

const ISO_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/;

function captureConsole<T>(fn: () => T): { result: T; logLines: string[]; errorLines: string[] } {
  const realLog = console.log;
  const realError = console.error;
  const realWarn = console.warn;
  const logLines: string[] = [];
  const errorLines: string[] = [];
  console.log = (...args: unknown[]) => { logLines.push(args.join(' ')); };
  console.error = (...args: unknown[]) => { errorLines.push(args.join(' ')); };
  console.warn = (...args: unknown[]) => { errorLines.push(args.join(' ')); };
  try {
    const result = fn();
    return { result, logLines, errorLines };
  } finally {
    console.log = realLog;
    console.error = realError;
    console.warn = realWarn;
  }
}

function withEnvLevel<T>(level: string | undefined, fn: () => T): T {
  const prev = process.env.BOOKCLAW_LOG_LEVEL;
  if (level === undefined) delete process.env.BOOKCLAW_LOG_LEVEL;
  else process.env.BOOKCLAW_LOG_LEVEL = level;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.BOOKCLAW_LOG_LEVEL;
    else process.env.BOOKCLAW_LOG_LEVEL = prev;
  }
}

// ── parseLogLevel ──

test('parseLogLevel defaults to info when unset', () => {
  assert.equal(parseLogLevel(undefined), 'info');
});

test('parseLogLevel recognizes every valid level, trimmed and case-insensitive', () => {
  assert.equal(parseLogLevel('debug'), 'debug');
  assert.equal(parseLogLevel('INFO'), 'info');
  assert.equal(parseLogLevel(' Warning '), 'warning');
  assert.equal(parseLogLevel('Error'), 'error');
});

test('parseLogLevel falls back to info and warns once for an unrecognized value', () => {
  const { result, errorLines } = captureConsole(() => parseLogLevel('verbose'));
  assert.equal(result, 'info');
  assert.equal(errorLines.length, 1, 'exactly one warning printed for the invalid value');
  assert.match(errorLines[0], /verbose/);
  assert.match(errorLines[0], /debug, info, warning, error/);
});

// ── createLogger: level filtering + stdout/stderr routing ──

test('default level (unset env) allows info/warning/error but suppresses debug', () => {
  withEnvLevel(undefined, () => {
    const log = createLogger('svc');
    const { logLines, errorLines } = captureConsole(() => {
      log.debug('d');
      log.info('i');
      log.warning('w');
      log.error('e');
    });
    assert.deepEqual(logLines.filter(l => l.includes('d')).length, 0, 'debug suppressed');
    assert.equal(logLines.length, 1, 'only info reaches stdout');
    assert.equal(errorLines.length, 2, 'warning + error reach stderr');
  });
});

test('BOOKCLAW_LOG_LEVEL=debug allows all four levels', () => {
  withEnvLevel('debug', () => {
    const log = createLogger('svc');
    const { logLines, errorLines } = captureConsole(() => {
      log.debug('d');
      log.info('i');
      log.warning('w');
      log.error('e');
    });
    assert.equal(logLines.length, 2, 'debug + info reach stdout');
    assert.equal(errorLines.length, 2, 'warning + error reach stderr');
  });
});

test('BOOKCLAW_LOG_LEVEL=warning suppresses debug and info', () => {
  withEnvLevel('warning', () => {
    const log = createLogger('svc');
    const { logLines, errorLines } = captureConsole(() => {
      log.debug('d');
      log.info('i');
      log.warning('w');
      log.error('e');
    });
    assert.equal(logLines.length, 0, 'debug and info both suppressed');
    assert.equal(errorLines.length, 2, 'warning + error still reach stderr');
  });
});

test('BOOKCLAW_LOG_LEVEL=error allows only error', () => {
  withEnvLevel('error', () => {
    const log = createLogger('svc');
    const { logLines, errorLines } = captureConsole(() => {
      log.debug('d');
      log.info('i');
      log.warning('w');
      log.error('e');
    });
    assert.equal(logLines.length, 0);
    assert.equal(errorLines.length, 1, 'only error reaches stderr');
  });
});

// ── createLogger: output format ──

test('an emitted line includes an ISO timestamp, the level tag, the logger name, and the message', () => {
  withEnvLevel('debug', () => {
    const log = createLogger('ai-router');
    const { logLines } = captureConsole(() => log.info('selected provider claude'));
    assert.equal(logLines.length, 1);
    const line = logLines[0];
    assert.match(line, ISO_TS);
    assert.match(line, /\[INFO\]/);
    assert.match(line, /ai-router:/);
    assert.match(line, /selected provider claude/);
  });
});

test('the level tag reflects the call — DEBUG/WARNING/ERROR', () => {
  withEnvLevel('debug', () => {
    const log = createLogger('svc');
    const { logLines, errorLines } = captureConsole(() => {
      log.debug('d-msg');
      log.warning('w-msg');
      log.error('e-msg');
    });
    assert.match(logLines[0], /\[DEBUG\]/);
    assert.match(errorLines[0], /\[WARNING\]/);
    assert.match(errorLines[1], /\[ERROR\]/);
  });
});

// ── createLogger: context formatting ──

test('a plain-object context is appended as single-line JSON', () => {
  withEnvLevel('debug', () => {
    const log = createLogger('svc');
    const { logLines } = captureConsole(() => log.info('created project', { projectId: 'project-3', chapters: 12 }));
    assert.equal(logLines.length, 1);
    assert.match(logLines[0], /\{"projectId":"project-3","chapters":12\}/);
    assert.equal(logLines[0].includes('\n'), false, 'object context stays on one line');
  });
});

test('an Error context appends the error message and an indented stack trace', () => {
  withEnvLevel('debug', () => {
    const log = createLogger('book');
    const err = new Error('EACCES: permission denied');
    const { errorLines } = captureConsole(() => log.error('manifest write failed', err));
    assert.equal(errorLines.length, 1);
    const line = errorLines[0];
    assert.match(line, /manifest write failed/);
    assert.match(line, /Error: EACCES: permission denied/);
    assert.match(line, /\n {4}at /, 'stack lines are present and indented');
  });
});

test('a context object that cannot be JSON-serialized (circular reference) never throws', () => {
  withEnvLevel('debug', () => {
    const log = createLogger('svc');
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    const { logLines } = captureConsole(() => log.info('circular test', circular));
    assert.equal(logLines.length, 1);
    assert.match(logLines[0], /circular test/);
  });
});

// ── startup() ──

test('startup() prints the verbatim two-space marker convention, unconditionally', () => {
  withEnvLevel('error', () => { // threshold that would suppress info/debug/warning
    const log = createLogger('index');
    const { logLines } = captureConsole(() => {
      log.startup('✓', 'SKILLS.txt auto-updated (12 skills)');
      log.startup('⚠', 'Failed to update SKILLS.txt');
      log.startup('ℹ', 'Auth disabled');
    });
    assert.deepEqual(logLines, [
      '  ✓ SKILLS.txt auto-updated (12 skills)',
      '  ⚠ Failed to update SKILLS.txt',
      '  ℹ Auth disabled',
    ]);
  });
});
