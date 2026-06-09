import { useEffect, useState } from 'react';
import { api, Button } from '@bookclaw/shared';
import type { Status } from '@bookclaw/shared';
import styles from './Settings.module.css';

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
    if (!confirm(`Delete ${k} from the vault?`)) return;
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
        {(providers ?? []).map((p) => (
          <span key={p.id} className={styles.provider}>
            {p.name} <small>{p.model}</small>
          </span>
        ))}
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
    </div>
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
