// Tool-group selection (Phase 6). Pure logic — no SDK imports — so it is unit
// testable. The server maps each group name to its register function.
//
// Tools are organized into per-module groups. A "profile" is a named bundle of
// groups. BOOKCLAW_MCP_PROFILE picks a profile (default "all"); BOOKCLAW_MCP_GROUPS
// overrides it with an explicit per-group allowlist. The escape-hatch group is
// always included so full API reach is never lost.

export const GROUP_NAMES = [
  'status', 'books', 'projects', 'chat', 'export', 'library',
  'personas', 'series', 'craft', 'world', 'publishing', 'media', 'audiobook',
  'marketing', 'website', 'escape-hatch',
] as const;

export type GroupName = (typeof GROUP_NAMES)[number];

const ALWAYS: GroupName = 'escape-hatch';
const CORE: GroupName[] = ['status', 'books', 'projects', 'chat', 'export', 'library'];

export const PROFILES: Record<string, GroupName[]> = {
  all: [...GROUP_NAMES],
  core: CORE,
  author: [...CORE, 'personas', 'series', 'craft', 'world'],
  publishing: [...CORE, 'publishing', 'media', 'audiobook'],
  marketing: [...CORE, 'marketing', 'website'],
};

export interface ResolvedGroups {
  names: GroupName[];
  source: string;
  warnings: string[];
}

interface GroupEnv {
  BOOKCLAW_MCP_PROFILE?: string;
  BOOKCLAW_MCP_GROUPS?: string;
}

const isGroupName = (s: string): s is GroupName => (GROUP_NAMES as readonly string[]).includes(s);

/** Resolve the selected tool groups from env. Pure; never throws. */
export function resolveToolGroups(env: GroupEnv): ResolvedGroups {
  const warnings: string[] = [];
  const groupsRaw = (env.BOOKCLAW_MCP_GROUPS ?? '').trim();

  let selected: GroupName[];
  let source: string;

  if (groupsRaw) {
    const requested = groupsRaw.split(',').map((s) => s.trim()).filter(Boolean);
    const unknown = requested.filter((g) => !isGroupName(g));
    if (unknown.length) warnings.push(`Unknown tool groups ignored: ${unknown.join(', ')}`);
    selected = requested.filter(isGroupName);
    source = `groups=${groupsRaw}`;
  } else {
    const profile = (env.BOOKCLAW_MCP_PROFILE ?? 'all').trim() || 'all';
    if (PROFILES[profile]) {
      selected = PROFILES[profile];
      source = `profile=${profile}`;
    } else {
      warnings.push(`Unknown BOOKCLAW_MCP_PROFILE "${profile}" — falling back to "all".`);
      selected = PROFILES.all;
      source = 'profile=all (fallback)';
    }
  }

  // escape-hatch is always reachable; de-dupe while preserving GROUP_NAMES order.
  const wanted = new Set<GroupName>([...selected, ALWAYS]);
  const names = GROUP_NAMES.filter((g) => wanted.has(g));
  return { names, source, warnings };
}
