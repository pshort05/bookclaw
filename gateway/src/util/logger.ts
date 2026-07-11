/**
 * Python-`logging`-style leveled logger. Named per-module loggers
 * (`createLogger('ai-router')`, mirroring `logging.getLogger(__name__)`),
 * 4 levels (debug/info/warning/error — method names match Python's
 * `logging.Logger` exactly), threshold via `BOOKCLAW_LOG_LEVEL` (default
 * `info`). debug/info print to stdout, warning/error to stderr. No caching —
 * the threshold is read fresh on every call so it can change at runtime and
 * so tests can mutate `process.env` freely.
 */

export type LogLevel = 'debug' | 'info' | 'warning' | 'error';
export type LogContext = Record<string, unknown> | Error;
export type StartupMarker = '✓' | '⚠' | 'ℹ';

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warning(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  /** Verbatim `  ✓/⚠/ℹ message` init convention — always prints, unaffected
   *  by BOOKCLAW_LOG_LEVEL, for the not-yet-migrated startup call sites. */
  startup(marker: StartupMarker, message: string): void;
}

const VALID_LEVELS: LogLevel[] = ['debug', 'info', 'warning', 'error'];
const LEVEL_RANK: Record<LogLevel, number> = { debug: 0, info: 1, warning: 2, error: 3 };

let warnedInvalidLevel = false;

/** Parse + validate BOOKCLAW_LOG_LEVEL. Unset -> 'info'. Unrecognized -> 'info', warned once per process. */
export function parseLogLevel(raw: string | undefined): LogLevel {
  if (raw === undefined) return 'info';
  const normalized = raw.trim().toLowerCase();
  if ((VALID_LEVELS as string[]).includes(normalized)) return normalized as LogLevel;
  if (!warnedInvalidLevel) {
    warnedInvalidLevel = true;
    console.warn(`[logger] Unknown BOOKCLAW_LOG_LEVEL "${raw}" — defaulting to "info". Valid values: debug, info, warning, error.`);
  }
  return 'info';
}

/** Error -> " — Name: message" plus an indented stack (first stack line, which
 *  duplicates the name/message, is dropped). Plain object -> single-line JSON,
 *  falling back to a fixed string on anything JSON.stringify can't handle
 *  (circular references, BigInt) so a bad context object never throws. */
function formatContext(context: LogContext | undefined): string {
  if (context === undefined) return '';
  if (context instanceof Error) {
    const header = ` — ${context.name}: ${context.message}`;
    const stackLines = (context.stack ?? '').split('\n').slice(1);
    const stackBlock = stackLines.length ? '\n' + stackLines.map((l) => '    ' + l.trim()).join('\n') : '';
    return header + stackBlock;
  }
  try {
    return ' ' + JSON.stringify(context);
  } catch {
    return ' [unserializable context]';
  }
}

function emit(name: string, level: LogLevel, message: string, context?: LogContext): void {
  const threshold = parseLogLevel(process.env.BOOKCLAW_LOG_LEVEL);
  if (LEVEL_RANK[level] < LEVEL_RANK[threshold]) return;
  const line = `${new Date().toISOString()} [${level.toUpperCase()}] ${name}: ${message}${formatContext(context)}`;
  if (level === 'debug' || level === 'info') console.log(line);
  else console.error(line);
}

export function createLogger(name: string): Logger {
  return {
    debug: (message, context) => emit(name, 'debug', message, context),
    info: (message, context) => emit(name, 'info', message, context),
    warning: (message, context) => emit(name, 'warning', message, context),
    error: (message, context) => emit(name, 'error', message, context),
    startup: (marker, message) => console.log(`  ${marker} ${message}`),
  };
}
