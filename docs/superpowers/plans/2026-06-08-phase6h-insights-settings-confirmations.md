# Phase 6h — Insights/HQ + Settings + Confirmations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Build the three remaining studio screens — **Insights** (`/insights`: spend + counts + recent activity), **Settings** (`/settings`: provider API keys via the Vault + a few whitelisted config values), and **Confirmations** (`/confirmations`: the approval queue with approve/reject) — closing studio parity for the legacy `insights`/`hq`/`settings`/`idle-tasks` panels and wiring the Rail's last three nav items.

**Architecture:** Front-end only, over existing endpoints. **No concept markup exists** for these views (the concept only has board/write/activity), so they're built from the established design system (`.hero`/grid/`.card`/`.chip`/`Button`) + `tokens.css`. The store's `costs`/`activity`/`confirmations` slices (6b) are reused. **Security-critical:** API keys are write-only — never fetched or displayed; the Settings key form uses a password input, posts to `/api/vault`, clears on success, and lists only key *names* via `/api/vault/keys`.

**Tech Stack:** React 18 + Vite + Router + Zustand + `@bookclaw/shared` (`api`, `Button`, store hooks). No new deps. No backend change.

**Spec:** API contracts confirmed against `gateway/src/api/routes/{settings,core,knowledge}.routes.ts`; legacy reference `dashboard/src/panels/{settings,hq,insights}.js`.

---

## Conventions (read once)

- **No git commits during execution** — working tree only; maintainer pushes via `./push.sh`. Review checkpoint per task. On `main`.
- **No FE test runner** → verify via `npx tsc --noEmit` + `npm run -w frontend/studio build` + manual. (No backend change → unit suite stays 120/120.)
- **Surgical; match existing style.** Reuse the established classes/patterns from `Board.module.css`/`tokens.css` (`.hero`/`.card`/`.chip`/`Button`); each route gets its own `*.module.css` using the token variables (`--panel`/`--line`/`--ember`/`--ph-*`/`--gold`/`--alert`/`--r`). No new design tokens.
- **SECURITY (do not violate):**
  - **Never GET or render an API key value.** The key form is write-only: `POST /api/vault {key, value}` → clear the input on success. List keys via `GET /api/vault/keys` (names only) with a delete (`DELETE /api/vault/:key`). The value input is `type="password"`, `autoComplete="off"`.
  - Confirmation `payload` is already server-redacted — safe to display, but keep it collapsed/secondary (show description/risk/disclosures primarily).
  - Config writes only use the whitelisted `POST /api/config/update {path, value}` paths.

---

## Backend contracts (confirmed; use exactly)

- **Settings:** `GET /api/vault/keys` → `{ keys: string[] }` (names only). `POST /api/vault { key, value }` → `{ success, refreshedProviders? }` (key validated `[A-Za-z0-9_-]+`; never echoed). `DELETE /api/vault/:key` → `{ success }`. `POST /api/providers/refresh` → `{ success, providers: [{id,name,model,tier}] }`. `GET /api/config` → `{ ai, heartbeat, costs, security }` (sanitized). `POST /api/config/update { path, value }` → `{ success, path, value }` (whitelisted paths incl. `costs.dailyLimit`, `costs.monthlyLimit`, `ai.preferredProvider`, `heartbeat.dailyWordGoal`). `GET /api/telegram/status` → `{ enabled, hasToken, connected, allowedUsers, pairingEnabled }` (read-only here).
- **Insights:** `GET /api/costs` → `{ daily, monthly, overBudget, dailyLimit, monthlyLimit }`. `GET /api/status` → `{ version, providers:[{id,name,model,tier}], skills:{total,author,premium,premiumInstalled,byCategory}, … }`. `GET /api/books` → `{ books:[…] }`. `GET /api/projects/list` → `{ projects:[…] }`. `GET /api/personas` → `{ personas:[…] }`. `GET /api/activity?count=8` → `{ entries:[…] }`.
- **Confirmations:** `GET /api/confirmations?status=pending` → `{ requests: ConfirmationRequest[], disclaimer }`. `POST /api/confirmations/:id/approve` → `{ request }`. `POST /api/confirmations/:id/reject { reason? }` → `{ request }`. `ConfirmationRequest` (already in `types.ts` from 6b): id, createdAt, expiresAt, service, action, platform, description, riskLevel, isReversible, disclosures[], estimatedCost?, status.

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `frontend/shared/src/store.ts` | add `loadStatus` already exists; add a `providers`/counts loader if useful (optional) | Modify (minimal) |
| `frontend/studio/src/routes/Insights.tsx` + `.module.css` | spend + counts + recent activity | Create |
| `frontend/studio/src/routes/Settings.tsx` + `.module.css` | vault keys + whitelisted config + providers | Create |
| `frontend/studio/src/routes/Confirmations.tsx` + `.module.css` | approval queue + approve/reject | Create |
| `frontend/shared/src/types.ts` | add `Config` (minimal) + `VaultKeys` types | Modify |
| `frontend/studio/src/main.tsx` | add `/insights`, `/settings`, `/confirmations` routes | Modify |
| `frontend/studio/src/Rail.tsx` | wire Insights/Settings/Confirmations NavLinks | Modify |

