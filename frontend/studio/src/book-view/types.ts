/**
 * View Book — the wire shapes of the four endpoints in the design (§2, §3).
 *
 * Local to `book-view/` on purpose: nothing outside this view speaks them yet,
 * and the design's non-goal is reuse of the *interface*, not growth of a shared
 * type surface. Move them to `@bookclaw/shared` when a second consumer exists.
 */

export type ItemKind = 'prose' | 'document' | 'cover';
export type GroupId = 'front' | 'manuscript' | 'back' | 'reference' | 'launch';
export type FlagLevel = 'bad' | 'warn' | 'note';

export interface Flag {
  level: FlagLevel;
  label: string;
}

export interface Version {
  id: string;
  label: string;
  step?: string;
  createdAt?: string;
  latest: boolean;
}

export interface BookItem {
  id: string;              // 'chapter:19' | 'front:title' | 'ref:compiled'
  group: string;
  title: string;
  kind: ItemKind;
  ready: boolean;
  derived?: boolean;
  words?: number;
  flags?: Flag[];
  producedBy?: { skill: string; pipeline: string };
  versions: Version[];
}

export interface Group {
  id: GroupId;
  label: string;
  state: string;
  items: BookItem[];
}

export interface Gate {
  confirmationId: string;
  stepId: string;
  itemId: string;
  findings: unknown;
  expiresAt: string;
}

export interface RunState {
  projectId?: string;
  status: 'none' | 'writing' | 'paused' | 'gated' | 'complete';
  frontier: number;
  total: number;
  gate?: Gate;
}

export interface ContentsResponse {
  groups: Group[];
  run: RunState;
}

export interface ItemResponse {
  item: BookItem;
  /** Absent when the item has no versions at all (nothing has written it yet). */
  version?: Version;
  body: string;
  editable: boolean;
  /** Why editing is refused — the server's own wording, when it sends one. */
  lockReason?: string;
  file: string | null;
}

export interface CompileResponse {
  file: string;
  words: number;
  chapters: number;
}

/** Reading order of the contents rail — front matter through launch copy. */
export const GROUP_ORDER: GroupId[] = ['front', 'manuscript', 'back', 'reference', 'launch'];

/** The chapter number behind a `chapter:<n>` id, or null for everything else. */
export function chapterNumber(id: string): number | null {
  const m = /^chapter:(\d+)$/.exec(id);
  return m ? Number(m[1]) : null;
}

/** A flag counts as "flagged" for the rail filter when it is a defect, not a note. */
export function isFlagged(item: BookItem): boolean {
  return (item.flags ?? []).some((f) => f.level === 'bad' || f.level === 'warn');
}

/** What the gate's 24h window says: still open (with time left), closed, or not knowable. */
export type GateExpiry =
  | { state: 'unknown' }
  | { state: 'open'; left: string }
  | { state: 'expired' };

/**
 * Time left on a gate's window. An expiry the server couldn't supply — it sends
 * `''` whenever it can't read the confirmation request, including the real
 * window while `openReviewGate` is still creating it — is UNKNOWN, never
 * expired: only a parsed timestamp in the past closes a gate. Rendering an
 * unknown expiry as "expired" hides Approve, which is how a run gets stuck.
 */
export function gateExpiry(expiresAt: string | null | undefined, now: number): GateExpiry {
  if (!expiresAt) return { state: 'unknown' };
  const end = new Date(expiresAt).getTime();
  if (isNaN(end)) return { state: 'unknown' };
  const ms = end - now;
  if (ms <= 0) return { state: 'expired' };
  const mins = Math.floor(ms / 60000);
  const h = Math.floor(mins / 60);
  return { state: 'open', left: h > 0 ? `${h}h ${mins % 60}m` : `${mins}m` };
}

/**
 * The version the trail should highlight: the chosen one, else the one flagged
 * `latest`. Only `latest` marks the newest PROSE version — a gated chapter can
 * carry a non-prose audit or the active sweep last in the trail, so falling
 * straight to the array's end would press a button for a version the reading
 * and raw panes aren't showing. Callers guarantee a non-empty trail.
 */
export function pickVersion(versions: Version[], selectedId: string | null | undefined): Version {
  return versions.find((v) => v.id === selectedId)
    ?? versions.find((v) => v.latest)
    ?? versions[versions.length - 1];
}
