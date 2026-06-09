import { useEffect, useState } from 'react';
import { api, useStore, usePendingConfirmations, Button } from '@bookclaw/shared';
import type { ConfirmationRequest } from '@bookclaw/shared';
import styles from './Confirmations.module.css';

export function Confirmations() {
  const pending = usePendingConfirmations();
  const loadConfirmations = useStore((s) => s.loadConfirmations);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    loadConfirmations().catch(() => {});
  }, [loadConfirmations]);

  const decide = async (id: string, decision: 'approve' | 'reject') => {
    setErr(null);
    setBusy(id);
    try {
      const body =
        decision === 'reject'
          ? JSON.stringify({ reason: prompt('Reason (optional)?') || '' })
          : undefined;
      await api(`/api/confirmations/${encodeURIComponent(id)}/${decision}`, {
        method: 'POST',
        body,
      });
    } catch (e) {
      setErr(`Couldn't ${decision} — ${String(e)}`);
    } finally {
      await loadConfirmations().catch(() => {});
      setBusy(null);
    }
  };

  return (
    <div className={styles.scroll}>
      <h1 className={styles.h1}>Confirmations</h1>
      {err && <p className={styles.empty}>{err}</p>}
      {pending.length === 0 ? (
        <p className={styles.empty}>Nothing awaiting approval.</p>
      ) : (
        pending.map((c: ConfirmationRequest) => (
          <article
            key={c.id}
            className={[styles.card, styles[c.riskLevel]].filter(Boolean).join(' ')}
          >
            <div className={styles.chead}>
              <span className={styles.risk}>{c.riskLevel}</span>
              <span className={styles.service}>
                {c.platform} · {c.action}
              </span>
              {c.estimatedCost != null && (
                <span className={styles.cost}>${c.estimatedCost.toFixed(2)}</span>
              )}
            </div>
            <p className={styles.desc}>{c.description}</p>
            {c.disclosures?.length > 0 && (
              <ul className={styles.disc}>
                {c.disclosures?.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            )}
            <div className={styles.meta}>
              {c.isReversible ? 'reversible' : 'NOT reversible'} · expires{' '}
              {new Date(c.expiresAt).toLocaleString()}
            </div>
            <div className={styles.acts}>
              <Button
                variant="secondary"
                onClick={() => decide(c.id, 'reject')}
                disabled={busy === c.id}
              >
                Reject
              </Button>
              <Button
                variant="primary"
                onClick={() => decide(c.id, 'approve')}
                disabled={busy === c.id}
              >
                {busy === c.id ? '…' : 'Approve'}
              </Button>
            </div>
          </article>
        ))
      )}
    </div>
  );
}