---

### Task 1: Insights route

**Files:** Create `frontend/studio/src/routes/Insights.tsx`, `Insights.module.css`.

- [ ] **Step 1:** `Insights.tsx` — on mount, fetch in parallel and render read-only:
```tsx
import { useEffect, useState } from 'react';
import { api, useStore, useCosts, useActivity, type Status, type ActivityEntry } from '@bookclaw/shared';
import { hhmm } from '@bookclaw/shared';
import styles from './Insights.module.css';

export function Insights() {
  const costs = useCosts();
  const activity = useActivity();
  const loadCosts = useStore((s) => s.loadCosts);
  const loadActivity = useStore((s) => s.loadActivity);
  const [status, setStatus] = useState<Status | null>(null);
  const [counts, setCounts] = useState<{ books?: number; projects?: number; personas?: number }>({});

  useEffect(() => {
    loadCosts().catch(() => {});
    loadActivity(8).catch(() => {});
    let cancelled = false;
    Promise.all([
      api<Status>('/api/status').catch(() => null),
      api<{ books: unknown[] }>('/api/books').catch(() => ({ books: [] })),
      api<{ projects: unknown[] }>('/api/projects/list').catch(() => ({ projects: [] })),
      api<{ personas: unknown[] }>('/api/personas').catch(() => ({ personas: [] })),
    ]).then(([st, b, p, pe]) => {
      if (cancelled) return;
      setStatus(st);
      setCounts({ books: b?.books?.length, projects: p?.projects?.length, personas: pe?.personas?.length });
    });
    return () => { cancelled = true; };
  }, [loadCosts, loadActivity]);

  const dailyPct = costs && costs.dailyLimit > 0 ? Math.min(100, (costs.daily / costs.dailyLimit) * 100) : 0;
  const monthlyPct = costs && costs.monthlyLimit > 0 ? Math.min(100, (costs.monthly / costs.monthlyLimit) * 100) : 0;

  return (
    <div className={styles.scroll}>
      <h1 className={styles.h1}>Insights</h1>

      {/* Spend */}
      <div className={styles.cards}>
        <div className={styles.card}>
          <div className={styles.cap}><span>AI spend · today</span><b>${(costs?.daily ?? 0).toFixed(2)} / ${costs?.dailyLimit ?? 0}</b></div>
          <div className={styles.bar}><i style={{ width: `${dailyPct}%` }} className={costs?.overBudget ? styles.over : undefined} /></div>
        </div>
        <div className={styles.card}>
          <div className={styles.cap}><span>AI spend · month</span><b>${(costs?.monthly ?? 0).toFixed(2)} / ${costs?.monthlyLimit ?? 0}</b></div>
          <div className={styles.bar}><i style={{ width: `${monthlyPct}%` }} /></div>
        </div>
      </div>

      {/* Counts */}
      <div className={styles.stats}>
        <Stat label="Books" value={counts.books} />
        <Stat label="Projects" value={counts.projects} />
        <Stat label="Personas" value={counts.personas} />
        <Stat label="Skills" value={status?.skills?.total} />
        <Stat label="Providers" value={status?.providers?.length} />
      </div>

      {/* Recent activity */}
      <div className={styles.sec}>Recent activity</div>
      <div className={styles.feed}>
        {activity.slice(0, 8).map((e: ActivityEntry, i) => (
          <div key={`${e.timestamp}-${i}`} className={styles.ev}>
            <span className={styles.ts}>{hhmm(e.timestamp)}</span>
            <span className={styles.bd}>{e.message}</span>
          </div>
        ))}
        {activity.length === 0 && <p className={styles.dim}>No activity yet.</p>}
      </div>
    </div>
  );
}
function Stat({ label, value }: { label: string; value?: number }) {
  return <div className={styles.stat}><div className={styles.statN}>{value ?? '—'}</div><div className={styles.statL}>{label}</div></div>;
}
```
(`Status.skills` may need adding to the `Status` type — add `skills?: { total: number; … }` in Task 4.)

