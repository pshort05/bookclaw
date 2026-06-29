import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@bookclaw/shared';
import type { Status } from '@bookclaw/shared';
import { BUNDLES, type StarterBundle } from '../data/bundles';
import { createBookFromBundle } from '../lib/easyApi';
import { useModelCatalog, CATALOG_PROVIDERS } from '../lib/openrouterModels';
import { PROVIDER_DEFAULT_MODEL } from '../lib/providers';
import styles from './EasyStart.module.css';

// The 3-click "Easy Button": describe -> pick a Starter Bundle -> start writing.
// A bundle is a fully-configured preset over public library assets; on start we
// create the book and auto-run its planning pipeline on the cheap/free tier.
export function EasyStart() {
  const navigate = useNavigate();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [title, setTitle] = useState('');
  const [premise, setPremise] = useState('');
  const [selected, setSelected] = useState<StarterBundle | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // LLM choice: defaults to the global default provider ('' = Auto), changeable here.
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState(''); // specific model for the chosen provider (esp. OpenRouter)
  const [providers, setProviders] = useState<NonNullable<Status['providers']>>([]);
  // Model catalog for the chosen provider (OpenRouter/Claude/Gemini); empty otherwise.
  const modelCatalog = useModelCatalog(provider);

  useEffect(() => {
    api<Status>('/api/status').then((r) => setProviders(r.providers ?? [])).catch(() => {});
    api<{ ai?: { preferredProvider?: string } }>('/api/config')
      .then((r) => setProvider(r.ai?.preferredProvider ?? ''))
      .catch(() => {});
  }, []);

  const kWords = (b: StarterBundle) => Math.round((b.format.chapterCount * b.format.wordsPerChapter) / 1000);

  const start = async () => {
    if (!selected) return;
    // OpenRouter is a meta-provider: without a model id it falls back to the
    // configured default (often a tiny model), so require an explicit choice.
    if (provider === 'openrouter' && !model.trim()) {
      setError('Pick an OpenRouter model before starting.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { slug } = await createBookFromBundle(selected, title, provider || undefined, (provider && model.trim()) ? model.trim() : undefined);
      // Hand off to the Write page's PipelineRail (the single owner of the
      // create->start->auto-run path). It activates the book, starts planning,
      // and shows live progress. The premise rides in navigation state so it
      // seeds the planning prompt's {{description}}.
      navigate(`/write/${encodeURIComponent(slug)}?autostart=1`, {
        state: { premise: premise.trim() || title.trim() },
      });
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  return (
    <div className={styles.wrap}>
      <h1 className={styles.h1}>New Book — Easy</h1>
      <p className={styles.sub}>Three steps and your book starts planning itself. Everything is preconfigured — you can change anything later.</p>

      {step === 1 && (
        <section className={styles.step}>
          <h2 className={styles.h2}>1 · Describe your book</h2>
          <label className={styles.label}>
            Working title
            <input className={styles.input} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Untitled" />
          </label>
          <label className={styles.label}>
            In one sentence, what&apos;s it about?
            <textarea
              className={styles.textarea}
              value={premise}
              onChange={(e) => setPremise(e.target.value)}
              rows={3}
              placeholder="A small-town baker falls for the developer trying to buy her street."
            />
          </label>
          <div className={styles.actions}>
            <button className={styles.primary} disabled={!title.trim()} onClick={() => setStep(2)}>Next</button>
          </div>
        </section>
      )}

      {step === 2 && (
        <section className={styles.step}>
          <h2 className={styles.h2}>2 · Pick a Starter Bundle</h2>
          <div className={styles.grid}>
            {BUNDLES.map((b) => (
              <button key={b.id} className={styles.card} onClick={() => { setSelected(b); setStep(3); }}>
                <span className={styles.icon} aria-hidden>{b.icon}</span>
                <span className={styles.cardTitle}>{b.title}</span>
                <span className={styles.cardTag}>{b.tagline}</span>
                <span className={styles.cardMeta}>≈{kWords(b)}k-word novel</span>
              </button>
            ))}
          </div>
          <div className={styles.actions}>
            <button className={styles.ghost} onClick={() => setStep(1)}>Back</button>
          </div>
        </section>
      )}

      {step === 3 && selected && (
        <section className={styles.step}>
          <h2 className={styles.h2}>3 · Review &amp; start</h2>
          <p className={styles.review}>
            You&apos;re writing <strong>{title.trim() || 'Untitled'}</strong> — a <strong>{selected.title}</strong> novel,
            about <strong>{kWords(selected)}k words</strong> ({selected.format.chapterCount} chapters ×{' '}
            {selected.format.wordsPerChapter}), in the <strong>{selected.voice}</strong> voice.
          </p>
          <label className={styles.label}>
            Which AI writes it?
            <select className={styles.input} value={provider} onChange={(e) => { setProvider(e.target.value); setModel(''); }}>
              <option value="">Auto (use default)</option>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          {CATALOG_PROVIDERS.has(provider) && (
            <label className={styles.label}>
              Model {provider === 'openrouter' ? '(required for OpenRouter — pick a capable model)' : '(optional)'}
              <input
                className={styles.input}
                type="text"
                list="easystart-model-list"
                value={model}
                placeholder={PROVIDER_DEFAULT_MODEL[provider] ?? 'model id'}
                onChange={(e) => setModel(e.target.value)}
              />
              <datalist id="easystart-model-list">
                {modelCatalog.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </datalist>
            </label>
          )}
          {error && <p className={styles.error}>{error}</p>}
          <div className={styles.actions}>
            <button className={styles.ghost} disabled={busy} onClick={() => setStep(2)}>Back</button>
            <button className={styles.primary} disabled={busy} onClick={start}>{busy ? 'Starting…' : 'Start writing'}</button>
          </div>
        </section>
      )}
    </div>
  );
}
