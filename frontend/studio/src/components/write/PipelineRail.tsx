/**
 * PipelineRail — right pane of the Write workspace.
 *
 * Scope note: true streaming progress is not available from the server — we poll
 * GET /api/projects/:id every ~3 s while the project is active. Project↔book
 * association is loose (Phase 8 will bind them); this rail shows the active
 * book's pipeline plan + the most-recent active project, associated loosely.
 */
import { useEffect, useRef, useState } from 'react';
import { api, type Project, type ProjectStep, type BookDetail, type LibraryPipeline } from '@bookclaw/shared';
import styles from '../../routes/Write.module.css';

const PROVIDERS = ['gemini', 'deepseek', 'claude', 'openai', 'ollama', 'openrouter'] as const;
type Provider = typeof PROVIDERS[number];

interface Props {
  slug: string;
  activeProject?: Project;
  onProjectChange: (p: Project) => void;
  // Easy Button: auto-start the pipeline once on mount (single owner of the
  // create->start->auto-run path). autoStartPremise seeds the planning prompt.
  autoStart?: boolean;
  autoStartPremise?: string;
}

export function PipelineRail({ slug, activeProject, onProjectChange, autoStart, autoStartPremise }: Props) {
  const [detail, setDetail] = useState<BookDetail | null>(null);
  const [pipeline, setPipeline] = useState<LibraryPipeline | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seqTotal, setSeqTotal] = useState<number | null>(null); // F1: total phases in a book sequence
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const busyRef = useRef(false);
  const kickedRef = useRef<string | null>(null); // guard: fire /auto-execute once per active phase

  // Load book detail (author/voice/genre/pipeline names + descriptions).
  useEffect(() => {
    let cancelled = false;
    api<BookDetail>(`/api/books/${encodeURIComponent(slug)}`)
      .then((d) => { if (!cancelled) setDetail(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [slug]);

  // Load the active book's pipeline plan (step labels, skills, etc.).
  useEffect(() => {
    let cancelled = false;
    api<{ content?: string; wired: boolean }>('/api/books/active/templates/pipeline')
      .then((r) => {
        if (cancelled) return;
        if (r.content) {
          try { setPipeline(JSON.parse(r.content)); } catch { /* ignore bad JSON */ }
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [slug]);

  // Poll the book's FRONTIER project (the live current phase) so the rail always
  // reflects real progress and advances across phases on its own. Frontier-based
  // (via /current-project) rather than a fixed project id, so it self-heals through
  // phase transitions and socket reconnects — a fixed-id poll froze on the phase it
  // started with (observed: the rail stuck on Bible step 1 while the backend was
  // already in Production). When the frontier rolls to a NEW active phase,
  // advancePipeline has only marked it active, so kick /auto-execute once (the
  // server's per-project in-flight guard makes a duplicate a harmless 409).
  useEffect(() => {
    if (!slug) return;
    let alive = true;
    const tick = () => {
      if (!alive) return;
      api<{ project: Project | null }>(`/api/books/${encodeURIComponent(slug)}/current-project`)
        .then((r) => {
          if (!alive) return;
          const p = r.project;
          if (p) {
            onProjectChange(p);
            if (p.status === 'active' && kickedRef.current !== p.id) {
              kickedRef.current = p.id;
              void api(`/api/projects/${encodeURIComponent(p.id)}/auto-execute`, { method: 'POST', body: '{}' }).catch(() => {});
            }
          }
          // Fast while work is live; slow to a heartbeat once the whole pipeline is
          // done (current-project then returns a completed final phase).
          const idle = !!p && p.status === 'completed';
          pollRef.current = setTimeout(tick, idle ? 15000 : 3000);
        })
        .catch(() => { if (alive) pollRef.current = setTimeout(tick, 5000); });
    };
    pollRef.current = setTimeout(tick, 1200);
    return () => {
      alive = false;
      if (pollRef.current) clearTimeout(pollRef.current);
    };
    // onProjectChange is stable (useCallback in Write.tsx); excluded to avoid re-fires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  // F1: a book whose pipelineSequence has >1 entry runs as chained Projects linked
  // by pipelineId. Load the phase count for the "Phase X / N" indicator, and when
  // the tracked phase completes, follow to the next phase the engine auto-started
  // (so the rail walks the whole sequence instead of dead-ending at "Completed").
  useEffect(() => {
    const pid = activeProject?.pipelineId;
    setSeqTotal(null); // reset first so a pipeline switch never shows the prior book's total
    if (!pid) return;
    let cancelled = false;
    api<{ phases: Array<{ id: string; phase: number; status: string }> }>(`/api/pipeline/${encodeURIComponent(pid)}`)
      .then((r) => { if (!cancelled) setSeqTotal(r.phases.length); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [activeProject?.pipelineId]);

  // (Phase advancement + the auto-execute kick are handled by the frontier poll
  // above — it tracks /current-project, which returns the next phase automatically
  // once the current one completes, so no separate "follow" effect is needed.)

  const action = async (url: string) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setActionBusy(true); setError(null);
    try {
      await api(url, { method: 'POST', body: '{}' });
      // Refresh the project after action — only update state when a project came back.
      if (activeProject) {
        const r = await api<{ project: Project }>(`/api/projects/${encodeURIComponent(activeProject.id)}`).catch(() => null);
        if (r?.project) onProjectChange(r.project);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      busyRef.current = false;
      setActionBusy(false);
    }
  };

  const startPipeline = async (descriptionOverride?: string): Promise<Project | undefined> => {
    if (busyRef.current) return undefined;
    busyRef.current = true;
    setActionBusy(true); setError(null);
    try {
      // Create: returns { project, planning }. Project starts in 'pending' status;
      // create does NOT auto-execute. We must call /start to move it to 'active'
      // (marks status='active' + marks first step active). /start returns { step, project }.
      // After onProjectChange with status='active', the poll effect fires automatically.
      const title = detail?.book.title ?? slug;
      const r = await api<{ project: Project; planning: string }>('/api/projects/create', {
        method: 'POST',
        body: JSON.stringify({
          title,
          description: descriptionOverride?.trim() || `Generate the book "${title}" using the active pipeline.`,
        }),
      });
      // /start returns { step, project }; on 404/error catch returns the create response
      // (which also has .project) so the project is always available either way.
      const started = await api<{ step: unknown; project: Project }>(`/api/projects/${encodeURIComponent(r.project.id)}/start`, {
        method: 'POST', body: '{}',
      }).catch(() => r as unknown as { step: unknown; project: Project });
      onProjectChange(started.project);
      return started.project;
    } catch (e) {
      setError(String(e));
      return undefined;
    } finally {
      busyRef.current = false;
      setActionBusy(false);
    }
  };

  // Easy Button: fire the create->start->auto-run path exactly once, after the
  // book detail loads (so the real title is used) and only when nothing is
  // already tracked. This is the single owner of project creation, so the wizard
  // never orphans a project or spawns a duplicate.
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (!autoStart || autoStartedRef.current || activeProject || !detail) return;
    // Guard across remounts: a chat/SSE reconnect (or navigation) re-mounts this
    // component and resets the per-mount ref. With `?autostart=1` still in the URL
    // and `activeProject` momentarily null during reload, the effect would re-fire
    // and spawn a DUPLICATE pipeline run ("restarted" symptom). A per-book session
    // guard makes autostart fire at most once per book per tab session.
    const guardKey = `bookclaw:autostarted:${slug}`;
    autoStartedRef.current = true;
    try { if (sessionStorage.getItem(guardKey)) return; sessionStorage.setItem(guardKey, '1'); } catch { /* sessionStorage unavailable — fall back to the ref guard */ }
    (async () => {
      const p = await startPipeline(autoStartPremise);
      if (p) {
        await api(`/api/projects/${encodeURIComponent(p.id)}/auto-execute`, { method: 'POST', body: '{}' }).catch(() => {});
      } else {
        // Creation failed: release the session guard so a later mount can retry.
        // (The guard is set pre-await only to close the duplicate-fire window.)
        try { sessionStorage.removeItem(guardKey); } catch { /* sessionStorage unavailable */ }
      }
    })();
    // startPipeline is stable enough; the ref + session guard ensure a single fire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, detail, activeProject, autoStartPremise, slug]);

  const setStepModel = async (stepId: string, provider: Provider | '') => {
    if (!activeProject) return;
    try {
      await api(`/api/projects/${encodeURIComponent(activeProject.id)}/steps/${encodeURIComponent(stepId)}/model`, {
        method: 'POST',
        body: JSON.stringify(provider ? { provider } : {}),
      });
      const r = await api<{ project: Project }>(`/api/projects/${encodeURIComponent(activeProject.id)}`).catch(() => null);
      if (r?.project) onProjectChange(r.project);
    } catch { /* silent */ }
  };

  const pf = detail?.book.pulledFrom;
  const descriptions = detail?.descriptions;

  const planSteps = pipeline?.steps ?? [];
  const projectSteps: ProjectStep[] = activeProject?.steps ?? [];

  // Choose which steps to render in the pipeline rail:
  // - If the template has steps (static pipelines), map them onto project-step statuses
  //   by id first, then label, then index — to survive duplicate labels.
  // - If the template is dynamic (steps: []) AND an active project has real steps,
  //   render those directly — they carry their own id/label/status/modelOverride.
  // Prefer the live project's OWN steps (they carry label + status + skill) whenever
  // a project exists, so the rail shows real per-step progress and the correct labels
  // for the CURRENT phase. The separately-fetched template is only a pre-run plan
  // preview and goes stale across phase advances, so it is used only before a project
  // exists.
  const useDynamicSteps = projectSteps.length > 0;

  // Status helper for the static (plan-based) path only.
  const planStepStatus = (planStep: typeof planSteps[number], i: number): 'done' | 'cur' | 'queued' => {
    // Match by id first (most reliable), then label, then fall back to index.
    const id = (planStep as { id?: string }).id;
    const byId = id ? projectSteps.find((s) => s.id === id) : undefined;
    const byLabel = planStep.label ? projectSteps.find((s) => s.label === planStep.label) : undefined;
    const ps = byId ?? byLabel ?? projectSteps[i];
    if (!ps) return 'queued';
    if (ps.status === 'completed') return 'done';
    if (ps.status === 'active') return 'cur';
    return 'queued';
  };

  // Matching project step for model-override display in the static path.
  const matchedProjectStep = (planStep: typeof planSteps[number], i: number): ProjectStep | undefined => {
    const id = (planStep as { id?: string }).id;
    const byId = id ? projectSteps.find((s) => s.id === id) : undefined;
    const byLabel = planStep.label ? projectSteps.find((s) => s.label === planStep.label) : undefined;
    return byId ?? byLabel ?? projectSteps[i];
  };

  const currentStep = projectSteps.find((s) => s.status === 'active');

  return (
    <div className={`${styles.wcol} ${styles.wright}`}>
      {/* Book context */}
      <div className={styles.sec} style={{ marginTop: 0 }}>Book</div>
      <div className={styles.binfo}>
        {[
          { key: 'Author', val: pf?.author?.name, italic: false, desc: descriptions?.author, title: 'author' },
          { key: 'Voice', val: pf?.voice?.name, italic: true, desc: descriptions?.voice, title: 'narrative voice' },
          { key: 'Genre', val: pf?.genre?.name ?? null, italic: true, desc: descriptions?.genre, title: 'genre' },
          { key: 'Pipeline', val: pf?.pipeline?.name, italic: false, desc: undefined, title: 'pipeline template' },
        ].map(({ key, val, italic, desc, title }) => (
          <div key={key} className={styles.bi}>
            <div className={`${styles.biL} ${styles.biLHelp}`} title={title}>{key}</div>
            <div className={`${styles.biR}${italic ? ` ${styles.biRItalic}` : ''}`}>{val ?? '—'}</div>
            {desc && <div className={styles.adesc}>{desc}</div>}
          </div>
        ))}
      </div>

      {/* Pipeline plan */}
      {pipeline && (
        <>
          <div className={styles.sec}>
            Pipeline · {pipeline.name}
            {seqTotal && seqTotal > 1 && activeProject?.pipelinePhase
              ? ` · Phase ${activeProject.pipelinePhase} / ${seqTotal}`
              : ''}
          </div>

          {/* Static pipeline: template has steps — map onto project statuses. */}
          {!useDynamicSteps && planSteps.map((ps, i) => {
            const st = planStepStatus(ps, i);
            const projStep = matchedProjectStep(ps, i);
            const stepCls = `${styles.step}${st === 'done' ? ` ${styles.stepDone}` : st === 'cur' ? ` ${styles.stepCur}` : ''}`;
            return (
              <div key={i} className={stepCls}>
                <div className={styles.stem}>
                  <div className={styles.nub} />
                  {i < planSteps.length - 1 && <div className={styles.ln} />}
                </div>
                <div className={styles.sbody}>
                  <div className={styles.sname}>{ps.label}</div>
                  <div className={styles.smeta}>
                    {projStep?.modelOverride?.provider && (
                      <span className={styles.model}>{projStep.modelOverride.provider}</span>
                    )}
                    {ps.skill && <span className={styles.skill}>{ps.skill}</span>}
                    {ps.phase && <span>{ps.phase}</span>}
                  </div>
                  {st === 'cur' && projStep && (
                    <select
                      className={styles.modelSelect}
                      value={projStep.modelOverride?.provider ?? ''}
                      onChange={(e) => setStepModel(projStep.id, e.target.value as Provider | '')}
                      title="Override AI provider for this step"
                    >
                      <option value="">default provider</option>
                      {PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  )}
                </div>
              </div>
            );
          })}

          {/* Dynamic pipeline: template steps are empty; render the real project steps directly. */}
          {useDynamicSteps && projectSteps.map((ps, i) => {
            const st: 'done' | 'cur' | 'queued' =
              ps.status === 'completed' ? 'done' : ps.status === 'active' ? 'cur' : 'queued';
            const stepCls = `${styles.step}${st === 'done' ? ` ${styles.stepDone}` : st === 'cur' ? ` ${styles.stepCur}` : ''}`;
            return (
              <div key={ps.id} className={stepCls}>
                <div className={styles.stem}>
                  <div className={styles.nub} />
                  {i < projectSteps.length - 1 && <div className={styles.ln} />}
                </div>
                <div className={styles.sbody}>
                  <div className={styles.sname}>{ps.label}</div>
                  <div className={styles.smeta}>
                    {ps.modelOverride?.provider && (
                      <span className={styles.model}>{ps.modelOverride.provider}</span>
                    )}
                    {ps.skill && <span className={styles.skill}>{ps.skill}</span>}
                    {ps.phase && <span>{ps.phase}</span>}
                  </div>
                  {st === 'cur' && (
                    <select
                      className={styles.modelSelect}
                      value={ps.modelOverride?.provider ?? ''}
                      onChange={(e) => setStepModel(ps.id, e.target.value as Provider | '')}
                      title="Override AI provider for this step"
                    >
                      <option value="">default provider</option>
                      {PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  )}
                </div>
              </div>
            );
          })}

          {/* Dynamic pipeline not yet started — no steps available. */}
          {useDynamicSteps === false && planSteps.length === 0 && (
            <p className={styles.dimmed} style={{ fontSize: 12 }}>
              Steps are generated when the pipeline runs.
            </p>
          )}
        </>
      )}

      {/* Generation controls */}
      <div className={styles.sec}>Generation</div>
      {error && <p className={styles.dimmed} style={{ fontSize: 12, marginBottom: 8 }}>{error}</p>}
      <div className={styles.genControls}>
        {!activeProject ? (
          <button
            className={`${styles.ctrlBtn} ${styles.ctrlBtnPrimary}`}
            onClick={() => startPipeline()}
            disabled={actionBusy}
          >
            {actionBusy ? 'Starting…' : 'Start pipeline'}
          </button>
        ) : activeProject.status === 'pending' || activeProject.status === 'paused' ? (
          <>
            <button
              className={`${styles.ctrlBtn} ${styles.ctrlBtnPrimary}`}
              onClick={() => action(`/api/projects/${activeProject.id}/execute`)}
              disabled={actionBusy}
              title="Execute next step"
            >
              Execute
            </button>
            <button
              className={styles.ctrlBtn}
              onClick={() => action(`/api/projects/${activeProject.id}/auto-execute`)}
              disabled={actionBusy}
              title="Auto-run all remaining steps"
            >
              Auto-run
            </button>
            {activeProject.status === 'paused' && (
              <button
                className={`${styles.ctrlBtn} ${styles.ctrlBtnPrimary}`}
                onClick={() => action(`/api/projects/${activeProject.id}/resume`)}
                disabled={actionBusy}
              >
                Resume
              </button>
            )}
            <span className={styles.dimmed} style={{ fontSize: 11, marginLeft: 'auto', alignSelf: 'center' }}>
              {activeProject.status} · {Math.round(activeProject.progress ?? 0)}%
            </span>
          </>
        ) : activeProject.status === 'active' ? (
          <>
            <button
              className={styles.ctrlBtn}
              onClick={() => action(`/api/projects/${activeProject.id}/pause`)}
              disabled={actionBusy}
            >
              Pause
            </button>
            <span className={styles.dimmed} style={{ fontSize: 11, marginLeft: 'auto', alignSelf: 'center' }}>
              active · {Math.round(activeProject.progress ?? 0)}%
            </span>
          </>
        ) : (
          /* completed or failed — no run buttons */
          <span className={styles.dimmed} style={{ fontSize: 12 }}>
            {activeProject.status === 'completed' ? 'Completed' : `Failed — check the last step`}
            {' · '}{Math.round(activeProject.progress ?? 0)}%
          </span>
        )}
      </div>
    </div>
  );
}