- [ ] **Step 2:** `Insights.module.css` — using tokens: `.scroll` (padding like Board), `.h1`, `.cards` (2-col grid), `.card` (panel + border + radius), `.cap` (flex space-between, mono label), `.bar` (track) + `i` (ember-grad fill) + `.over` (alert fill), `.stats` (grid of `.stat` cards: big `.statN` number + `.statL` mono label), `.sec` (mono section header), `.feed`/`.ev`/`.ts`/`.bd`/`.dim`. Reuse the Rail's budget-bar look + Board's card look.

- [ ] **Step 3: Verify** — `tsc` clean (after Task 4 types); build succeeds.

- [ ] **Step 4: Review checkpoint** — read-only; graceful `—` when data missing; spend bar clamps + shows over-budget.

---

### Task 2: Settings route (vault keys + config — security-careful)

**Files:** Create `frontend/studio/src/routes/Settings.tsx`, `Settings.module.css`.

- [ ] **Step 1:** `Settings.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { api, Button, type Status } from '@bookclaw/shared';
import styles from './Settings.module.css';

const KEY_OPTIONS = ['gemini_api_key', 'deepseek_api_key', 'anthropic_api_key', 'openai_api_key', 'openrouter_api_key'];

export function Settings() {
  const [keys, setKeys] = useState<string[]>([]);
  const [providers, setProviders] = useState<Status['providers']>([]);
  const [keyName, setKeyName] = useState(KEY_OPTIONS[0]);
  const [keyVal, setKeyVal] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [costs, setCosts] = useState<{ dailyLimit?: number; monthlyLimit?: number }>({});

  const loadKeys = () => api<{ keys: string[] }>('/api/vault/keys').then((r) => setKeys(r.keys ?? [])).catch(() => {});
  const loadStatus = () => api<Status>('/api/status').then((r) => setProviders(r.providers ?? [])).catch(() => {});
  const loadConfig = () => api<{ costs?: { dailyLimit?: number; monthlyLimit?: number } }>('/api/config').then((r) => setCosts(r.costs ?? {})).catch(() => {});

  useEffect(() => { loadKeys(); loadStatus(); loadConfig(); }, []);

  const saveKey = async () => {
    if (!keyVal.trim()) return;
    setMsg(null);
    try {
      await api('/api/vault', { method: 'POST', body: JSON.stringify({ key: keyName, value: keyVal }) });
      setKeyVal('');                      // NEVER echo — clear immediately
      setMsg('Key saved and encrypted.');
      await loadKeys();
      await api('/api/providers/refresh', { method: 'POST' }).catch(() => {});
      await loadStatus();
    } catch (e) { setMsg(`Couldn’t save — ${String(e)}`); }
  };

  const delKey = async (k: string) => {
    if (!confirm(`Delete ${k} from the vault?`)) return;
    await api(`/api/vault/${encodeURIComponent(k)}`, { method: 'DELETE' }).catch(() => {});
    await loadKeys();
  };

  const saveLimit = async (path: string, value: number) => {
    await api('/api/config/update', { method: 'POST', body: JSON.stringify({ path, value }) }).catch(() => {});
    await loadConfig();
  };

  return (
    <div className={styles.scroll}>
      <h1 className={styles.h1}>Settings</h1>

      <div className={styles.sec}>Providers</div>
      <div className={styles.providers}>
        {(providers ?? []).map((p) => <span key={p.id} className={styles.provider}>{p.name} <small>{p.model}</small></span>)}
        {(!providers || providers.length === 0) && <p className={styles.dim}>No active providers — add an API key below.</p>}
      </div>

      <div className={styles.sec}>API keys <small>· stored encrypted in the vault; never shown</small></div>
      <div className={styles.keys}>
        {keys.map((k) => <div key={k} className={styles.keyRow}><code>{k}</code><button className={styles.del} onClick={() => delKey(k)}>Delete</button></div>)}
        {keys.length === 0 && <p className={styles.dim}>No keys stored yet.</p>}
      </div>
      <div className={styles.keyForm}>
        <select value={keyName} onChange={(e) => setKeyName(e.target.value)}>{KEY_OPTIONS.map((k) => <option key={k} value={k}>{k}</option>)}</select>
        <input type="password" autoComplete="off" placeholder="paste key…" value={keyVal} onChange={(e) => setKeyVal(e.target.value)} />
        <Button variant="primary" onClick={saveKey} disabled={!keyVal.trim()}>Save key</Button>
      </div>
      {msg && <p className={styles.msg}>{msg}</p>}

      <div className={styles.sec}>Spend limits</div>
      <div className={styles.limits}>
        <LimitField label="Daily ($)" value={costs.dailyLimit} onSave={(v) => saveLimit('costs.dailyLimit', v)} />
        <LimitField label="Monthly ($)" value={costs.monthlyLimit} onSave={(v) => saveLimit('costs.monthlyLimit', v)} />
      </div>
    </div>
  );
}

function LimitField({ label, value, onSave }: { label: string; value?: number; onSave: (v: number) => void }) {
  const [v, setV] = useState('');
  useEffect(() => { setV(value != null ? String(value) : ''); }, [value]);
  return (
    <div className={styles.limit}>
      <label>{label}</label>
      <input type="number" min={0} value={v} onChange={(e) => setV(e.target.value)} onBlur={() => { const n = Number(v); if (!isNaN(n) && n !== value) onSave(n); }} />
    </div>
  );
}
```

