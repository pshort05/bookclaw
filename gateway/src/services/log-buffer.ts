/**
 * In-memory server-log ring buffer.
 *
 * The gateway logs its operational output (startup ✓/⚠/ℹ lines, errors,
 * warnings) to the console, which in Docker is only reachable via `docker logs`
 * on the host. This buffer mirrors that console output into a capped in-memory
 * ring so the Settings "View Logs" panel can show it in-app over `GET /api/logs`.
 *
 * Deliberately simple and fail-soft: it only mirrors output already going to the
 * console (no new secret exposure beyond `docker logs`), it never lets a capture
 * error break real logging, and it holds nothing across a restart.
 */

export type LogLevel = 'log' | 'info' | 'warn' | 'error';
export interface LogLine {
  ts: number;
  level: LogLevel;
  text: string;
}

const CAPTURE_METHODS: LogLevel[] = ['log', 'info', 'warn', 'error'];

/** Format one console argument into a single string, safely. */
function formatArg(a: unknown): string {
  if (typeof a === 'string') return a;
  if (a instanceof Error) return a.stack || a.message;
  try {
    return typeof a === 'object' && a !== null ? JSON.stringify(a) : String(a);
  } catch {
    return String(a);
  }
}

export class LogBuffer {
  private lines: LogLine[] = [];
  private readonly cap: number;
  private readonly maxLen: number;

  constructor(opts: { cap?: number; maxLen?: number } = {}) {
    this.cap = opts.cap ?? 2000;
    this.maxLen = opts.maxLen ?? 4000;
  }

  /** Append a line, clamping its length and evicting the oldest past the cap. */
  push(level: LogLevel, text: string): void {
    const clamped = text.length > this.maxLen ? text.slice(0, this.maxLen) + '…' : text;
    this.lines.push({ ts: Date.now(), level, text: clamped });
    if (this.lines.length > this.cap) {
      this.lines.splice(0, this.lines.length - this.cap);
    }
  }

  /** Most recent lines (oldest→newest). `level:'warn'` keeps warn+error only. */
  getLogs(opts: { limit?: number; level?: 'all' | 'warn' } = {}): LogLine[] {
    let out = this.lines;
    if (opts.level === 'warn') {
      out = out.filter((l) => l.level === 'warn' || l.level === 'error');
    }
    if (opts.limit && opts.limit > 0 && out.length > opts.limit) {
      out = out.slice(out.length - opts.limit);
    }
    return out.slice();
  }

  /**
   * Wrap the target console's log/info/warn/error so each call is also recorded
   * here, then forwarded unchanged. Returns a restore fn (used by tests).
   */
  installLogCapture(target: Console = console): () => void {
    const original: Partial<Record<LogLevel, (...args: any[]) => void>> = {};
    for (const method of CAPTURE_METHODS) {
      const orig = (target as any)[method].bind(target);
      original[method] = orig;
      (target as any)[method] = (...args: any[]) => {
        try {
          this.push(method, args.map(formatArg).join(' '));
        } catch {
          /* never let capture break real logging */
        }
        orig(...args);
      };
    }
    return () => {
      for (const method of CAPTURE_METHODS) {
        if (original[method]) (target as any)[method] = original[method];
      }
    };
  }
}

/** Process-wide buffer: index.ts installs capture into it; the API reads from it. */
export const logBuffer = new LogBuffer();
