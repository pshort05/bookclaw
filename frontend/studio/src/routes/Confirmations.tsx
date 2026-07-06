import { useEffect, useMemo, useState } from 'react';
import { api, useStore, usePendingConfirmations, renderMarkdown, Button, money } from '@bookclaw/shared';
import type { ConfirmationRequest, Project } from '@bookclaw/shared';
import { useDialog } from '../components/Dialog.js';
import styles from './Confirmations.module.css';

/** Human-review gate payload (mirrors gateway human-review.ts openReviewGate). */
type ReviewMeta = { projectId?: string; kind?: string; stepLabel?: string; findings?: Record<string, unknown> };

/** A human-review gate whose paused chapter draft is editable (cadence-gate). */
function editableChapter(c: ConfirmationRequest): { projectId: string; meta: ReviewMeta } | null {
  if (c.service !== 'human-review') return null;
  const meta = (c.payload ?? {}) as ReviewMeta;
  if (meta.kind !== 'cadence-gate' || typeof meta.projectId !== 'string') return null;
  return { projectId: meta.projectId, meta };
}

export function Confirmations() {
  const pending = usePendingConfirmations();
  const loadConfirmations = useStore((s) => s.loadConfirmations);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const { prompt } = useDialog();

  useEffect(() => {
    loadConfirmations().catch(() => {});
  }, [loadConfirmations]);

  // Keep a valid selection as the queue changes: default to the first item, and
  // if the selected one was resolved away, fall back to the first.
  useEffect(() => {
    if (pending.length === 0) {
      if (selectedId !== null) setSelectedId(null);
      return;
    }
    if (!selectedId || !pending.some((c) => c.id === selectedId)) {
      setSelectedId(pending[0].id);
    }
  }, [pending, selectedId]);

  const selected = useMemo(
    () => pending.find((c) => c.id === selectedId) ?? null,
    [pending, selectedId],
  );

  const decide = async (id: string, decision: 'approve' | 'reject') => {
    let body: string | undefined;
    if (decision === 'reject') {
      const reason = await prompt('Reason (optional)?');
      // Cancel (null) aborts the reject; an empty string is a valid "no reason".
      if (reason === null) return;
      body = JSON.stringify({ reason });
    }
    setErr(null);
    setBusy(id);
    try {
      await api(`/api/confirmations/${encodeURIComponent(id)}/${decision}`, { method: 'POST', body });
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
      {err && <p className={styles.error}>{err}</p>}
      {pending.length === 0 ? (
        <p className={styles.empty}>Nothing awaiting approval.</p>
      ) : (
        <div className={styles.layout}>
          <div className={styles.list}>
            {pending.map((c: ConfirmationRequest) => (
              <div
                key={c.id}
                role="button"
                tabIndex={0}
                aria-pressed={c.id === selectedId}
                onClick={() => setSelectedId(c.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedId(c.id); }
                }}
                className={[styles.card, styles[c.riskLevel], c.id === selectedId ? styles.selected : '']
                  .filter(Boolean)
                  .join(' ')}
              >
                <div className={styles.chead}>
                  <span className={styles.risk}>{c.riskLevel}</span>
                  <span className={styles.service}>{c.platform} · {c.action}</span>
                  {c.estimatedCost != null && <span className={styles.cost}>{money(c.estimatedCost)}</span>}
                </div>
                <p className={styles.desc}>{c.description}</p>
              </div>
            ))}
          </div>
          <div className={styles.detail}>
            {selected ? (
              <DetailPane key={selected.id} c={selected} busy={busy} onDecide={decide} />
            ) : (
              <p className={styles.empty}>Select a confirmation to review it.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** The right-hand pane: renders the item awaiting approval. For a cadence-gate
 *  chapter it fetches and renders the drafted prose with an inline Edit → Save
 *  (Save persists the edit but keeps the review paused — the pipeline resumes
 *  only when you Approve). Other items show a read-only payload preview.
 *  Re-mounted per selection (keyed by id), so its fetch/edit state is fresh. */
function DetailPane({
  c,
  busy,
  onDecide,
}: {
  c: ConfirmationRequest;
  busy: string | null;
  onDecide: (id: string, decision: 'approve' | 'reject') => void;
}) {
  const chapter = editableChapter(c);
  const meta = (c.payload ?? {}) as ReviewMeta;
  const findings = meta.findings && typeof meta.findings === 'object' ? meta.findings : null;

  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  useEffect(() => {
    if (!chapter) return;
    setLoading(true);
    setLoadErr(null);
    api<{ project: Project }>(`/api/projects/${encodeURIComponent(chapter.projectId)}`)
      .then((r) => setContent(r.project?.review?.pendingResult ?? ''))
      .catch((e) => setLoadErr(`Couldn't load the chapter — ${String(e)}`))
      .finally(() => setLoading(false));
  }, [chapter?.projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  const startEdit = () => { setDraft(content); setSaveErr(null); setEditing(true); };

  const save = async () => {
    if (!chapter) return;
    setSaving(true);
    setSaveErr(null);
    try {
      const r = await api<{ project: Project }>(
        `/api/projects/${encodeURIComponent(chapter.projectId)}/review/save-draft`,
        { method: 'POST', body: JSON.stringify({ editedText: draft }) },
      );
      setContent(r.project?.review?.pendingResult ?? draft);
      setEditing(false);
    } catch (e) {
      setSaveErr(`Couldn't save — ${String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <article className={[styles.dcard, styles[c.riskLevel]].filter(Boolean).join(' ')}>
      <div className={styles.chead}>
        <span className={styles.risk}>{c.riskLevel}</span>
        <span className={styles.service}>{c.platform} · {c.action}</span>
        {c.estimatedCost != null && <span className={styles.cost}>{money(c.estimatedCost)}</span>}
      </div>
      <p className={styles.desc}>{c.description}</p>
      {c.disclosures?.length > 0 && (
        <ul className={styles.disc}>
          {c.disclosures.map((d, i) => <li key={i}>{d}</li>)}
        </ul>
      )}
      <div className={styles.meta}>
        {c.isReversible ? 'reversible' : 'NOT reversible'} · expires {new Date(c.expiresAt).toLocaleString()}
      </div>

      {findings && (
        <div className={styles.findings}>
          <div className={styles.findingsHead}>Pre-review notes</div>
          <ul>
            {Object.entries(findings).map(([k, v]) => (
              <li key={k}><b>{k}</b>: {typeof v === 'string' ? v : JSON.stringify(v)}</li>
            ))}
          </ul>
        </div>
      )}

      <div className={styles.itemHead}>
        {chapter ? (meta.stepLabel ?? 'Drafted chapter') : 'Item to approve'}
        {chapter && !editing && !loading && !loadErr && (
          <Button variant="secondary" onClick={startEdit}>Edit</Button>
        )}
      </div>

      {chapter ? (
        loading ? (
          <p className={styles.empty}>Loading chapter…</p>
        ) : loadErr ? (
          <p className={styles.error}>{loadErr}</p>
        ) : editing ? (
          <div className={styles.editor}>
            <textarea
              className={styles.textarea}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              spellCheck
            />
            {saveErr && <p className={styles.error}>{saveErr}</p>}
            <div className={styles.editActs}>
              <Button variant="secondary" onClick={() => setEditing(false)} disabled={saving}>Cancel</Button>
              <Button variant="primary" onClick={save} disabled={saving}>
                {saving ? 'Saving…' : 'Save (keep paused)'}
              </Button>
            </div>
          </div>
        ) : content ? (
          <div className={styles.prose} dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }} />
        ) : (
          <p className={styles.empty}>No drafted content is attached to this review.</p>
        )
      ) : c.payload && Object.keys(c.payload).length > 0 ? (
        <pre className={styles.payload}>{JSON.stringify(c.payload, null, 2)}</pre>
      ) : (
        <p className={styles.empty}>No further detail to preview.</p>
      )}

      <div className={styles.acts}>
        <Button variant="secondary" onClick={() => onDecide(c.id, 'reject')} disabled={busy === c.id}>Reject</Button>
        <Button variant="primary" onClick={() => onDecide(c.id, 'approve')} disabled={busy === c.id}>
          {busy === c.id ? '…' : 'Approve'}
        </Button>
      </div>
    </article>
  );
}