- [ ] **Step 2:** `Settings.module.css` — `.scroll`/`.h1`/`.sec`/`.dim` (match Insights), `.providers`/`.provider` (chips), `.keys`/`.keyRow` (mono code + delete), `.del` (small danger button), `.keyForm` (flex: select + password input + button), `.msg`, `.limits`/`.limit` (labelled number inputs). Use tokens; inputs styled like the Asset Studio/New-Book inputs (bordered, panel bg).

- [ ] **Step 3: Verify** — `tsc` clean; build succeeds.

- [ ] **Step 4: Review checkpoint** — **the key value input is `type=password`, cleared on save, never read back from any GET; only key names listed.** Config writes use whitelisted paths only. Delete confirms.

---

### Task 3: Confirmations route

**Files:** Create `frontend/studio/src/routes/Confirmations.tsx`, `Confirmations.module.css`.

- [ ] **Step 1:** `Confirmations.tsx` — reuse the store's `confirmations` + `loadConfirmations` (6b):
```tsx
import { useEffect, useState } from 'react';
import { api, useStore, usePendingConfirmations, Button, type ConfirmationRequest } from '@bookclaw/shared';
import styles from './Confirmations.module.css';

export function Confirmations() {
  const pending = usePendingConfirmations();
  const loadConfirmations = useStore((s) => s.loadConfirmations);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { loadConfirmations().catch(() => {}); }, [loadConfirmations]);

  const decide = async (id: string, decision: 'approve' | 'reject') => {
    setBusy(id);
    try {
      const body = decision === 'reject' ? JSON.stringify({ reason: prompt('Reason (optional)?') || '' }) : undefined;
      await api(`/api/confirmations/${encodeURIComponent(id)}/${decision}`, { method: 'POST', body });
      await loadConfirmations();
    } finally { setBusy(null); }
  };

  return (
    <div className={styles.scroll}>
      <h1 className={styles.h1}>Confirmations</h1>
      {pending.length === 0 ? (
        <p className={styles.empty}>Nothing awaiting approval.</p>
      ) : pending.map((c: ConfirmationRequest) => (
        <article key={c.id} className={`${styles.card} ${styles[c.riskLevel] ?? ''}`}>
          <div className={styles.chead}>
            <span className={styles.risk}>{c.riskLevel}</span>
            <span className={styles.service}>{c.platform} · {c.action}</span>
            {c.estimatedCost != null && <span className={styles.cost}>${c.estimatedCost.toFixed(2)}</span>}
          </div>
          <p className={styles.desc}>{c.description}</p>
          {c.disclosures?.length > 0 && <ul className={styles.disc}>{c.disclosures.map((d, i) => <li key={i}>{d}</li>)}</ul>}
          <div className={styles.meta}>{c.isReversible ? 'reversible' : 'NOT reversible'} · expires {new Date(c.expiresAt).toLocaleString()}</div>
          <div className={styles.acts}>
            <Button variant="secondary" onClick={() => decide(c.id, 'reject')} disabled={busy === c.id}>Reject</Button>
            <Button variant="primary" onClick={() => decide(c.id, 'approve')} disabled={busy === c.id}>{busy === c.id ? '…' : 'Approve'}</Button>
          </div>
        </article>
      ))}
    </div>
  );
}
```

