import type { Scope } from './assetApi.js';

export function sourceBadge(scope: Scope, source?: string): { cls: 'builtin' | 'yours' | 'book'; label: string } {
  if (scope === 'book') return { cls: 'book', label: 'book copy' };
  if (source === 'workspace') return { cls: 'yours', label: 'yours' };
  return { cls: 'builtin', label: 'built-in' };
}
