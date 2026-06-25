/**
 * BookClaw Audit Log
 * Tamper-resistant logging of all agent actions
 */

import { appendFile, mkdir, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';

export class AuditLog {
  private logDir: string;
  private lastHash = '0';
  private writeChain: Promise<void> = Promise.resolve();

  constructor(logDir: string) {
    this.logDir = logDir;
  }

  async initialize(): Promise<void> {
    await mkdir(this.logDir, { recursive: true });
    // Continue the hash chain across restarts: seed lastHash from the hash field
    // of the last line of today's log, so cross-restart tampering remains
    // detectable (otherwise lastHash resets to '0' each boot and breaks the
    // chain). Fail-soft — a missing/corrupt/empty file leaves the '0' genesis.
    try {
      const logFile = join(this.logDir, `${new Date().toISOString().split('T')[0]}.jsonl`);
      if (existsSync(logFile)) {
        const lines = (await readFile(logFile, 'utf-8')).trimEnd().split('\n');
        const last = lines[lines.length - 1];
        if (last) {
          const hash = JSON.parse(last)?.hash;
          if (typeof hash === 'string' && hash) this.lastHash = hash;
        }
      }
    } catch { /* fail-soft: keep the '0' genesis hash */ }
  }

  async log(category: string, action: string, data: Record<string, any>): Promise<void> {
    // Serialize hash-chain mutation + append so concurrent (often unawaited)
    // log() calls cannot interleave previousHash links or reorder JSONL lines.
    const result = this.writeChain.then(async () => {
      const entry = {
        timestamp: new Date().toISOString(),
        category,
        action,
        data,
        previousHash: this.lastHash,
      };

      // Chain hashes for tamper detection
      const entryStr = JSON.stringify(entry);
      const newHash = createHash('sha256').update(entryStr).digest('hex').substring(0, 16);

      const logLine = JSON.stringify({ ...entry, hash: newHash }) + '\n';
      const logFile = join(this.logDir, `${new Date().toISOString().split('T')[0]}.jsonl`);

      await appendFile(logFile, logLine);
      // Advance lastHash only AFTER the append resolves, so a failed write leaves
      // lastHash linking to the last PERSISTED entry (no gap in the chain).
      this.lastHash = newHash;
    });

    // Keep the queue alive even if one append fails, so a single error doesn't
    // poison all subsequent log() calls; awaited callers still see the rejection.
    this.writeChain = result.catch(() => {});
    return result;
  }
}