- [ ] **Step 2:** `Confirmations.module.css` — `.scroll`/`.h1`/`.empty`, `.card` (panel + border; `.high`/`.critical` get an alert-tinted border), `.chead` (flex: `.risk` pill + `.service` + `.cost` gold), `.desc`, `.disc` (small list), `.meta` (mono dim), `.acts` (right-aligned button row). Use `--alert` for high/critical risk accents.

- [ ] **Step 3: Verify** — `tsc` clean; build succeeds.

- [ ] **Step 4: Review checkpoint** — approve/reject hit the real endpoints; reject sends optional reason; list refreshes (badge in Rail updates via the store); empty state; high-risk visually flagged.

---

### Task 4: Types + router + Rail wiring + verification

**Files:** Modify `frontend/shared/src/types.ts`, `frontend/studio/src/main.tsx`, `frontend/studio/src/Rail.tsx`.

- [ ] **Step 1: Types.** In `types.ts`, extend `Status` with the fields these screens read (additive): `skills?: { total: number; author?: number; premium?: number; premiumInstalled?: number };` (providers already typed). No other new types strictly needed (Config read inline).

- [ ] **Step 2: Routes.** `main.tsx`: import + add `<Route path="insights" element={<Insights />} />`, `<Route path="settings" element={<Settings />} />`, `<Route path="confirmations" element={<Confirmations />} />`.

- [ ] **Step 3: Rail.** Convert the inert Insights/Settings/Confirmations `<a href="#">` items to `<NavLink to="/insights|/settings|/confirmations">` (keep icons; mirror the active-class pattern). The Confirmations badge (live count) is already wired from 6b — keep it.

- [ ] **Step 4: Build + verify.** `npm run build:frontend`; `npx tsc --noEmit` clean; `node --import tsx --test tests/unit/*.test.ts` → 120/120.

- [ ] **Step 5: Manual** — `BOOKCLAW_AUTH_TOKEN=test npm start`:
  - Insights: spend bars + counts (books/projects/personas/skills/providers) + recent activity render.
  - Settings: provider list; add a (dummy) key → input clears, key name appears in the list, no value ever shown; delete it; change a spend limit → persists (re-open shows it). **Confirm no key value is ever fetched/rendered (check Network tab — only `/api/vault/keys` names).**
  - Confirmations: pending queue (if any) with approve/reject; empty state otherwise; the Rail badge reflects the count.
  - No CSP errors.

- [ ] **Step 6: Review checkpoint** — three nav items now route; security (no key echo) holds; nothing fabricated (counts/spend/activity are real).

---

## Self-Review (6h)

- **Spec coverage:** Insights (spend + counts + recent activity), Settings (vault keys add/list/delete + providers + whitelisted spend-limit config), Confirmations (approval queue + approve/reject). Closes parity for legacy insights/hq/settings + the approvals queue; wires the Rail's last three nav items. **Deferred (labeled/omitted, not fabricated):** Telegram connect (read-only status only — connect flow deferred), research actions (generative/cost — not on an overview), historical spend breakdown (no endpoint), the full whitelisted-config surface (only spend limits exposed; others via API).
- **Placeholder scan:** all data from confirmed endpoints; CSS reuses established token-based patterns (no concept exists for these views — designed from the system, stated up front).
- **Type consistency:** `Status`/`Costs`/`ActivityEntry`/`ConfirmationRequest` reused from shared types; the added `Status.skills` is additive; the create/decide bodies match the confirmed contracts.
- **Security:** key values are write-only (password input, cleared on save, never GET/render); only key names listed; confirmation payloads are server-redacted and shown secondarily; config writes use whitelisted paths.
