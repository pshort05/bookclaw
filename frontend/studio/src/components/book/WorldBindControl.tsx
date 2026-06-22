import { useEffect, useState } from 'react';
import { api } from '@bookclaw/shared';
import { listWorlds, bindWorld, unbindWorld, type WorldListRow } from '../../lib/worldApi.js';

interface SeriesRef { name: string; source: string }
interface SeriesItem {
  id: string;
  pulledFrom: { world?: SeriesRef | null };
}

export function WorldBindControl({ slug, boundWorld, seriesId, onChanged }: {
  slug: string; boundWorld?: string | null; seriesId?: string; onChanged: () => void;
}) {
  const [worlds, setWorlds] = useState<WorldListRow[]>([]);
  const [seriesWorld, setSeriesWorld] = useState<string | null>(null);
  const [sel, setSel] = useState<string>(boundWorld ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { listWorlds().then(setWorlds).catch(() => {}); }, []);

  // Fetch the series' default world when a seriesId is provided and the book is unbound.
  useEffect(() => {
    if (!seriesId || boundWorld) { setSeriesWorld(null); return; }
    api<{ series: SeriesItem[] }>('/api/series')
      .then((r) => {
        const found = r.series?.find((s) => s.id === seriesId);
        setSeriesWorld(found?.pulledFrom?.world?.name ?? null);
      })
      .catch(() => { setSeriesWorld(null); });
  }, [seriesId, boundWorld]);

  // Re-sync sel when the resolved default changes (after bind/unbind, or series world loads).
  useEffect(() => {
    setSel(boundWorld ?? seriesWorld ?? '');
  }, [boundWorld, seriesWorld]);

  async function doBind() {
    if (!sel || busy) return; setBusy(true); setError(null);
    try { await bindWorld(slug, sel); onChanged(); }
    catch (e) { setError(String(e)); } finally { setBusy(false); }
  }
  async function doUnbind() {
    if (busy) return; setBusy(true); setError(null);
    try { await unbindWorld(slug); onChanged(); }
    catch (e) { setError(String(e)); } finally { setBusy(false); }
  }
  return (
    <div>
      <div>World: <b>{boundWorld || 'Not bound'}</b></div>
      <select value={sel} onChange={(e) => setSel(e.target.value)} disabled={busy}>
        <option value="">(choose a world)</option>
        {worlds.map((w) => <option key={w.name} value={w.name}>{w.label || w.name}</option>)}
      </select>
      <button onClick={doBind} disabled={busy || !sel}>{boundWorld ? 'Change + rebuild bible' : 'Bind + build bible'}</button>
      {boundWorld && <button onClick={doUnbind} disabled={busy}>Unbind</button>}
      {error && <div role="alert">{error}</div>}
    </div>
  );
}
