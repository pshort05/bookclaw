import { useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, Button } from '@bookclaw/shared';
import type { Status } from '@bookclaw/shared';
import { DeleteBooksModal } from '../components/DeleteBooksModal.js';
import { ResetSpendModal } from '../components/ResetSpendModal.js';
import { useDialog } from '../components/Dialog.js';
import { useModelCatalog } from '../lib/openrouterModels.js';
import styles from './Settings.module.css';

type Provider = NonNullable<Status['providers']>[number];

type BackupSnapshot = { name: string; at: string; reason: string; scope: string; books: string[] };

type BackupStatus = {
  enabled: boolean;
  lastRun: { at: string; ok: boolean; reason: string; error?: string } | null;
  count: number;
  snapshots: BackupSnapshot[];
};

type BackupConfig = {
  enabled: boolean;
  scope: 'standard' | 'full';
  local: { keep: number };
  cloud: { enabled: boolean; destinations: string[]; hook: string | null };
  intervalHours: number;
  onCompletion: boolean;
  localPath: string;
};

const KEY_OPTIONS = [
  'gemini_api_key',
  'deepseek_api_key',
  'anthropic_api_key',
  'openai_api_key',
  'openrouter_api_key',
];

export function Settings() {
  const [keys, setKeys] = useState<string[]>([]);
  const [providers, setProviders] = useState<NonNullable<Status['providers']>>([]);
  const [keyName, setKeyName] = useState(KEY_OPTIONS[0]);
  const [keyVal, setKeyVal] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [costs, setCosts] = useState<{ dailyLimit?: number; monthlyLimit?: number }>({});
  const [showDelete, setShowDelete] = useState(false);
  const [showReset, setShowReset] = useState(false);
  const { confirm } = useDialog();

  const loadKeys = () =>
    api<{ keys: string[] }>('/api/vault/keys')
      .then((r) => setKeys(r.keys ?? []))
      .catch(() => {});

  const loadStatus = () =>
    api<Status>('/api/status')
      .then((r) => setProviders(r.providers ?? []))
      .catch(() => {});

  const loadConfig = () =>
    api<{ costs?: { dailyLimit?: number; monthlyLimit?: number } }>('/api/config')
      .then((r) => setCosts(r.costs ?? {}))
      .catch(() => {});

  useEffect(() => {
    loadKeys();
    loadStatus();
    loadConfig();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const saveKey = async () => {
    if (!keyVal.trim()) return;
    setMsg(null);
    try {
      await api('/api/vault', {
        method: 'POST',
        body: JSON.stringify({ key: keyName, value: keyVal }),
      });
      setKeyVal(''); // NEVER echo — clear immediately
      setMsg('Key saved and encrypted.');
      await loadKeys();
      await loadStatus();
    } catch (e) {
      setMsg(`Couldn't save — ${String(e)}`);
    }
  };

  const delKey = async (k: string) => {
    if (!(await confirm(`Delete ${k} from the vault?`))) return;
    await api(`/api/vault/${encodeURIComponent(k)}`, { method: 'DELETE' }).catch(() => {});
    await loadKeys();
  };

  const saveLimit = async (path: string, value: number) => {
    await api('/api/config/update', {
      method: 'POST',
      body: JSON.stringify({ path, value }),
    }).catch(() => {});
    await loadConfig();
  };

  return (
    <div className={styles.scroll}>
      <h1 className={styles.h1}>Settings</h1>

      <div className={styles.sec}>Providers</div>
      <div className={styles.providers}>
        {(providers ?? []).map((p) =>
          p.id === 'claude' || p.id === 'gemini' ? (
            <ProviderModelField key={p.id} provider={p} onSaved={loadStatus} />
          ) : (
            <span key={p.id} className={styles.provider}>
              {p.name} <small>{p.model}</small>
            </span>
          ),
        )}
        {(!providers || providers.length === 0) && (
          <p className={styles.dim}>No active providers — add an API key below.</p>
        )}
      </div>

      <div className={styles.sec}>
        API keys <small>· stored encrypted in the vault; never shown</small>
      </div>
      <div className={styles.keys}>
        {keys.map((k) => (
          <div key={k} className={styles.keyRow}>
            <code>{k}</code>
            <button className={styles.del} onClick={() => delKey(k)}>
              Delete
            </button>
          </div>
        ))}
        {keys.length === 0 && <p className={styles.dim}>No keys stored yet.</p>}
      </div>
      <div className={styles.keyForm}>
        <select value={keyName} onChange={(e) => setKeyName(e.target.value)}>
          {KEY_OPTIONS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <input
          type="password"
          autoComplete="off"
          placeholder="paste key…"
          value={keyVal}
          onChange={(e) => setKeyVal(e.target.value)}
        />
        <Button variant="primary" onClick={saveKey} disabled={!keyVal.trim()}>
          Save key
        </Button>
      </div>
      {msg && <p className={styles.msg}>{msg}</p>}

      <div className={styles.sec}>Spend limits</div>
      <div className={styles.limits}>
        <LimitField
          label="Daily ($)"
          value={costs.dailyLimit}
          onSave={(v) => saveLimit('costs.dailyLimit', v)}
        />
        <LimitField
          label="Monthly ($)"
          value={costs.monthlyLimit}
          onSave={(v) => saveLimit('costs.monthlyLimit', v)}
        />
      </div>

      <BackupsCard />

      <div className={styles.sec}>Danger zone</div>
      <div className={styles.danger}>
        <div>
          <strong>Delete books from disk</strong>
          <p className={styles.dim}>
            Permanently remove book folders from <code>workspace/books/</code> — for cleanup or after a finished book is pulled elsewhere.
          </p>
        </div>
        <Button variant="secondary" onClick={() => setShowDelete(true)}>Delete books…</Button>
      </div>

      <div className={styles.danger}>
        <div>
          <strong>Reset total spend</strong>
          <p className={styles.dim}>
            Reset the lifetime spend total and, optionally, individual book totals. Requires typing a confirmation phrase.
          </p>
        </div>
        <Button variant="secondary" onClick={() => setShowReset(true)}>Reset total spend…</Button>
      </div>

      {showDelete && <DeleteBooksModal onClose={() => setShowDelete(false)} />}
      {showReset && <ResetSpendModal onClose={() => setShowReset(false)} />}
    </div>
  );
}

function BackupsCard() {
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [cfg, setCfg] = useState<BackupConfig | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [backingUp, setBackingUp] = useState(false);
  const [restoreFor, setRestoreFor] = useState<BackupSnapshot | null>(null);
  const [restoreTarget, setRestoreTarget] = useState(''); // '' = whole workspace
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [restored, setRestored] = useState<{ preSnapshot: string; restartRecommended: boolean } | null>(null);
  const [destInput, setDestInput] = useState('');
  const [hookInput, setHookInput] = useState('');
  const [pendingId, setPendingId] = useState<string | null>(null);

  const loadStatus = () =>
    api<BackupStatus>('/api/backups')
      .then(setStatus)
      .catch(() => {});

  const applyCfg = (c: BackupConfig) => {
    setCfg(c);
    setHookInput(c.cloud.hook ?? '');
  };

  const loadCfg = () =>
    api<BackupConfig>('/api/backups/config')
      .then(applyCfg)
      .catch(() => {});

  useEffect(() => {
    loadStatus();
    loadCfg();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const saveCfg = async (patch: Record<string, unknown>) => {
    setMsg(null);
    try {
      const r = await api<{ config?: BackupConfig; pendingConfirmation?: string }>('/api/backups/config', {
        method: 'PUT',
        body: JSON.stringify(patch),
      });
      if (r.pendingConfirmation) {
        setPendingId(r.pendingConfirmation);
      } else if (r.config) {
        applyCfg(r.config);
      }
    } catch (e) {
      setMsg(`Couldn't save — ${String(e)}`);
      await loadCfg();
    }
  };

  const backupNow = async () => {
    setBackingUp(true);
    setMsg(null);
    try {
      await api('/api/backups', { method: 'POST' });
      await loadStatus();
    } catch (e) {
      setMsg(`Backup failed — ${String(e)}`);
    } finally {
      setBackingUp(false);
    }
  };

  const doRestore = async () => {
    if (!restoreFor) return;
    setRestoreBusy(true);
    setMsg(null);
    setRestored(null);
    try {
      const r = await api<{ preSnapshot: string; restartRecommended: boolean }>(
        `/api/backups/${encodeURIComponent(restoreFor.name)}/restore`,
        { method: 'POST', body: JSON.stringify(restoreTarget ? { book: restoreTarget } : {}) },
      );
      setRestored({ preSnapshot: r.preSnapshot, restartRecommended: r.restartRecommended });
      setRestoreFor(null);
      await loadStatus();
    } catch (e) {
      setMsg(`Restore failed — ${String(e)}`);
    } finally {
      setRestoreBusy(false);
    }
  };

  const finalize = async () => {
    if (!pendingId) return;
    setMsg(null);
    try {
      const r = await api<{ config: BackupConfig }>(
        `/api/backups/config/confirm/${encodeURIComponent(pendingId)}`,
        { method: 'POST' },
      );
      applyCfg(r.config);
      setPendingId(null);
      setMsg('Cloud backup change applied.');
    } catch (e) {
      setMsg(
        (e as { status?: number })?.status === 409
          ? 'Not approved yet — approve it on the Confirmations page first.'
          : `Couldn't finalize — ${String(e)}`,
      );
    }
  };

  // Send the FULL cloud object on every cloud change so a server shallow-merge
  // can't clobber the untouched cloud fields (enabled / hook / destinations).
  const saveCloud = (patch: Partial<BackupConfig['cloud']>) => {
    if (!cfg) return;
    saveCfg({ cloud: { ...cfg.cloud, ...patch } });
  };

  const addDest = () => {
    const d = destInput.trim();
    if (!d || !cfg) return;
    setDestInput('');
    saveCloud({ destinations: [...cfg.cloud.destinations, d] });
  };

  const removeDest = (d: string) => {
    if (!cfg) return;
    saveCloud({ destinations: cfg.cloud.destinations.filter((x) => x !== d) });
  };

  return (
    <>
      <div className={styles.sec}>Backups</div>
      {cfg && !cfg.enabled && (
        <div className={styles.warnBanner}>Backups are disabled — no point-in-time recovery.</div>
      )}
      <p className={styles.bkStatus}>
        {status
          ? status.lastRun
            ? `Last backup ${new Date(status.lastRun.at).toLocaleString()} — ${
                status.lastRun.ok ? 'ok' : `failed: ${status.lastRun.error ?? 'error'}`
              } · ${status.count} snapshot${status.count === 1 ? '' : 's'}`
            : `No backups yet · ${status.count} snapshot${status.count === 1 ? '' : 's'}`
          : 'Backup status unavailable.'}
      </p>
      {cfg && (
        <div className={styles.bkControls}>
          <label className={styles.bkCheck}>
            <input
              type="checkbox"
              checked={cfg.enabled}
              onChange={(e) => saveCfg({ enabled: e.target.checked })}
            />
            Enabled
          </label>
          <LimitField
            label="Keep"
            value={cfg.local.keep}
            onSave={(v) => saveCfg({ local: { keep: v } })}
          />
          <LimitField
            label="Interval (h)"
            value={cfg.intervalHours}
            onSave={(v) => saveCfg({ intervalHours: v })}
          />
          <div className={styles.limit}>
            <label>Scope</label>
            <select value={cfg.scope} onChange={(e) => saveCfg({ scope: e.target.value })}>
              <option value="standard">standard</option>
              <option value="full">full</option>
            </select>
          </div>
          <Button variant="primary" onClick={backupNow} disabled={backingUp}>
            {backingUp ? 'Backing up…' : 'Back up now'}
          </Button>
        </div>
      )}
      {restored && (
        <p className={styles.msg}>
          Restored — pre-restore snapshot <code>{restored.preSnapshot}</code> was taken first.
          {restored.restartRecommended && <strong> Restart recommended for a clean reload.</strong>}
        </p>
      )}
      {status && status.snapshots.length === 0 && <p className={styles.dim}>No snapshots yet.</p>}
      {status && status.snapshots.length > 0 && (
        <div className={styles.keys}>
          {status.snapshots.map((s) => (
            <div key={s.name}>
              <div className={styles.keyRow}>
                <span>
                  <code>{s.name}</code>
                  <span className={styles.snapMeta}>
                    {s.reason} · {s.books.length} book{s.books.length === 1 ? '' : 's'}
                  </span>
                </span>
                <button
                  className={styles.del}
                  onClick={() => {
                    setRestoreFor(restoreFor?.name === s.name ? null : s);
                    setRestoreTarget('');
                  }}
                >
                  Restore…
                </button>
              </div>
              {restoreFor?.name === s.name && (
                <div className={styles.restoreBox}>
                  <select value={restoreTarget} onChange={(e) => setRestoreTarget(e.target.value)}>
                    <option value="">Whole workspace</option>
                    {restoreFor.books.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                  <Button variant="primary" onClick={doRestore} disabled={restoreBusy}>
                    {restoreBusy ? 'Restoring…' : 'Restore'}
                  </Button>
                  <Button variant="secondary" onClick={() => setRestoreFor(null)} disabled={restoreBusy}>
                    Cancel
                  </Button>
                  <p className={styles.dim}>
                    A pre-restore snapshot is taken automatically.
                    {restoreTarget === '' && ' Whole-workspace restore recommends a restart.'}
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className={styles.sec}>
        Cloud backup <small>· zips pushed offsite after each snapshot; new destinations need approval</small>
      </div>
      {cfg && (
        <>
          <div className={styles.bkControls}>
            <label className={styles.bkCheck}>
              <input
                type="checkbox"
                checked={cfg.cloud.enabled}
                onChange={(e) => saveCloud({ enabled: e.target.checked })}
              />
              Push to cloud destinations
            </label>
          </div>
          <div className={styles.keys}>
            {cfg.cloud.destinations.map((d) => (
              <div key={d} className={styles.keyRow}>
                <code>{d}</code>
                <button className={styles.del} onClick={() => removeDest(d)}>
                  Remove
                </button>
              </div>
            ))}
            {cfg.cloud.destinations.length === 0 && <p className={styles.dim}>No destinations yet.</p>}
          </div>
          <div className={styles.cloudForm}>
            <input
              type="text"
              placeholder="path or rclone:<remote>"
              value={destInput}
              onChange={(e) => setDestInput(e.target.value)}
            />
            <Button variant="secondary" onClick={addDest} disabled={!destInput.trim()}>
              Add destination
            </Button>
          </div>
          <div className={styles.cloudForm}>
            <input
              type="text"
              placeholder="post-backup hook path (optional)"
              value={hookInput}
              onChange={(e) => setHookInput(e.target.value)}
            />
            <Button variant="secondary" onClick={() => saveCloud({ hook: hookInput.trim() || null })}>
              Save hook
            </Button>
          </div>
          {pendingId && (
            <div className={styles.pending}>
              <span>
                Pending approval in <Link to="/confirmations">Confirmations</Link> (
                <code>{pendingId}</code>) — approve there, then finalize.
              </span>
              <Button variant="secondary" onClick={finalize}>
                Finalize
              </Button>
            </div>
          )}
        </>
      )}
      {msg && <p className={styles.msg}>{msg}</p>}
    </>
  );
}

// Editable default-model field for the first-party paid providers (claude/gemini):
// a datalist-backed input (placeholder = the current default) that POSTs the new
// id to ai.<provider>.model and refreshes the provider chips.
function ProviderModelField({ provider, onSaved }: { provider: Provider; onSaved: () => Promise<void> }) {
  const models = useModelCatalog(provider.id);
  const listId = useId();
  const [val, setVal] = useState('');

  const commit = async () => {
    const next = val.trim();
    if (!next || next === provider.model) { setVal(''); return; }
    await api('/api/config/update', {
      method: 'POST',
      body: JSON.stringify({ path: `ai.${provider.id}.model`, value: next }),
    }).catch(() => {});
    setVal('');
    await onSaved();
  };

  return (
    <span className={styles.provider}>
      {provider.name}{' '}
      <input
        type="text"
        list={listId}
        value={val}
        placeholder={provider.model}
        onChange={(e) => setVal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      />
      <datalist id={listId}>
        {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
      </datalist>
    </span>
  );
}

function LimitField({
  label,
  value,
  onSave,
}: {
  label: string;
  value?: number;
  onSave: (v: number) => void;
}) {
  const [v, setV] = useState('');
  useEffect(() => {
    setV(value != null ? String(value) : '');
  }, [value]);
  return (
    <div className={styles.limit}>
      <label>{label}</label>
      <input
        type="number"
        min={0}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => {
          const t = v.trim();
          if (t === '') return;                 // blank → don't write 0
          const n = Number(t);
          if (!Number.isFinite(n) || n < 0) return;
          if (n !== value) onSave(n);
        }}
      />
    </div>
  );
}
