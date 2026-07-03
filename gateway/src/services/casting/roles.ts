export type StepRole =
  | 'scene_brief' | 'draft' | 'improve' | 'rewrite' | 'humanize' | 'intimacy'
  | 'editorial' | 'analysis' | 'research' | 'bible' | 'outline' | 'plan'
  | 'format' | 'marketing' | 'continuity';

export const STEP_ROLES: readonly StepRole[] = [
  'scene_brief', 'draft', 'improve', 'rewrite', 'humanize', 'intimacy',
  'editorial', 'analysis', 'research', 'bible', 'outline', 'plan',
  'format', 'marketing', 'continuity',
];

/** The two generative steps the author's intake prose-model choice controls. */
export const PROSE_ROLES: ReadonlySet<StepRole> = new Set<StepRole>(['scene_brief', 'draft']);

export function isStepRole(x: unknown): x is StepRole {
  return typeof x === 'string' && (STEP_ROLES as readonly string[]).includes(x);
}

/**
 * Best-effort role for an un-tagged step, used only by the one-time migration.
 * Label match wins over skill/taskType because ported per-chapter steps carry
 * descriptive labels ("Scene Brief — Chapter {{n}}") but no skill.
 */
export function inferRole(step: { skill?: string; label?: string; taskType?: string; phase?: string }): StepRole | undefined {
  const label = (step.label || '').toLowerCase();
  const labelMap: Array<[RegExp, StepRole]> = [
    [/scene brief/, 'scene_brief'],
    [/first draft|write chapter/, 'draft'],
    [/humaniz/, 'humanize'],
    [/intimacy|intimate/, 'intimacy'],
    [/improvement|improve/, 'improve'],
    [/rewrite|surgical/, 'rewrite'],
  ];
  for (const [re, role] of labelMap) if (re.test(label)) return role;

  switch (step.skill) {
    case 'write': return 'draft';
    case 'revise': return 'rewrite';
    case 'book-bible': return 'bible';
    case 'outline': return 'outline';
    case 'research': return 'research';
    case 'premise': return 'plan';
    case 'style-clone': return 'editorial';
    case 'dialogue': return 'editorial';
    case 'beta-reader': return 'analysis';
    case 'format': return 'format';
  }
  switch (step.taskType) {
    case 'consistency': return 'continuity';
    case 'final_edit':
    case 'revision': return 'editorial';
    case 'research': return 'research';
    case 'marketing': return 'marketing';
    case 'book_bible': return 'bible';
    case 'outline': return 'outline';
    case 'format': return 'format';
  }
  return undefined;
}
