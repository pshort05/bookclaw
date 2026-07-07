// Keyed node model + pure transforms for the visual pipeline builder.
// Only type-only imports here so everything runs under node:test (see
// fileTree.ts / pipelineSteps.ts for the pattern). The editor holds Node[]
// as its working state; toSteps() serializes back to the exact JSON shapes
// the gateway's pipeline-expand.ts consumes.
import type { LibraryPipelineStep } from '@bookclaw/shared';
import { isExpand, isParallel, type EditorStep } from './pipelineSteps.js';

export type GroupKind = 'expand' | 'parallel';
export interface StepNode { key: string; kind: 'step'; step: LibraryPipelineStep }
export interface GroupNode { key: string; kind: GroupKind; members: StepNode[] }
export type Node = StepNode | GroupNode;

export const isGroupNode = (n: Node): n is GroupNode => n.kind !== 'step';

export function fromSteps(steps: EditorStep[], mkKey: () => string): Node[] {
  return (steps ?? []).map((e): Node => {
    const wrap = (s: LibraryPipelineStep): StepNode => ({ key: mkKey(), kind: 'step', step: s });
    if (isExpand(e)) return { key: mkKey(), kind: 'expand', members: e.steps.map(wrap) };
    if (isParallel(e)) return { key: mkKey(), kind: 'parallel', members: e.parallel.map(wrap) };
    return wrap(e as LibraryPipelineStep);
  });
}

export function toSteps(nodes: Node[]): EditorStep[] {
  return nodes.map((n): EditorStep => {
    if (n.kind === 'step') return n.step;
    const steps = n.members.map((m) => m.step);
    return n.kind === 'expand' ? { expand: 'chapters', steps } : { parallel: steps };
  });
}

export function findByKey(nodes: Node[], key: string): Node | undefined {
  for (const n of nodes) {
    if (n.key === key) return n;
    if (isGroupNode(n)) {
      const m = n.members.find((m) => m.key === key);
      if (m) return m;
    }
  }
  return undefined;
}

/** Container of `key`: undefined = top level, group key = member, null = not found. */
export function containerOf(nodes: Node[], key: string): string | undefined | null {
  for (const n of nodes) {
    if (n.key === key) return undefined;
    if (isGroupNode(n) && n.members.some((m) => m.key === key)) return n.key;
  }
  return null;
}

/** Index of `key` within a container's children (-1 if absent). */
export function indexIn(nodes: Node[], containerKey: string | undefined, key: string): number {
  if (containerKey === undefined) return nodes.findIndex((n) => n.key === key);
  const g = nodes.find((n) => n.key === containerKey);
  return g && isGroupNode(g) ? g.members.findIndex((m) => m.key === key) : -1;
}

function arrayMove<T>(xs: T[], from: number, to: number): T[] {
  if (from < 0 || from >= xs.length || to < 0 || to >= xs.length || from === to) return xs;
  const next = [...xs];
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x);
  return next;
}

/** Reorder within one container (top level when containerKey is undefined). */
export function reorder(nodes: Node[], containerKey: string | undefined, from: number, to: number): Node[] {
  if (containerKey === undefined) return arrayMove(nodes, from, to);
  let changed = false;
  const out = nodes.map((n) => {
    if (n.key !== containerKey || !isGroupNode(n)) return n;
    const members = arrayMove(n.members, from, to);
    if (members === n.members) return n;
    changed = true;
    return { ...n, members };
  });
  return changed ? out : nodes;
}

export function insertTop(nodes: Node[], index: number, node: Node): Node[] {
  const i = Math.max(0, Math.min(index, nodes.length));
  return [...nodes.slice(0, i), node, ...nodes.slice(i)];
}

export function insertMember(nodes: Node[], groupKey: string, index: number, member: StepNode): Node[] {
  let changed = false;
  const out = nodes.map((n) => {
    if (n.key !== groupKey || !isGroupNode(n)) return n;
    changed = true;
    const i = Math.max(0, Math.min(index, n.members.length));
    return { ...n, members: [...n.members.slice(0, i), member, ...n.members.slice(i)] };
  });
  return changed ? out : nodes;
}

export function removeByKey(nodes: Node[], key: string): Node[] {
  if (!findByKey(nodes, key)) return nodes;
  return nodes
    .filter((n) => n.key !== key)
    .map((n) => isGroupNode(n) && n.members.some((m) => m.key === key)
      ? { ...n, members: n.members.filter((m) => m.key !== key) }
      : n);
}

/** Move a plain step (from the top level or another group) into a group. Rejects group nodes. */
export function moveIntoGroup(nodes: Node[], stepKey: string, groupKey: string, index?: number): Node[] {
  const node = findByKey(nodes, stepKey);
  const group = nodes.find((n) => n.key === groupKey);
  if (!node || node.kind !== 'step' || !group || !isGroupNode(group)) return nodes;
  const without = removeByKey(nodes, stepKey);
  const g = without.find((n) => n.key === groupKey);
  if (!g || !isGroupNode(g)) return nodes;
  return insertMember(without, groupKey, index ?? g.members.length, node);
}

/** Pull a group member out to the top level at topIndex. No-op for non-members. */
export function extractFromGroup(nodes: Node[], memberKey: string, topIndex: number): Node[] {
  const node = findByKey(nodes, memberKey);
  const container = containerOf(nodes, memberKey);
  if (!node || node.kind !== 'step' || typeof container !== 'string') return nodes;
  return insertTop(removeByKey(nodes, memberKey), topIndex, node);
}

/** Patch the LibraryPipelineStep of a plain step or group member. */
export function patchStep(nodes: Node[], key: string, patch: Partial<LibraryPipelineStep>): Node[] {
  let changed = false;
  const out = nodes.map((n) => {
    if (n.kind === 'step') {
      if (n.key !== key) return n;
      changed = true;
      return { ...n, step: { ...n.step, ...patch } };
    }
    if (!n.members.some((m) => m.key === key)) return n;
    changed = true;
    return { ...n, members: n.members.map((m) => m.key === key ? { ...m, step: { ...m.step, ...patch } } : m) };
  });
  return changed ? out : nodes;
}
