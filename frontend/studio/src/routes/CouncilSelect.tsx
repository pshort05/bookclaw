import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '@bookclaw/shared';
import styles from './CouncilSelect.module.css';

// Response shape of GET /api/projects/:id/council (backend: projects.routes.ts,
// sourced from services/council.ts CouncilResult).
interface Candidate { id: string; model: string; premise: string; relationshipArc: string; text: string; }
interface Ranking { id: string; rank: number; rationale: string; }
interface CouncilData { candidates: Candidate[]; ranking: Ranking[]; recommendedId: string; rationale: string; }

export function CouncilSelect() {
  const { projectId } = useParams();
  const navigate = useNavigate();

  const [data, setData] = useState<CouncilData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notPending, setNotPending] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selected, setSelected] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    setLoading(true); setNotPending(false); setLoadError(null);
    api<CouncilData>(`/api/projects/${encodeURIComponent(projectId)}/council`)
      .then((r) => {
        if (cancelled) return;
        setData(r);
        setSelected(r.recommendedId);
      })
      .catch((e: Error & { status?: number }) => {
        if (cancelled) return;
        if (e.status === 404) setNotPending(true);
        else setLoadError(String(e));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId]);

  const confirm = async () => {
    if (!projectId || !selected) return;
    setSubmitting(true); setSubmitError(null);
    try {
      await api(`/api/projects/${encodeURIComponent(projectId)}/council/select`, {
        method: 'POST',
        body: JSON.stringify({ candidateId: selected }),
      });
      navigate('/');
    } catch (e) {
      setSubmitError(String(e));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className={styles.body}>
        <div className={styles.wrap}>
          <p className={styles.hint}>Loading candidates…</p>
        </div>
      </div>
    );
  }

  if (notPending) {
    return (
      <div className={styles.body}>
        <div className={styles.wrap}>
          <div className={styles.hero}>
            <h1>No <em>selection</em> pending</h1>
            <p>No base-story selection pending for this project.</p>
          </div>
        </div>
      </div>
    );
  }

  if (loadError || !data) {
    return (
      <div className={styles.body}>
        <div className={styles.wrap}>
          <p className={styles.err}>Couldn't load candidates — {loadError ?? 'unknown error'}</p>
        </div>
      </div>
    );
  }

  const ranked = [...data.ranking].sort((a, b) => a.rank - b.rank);
  const byId = new Map(data.candidates.map((c) => [c.id, c]));

  return (
    <div className={styles.body}>
      <div className={styles.wrap}>
        <div className={styles.hero}>
          <h1>Choose the <em>base story</em></h1>
          <p>The AI judge ranked {data.candidates.length} candidate premises. Pick the one to carry forward — every later step builds on it.</p>
        </div>

        {data.rationale && <div className={styles.rationale}>{data.rationale}</div>}

        {ranked.map((r) => {
          const c = byId.get(r.id);
          if (!c) return null;
          const isRecommended = r.id === data.recommendedId;
          const isSelected = selected === r.id;
          return (
            <label key={r.id} className={isSelected ? `${styles.card} ${styles.cardSel}` : styles.card}>
              <input
                type="radio"
                name="candidate"
                className={styles.radio}
                checked={isSelected}
                onChange={() => setSelected(r.id)}
              />
              <div className={styles.cardBody}>
                <div className={styles.cardHead}>
                  <span className={styles.rankBadge}>Rank {r.rank}</span>
                  <span className={styles.modelLabel}>{c.model}</span>
                  {isRecommended && <span className={styles.recBadge}>AI recommendation</span>}
                </div>
                <div className={styles.fl}>Premise</div>
                <p className={styles.text}>{c.premise}</p>
                <div className={styles.fl}>Relationship arc</div>
                <p className={styles.text}>{c.relationshipArc}</p>
                {r.rationale && (
                  <>
                    <div className={styles.fl}>Judge's rationale</div>
                    <p className={styles.judgeText}>{r.rationale}</p>
                  </>
                )}
              </div>
            </label>
          );
        })}

        {submitError && <p className={styles.err}>Couldn't continue — {submitError}</p>}
        <button className={styles.primary} onClick={confirm} disabled={!selected || submitting}>
          {submitting ? 'Continuing…' : 'Use this base story & continue'}
        </button>
      </div>
    </div>
  );
}
