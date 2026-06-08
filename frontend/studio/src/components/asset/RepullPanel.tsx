import { useEffect, useState } from 'react';
import type { RepullAsset, RepullStatus } from '@bookclaw/shared';
import { repullStatus, repullExecute } from '../../lib/assetApi.js';
import styles from '../../routes/AssetStudio.module.css';

interface Props {
  onRefreshEditor: () => void;
}

const ACTIONABLE: RepullStatus[] = ['library-updated', 'diverged', 'no-baseline', 'locally-edited'];

/** Returns true when the backend requires a resolution choice. */
function needsResolution(asset: RepullAsset): boolean {
  return asset.kind === 'pipeline' || !asset.hasBaseline;
}

function statusLabel(s: RepullStatus): string {
  switch (s) {
    case 'library-updated': return 'library advanced';
    case 'diverged': return 'diverged';
    case 'no-baseline': return 'no baseline';
    case 'locally-edited': return 'locally edited';
    default: return s;
  }
}

interface AssetRowProps {
  asset: RepullAsset;
  onDone: () => void;
  onRefreshEditor: () => void;
}

function AssetRow({ asset, onDone, onRefreshEditor }: AssetRowProps) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const requiresChoice = needsResolution(asset);

  async function execute(resolution?: 'take-library' | 'keep-book') {
    setBusy(true); setMsg(null);
    try {
      const r = await repullExecute(asset.kind, asset.name, resolution);
      if (r.hadConflicts) {
        setMsg('Merged with conflict markers — review the asset before continuing.');
      } else {
        onRefreshEditor();
        onDone();
      }
    } catch (e) {
      setMsg(`Error: ${e}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ borderTop: '1px solid var(--line)', padding: '10px 0', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
      <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 11, color: 'var(--text)' }}>{asset.kind}/{asset.name}</span>
      <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 10, color: 'var(--gold)', border: '1px solid rgba(232,196,106,.3)', borderRadius: 20, padding: '2px 7px' }}>
        {statusLabel(asset.status)}
      </span>
      {msg ? (
        <span style={{ fontSize: 12, color: msg.startsWith('Error') ? 'var(--alert)' : msg.startsWith('Merged') ? 'var(--gold)' : 'var(--launch)', marginLeft: 'auto' }}>
          {msg}
        </span>
      ) : requiresChoice ? (
        <span style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
          <button
            disabled={busy}
            onClick={() => execute('take-library')}
            style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid var(--line-2)', background: 'var(--panel-2)', color: 'var(--text)', fontSize: 12, cursor: 'pointer' }}
          >Take library</button>
          <button
            disabled={busy}
            onClick={() => execute('keep-book')}
            style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid var(--line-2)', background: 'var(--panel-2)', color: 'var(--text)', fontSize: 12, cursor: 'pointer' }}
          >Keep book</button>
        </span>
      ) : (
        <button
          disabled={busy}
          onClick={() => execute()}
          style={{ marginLeft: 'auto', padding: '6px 12px', borderRadius: 8, border: '1px solid rgba(240,145,58,.4)', background: 'rgba(240,145,58,.1)', color: 'var(--ember)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
        >
          {busy ? 'Pulling…' : 'Re-pull'}
        </button>
      )}
    </div>
  );
}

export function RepullPanel({ onRefreshEditor }: Props) {
  const [assets, setAssets] = useState<RepullAsset[]>([]);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    repullStatus()
      .then((r) => setAssets(r.assets ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  const actionable = assets.filter((a) => ACTIONABLE.includes(a.status));
  if (loading || actionable.length === 0) return null;

  return (
    <div className={styles.repull}>
      <div className={styles.ic}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12a9 9 0 11-3-6.7M21 4v5h-5"/>
        </svg>
      </div>
      <div className={styles.tx} style={{ flex: 1 }}>
        <b>{actionable.length} asset{actionable.length > 1 ? 's' : ''}</b> have diverged from the library — re-pull to sync.
        <div>
          {actionable.map((a) => (
            <AssetRow key={`${a.kind}/${a.name}`} asset={a} onDone={load} onRefreshEditor={onRefreshEditor} />
          ))}
        </div>
      </div>
    </div>
  );
}
