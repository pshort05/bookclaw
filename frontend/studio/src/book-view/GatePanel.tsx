import { useEffect, useState } from 'react';
import { api } from '@bookclaw/shared';
import { gateExpiry, type Gate } from './types.js';
import styles from './GatePanel.module.css';
import btn from './buttons.module.css';

type GateAction = 'approve' | 'regenerate' | 'stop';

/** Flattens the findings payload into readable lines; shape-tolerant by design. */
function findingLines(findings: unknown): string[] {
  if (findings == null) return [];
  if (typeof findings === 'string') return findings.trim() ? [findings.trim()] : [];
  const scalar = (v: unknown) =>
    typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? String(v) : JSON.stringify(v);
  if (Array.isArray(findings)) return findings.map(scalar);
  if (typeof findings === 'object') {
    return Object.entries(findings as Record<string, unknown>).map(([k, v]) => `${k}: ${scalar(v)}`);
  }
  return [String(findings)];
}

/**
 * The human gate, rendered above the prose of the chapter it paused on
 * (design §6) — you read the chapter, then decide, rather than clearing a gate
 * from a toolbar you can click without reading.
 */
export function GatePanel({ gate, projectId, onResolved }: {
  gate: Gate;
  projectId?: string;
  onResolved: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Re-render the countdown on a slow tick — minutes are the resolution shown.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const expiry = gateExpiry(gate.expiresAt, now);
  const expired = expiry.state === 'expired';
  const lines = findingLines(gate.findings);
  const asBlock = lines.some((l) => l.length > 300);

  const post = async (label: string, path: string, body?: unknown) => {
    if (!projectId) { setErr("This gate isn't bound to a project — resolve it from Confirmations."); return; }
    setErr(null);
    setBusy(label);
    try {
      await api(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
      onResolved();
    } catch (e) {
      setErr(`Couldn't ${label} — ${String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const decide = (action: GateAction, label: string) =>
    post(label, `/api/projects/${encodeURIComponent(projectId ?? '')}/review/action`, { action });

  // An expired gate is recoverable: re-driving the project re-runs the active
  // step and opens a fresh gate (design § error handling).
  const reopen = () =>
    post('re-open the gate', `/api/projects/${encodeURIComponent(projectId ?? '')}/auto-execute`);

  return (
    <div className={styles.gate}>
      <div className={styles.gh}>
        <span className={styles.pip}>Human gate · act boundary</span>
        <span className={`${styles.age} ${expired ? styles.expired : ''}`}>
          {expiry.state === 'open' ? `expires in ${expiry.left}` : expiry.state === 'expired' ? 'expired' : 'expiry unknown'}
        </span>
      </div>

      <div className={styles.gb}>
        <p>
          Generation is paused after <b>{gate.stepId}</b>. Nothing past this point has been written yet.
        </p>
        {lines.length === 0 ? (
          <p>No findings were recorded for this gate — read the chapter and decide.</p>
        ) : asBlock ? (
          <pre className={styles.raw}>{lines.join('\n')}</pre>
        ) : (
          <ul>{lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
        )}
      </div>

      {err && <div className={styles.err}>{err}</div>}

      <div className={styles.gacts}>
        {expired ? (
          <button
            className={`${btn.btn} ${btn.primary}`}
            disabled={busy !== null}
            onClick={reopen}
          >
            {busy ? 'Working…' : 'Re-open the gate'}
          </button>
        ) : (
          <>
            <button
              className={`${btn.btn} ${btn.primary}`}
              disabled={busy !== null}
              onClick={() => decide('approve', 'approve')}
            >
              {busy === 'approve' ? 'Approving…' : 'Approve & continue'}
            </button>
            <button
              className={`${btn.btn} ${btn.warn}`}
              disabled={busy !== null}
              onClick={() => decide('regenerate', 'regenerate')}
            >
              {busy === 'regenerate' ? 'Regenerating…' : 'Regenerate chapter'}
            </button>
            <button
              className={`${btn.btn} ${btn.quiet}`}
              disabled={busy !== null}
              onClick={() => decide('stop', 'stop')}
            >
              Stop here
            </button>
          </>
        )}
        <span className={styles.hint}>
          {expired ? 'the 24h window closed — re-running the step opens a fresh gate' : 'edit the raw pane → Approve with my edits'}
        </span>
      </div>
    </div>
  );
}
