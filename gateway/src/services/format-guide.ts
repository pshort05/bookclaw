/**
 * Append a structure "rail" instruction to the outline/planning step of a step list.
 * Targets the first step whose phase/skill looks like outline/planning; falls back to
 * the first step. Empty rail is a no-op. Mutates in place.
 */
export function applyStructureRail(
  steps: Array<{ prompt: string; phase?: string; skill?: string }>,
  rail: string,
): void {
  if (!rail || steps.length === 0) return;
  const isOutline = (s: { phase?: string; skill?: string }) =>
    /outline|plan/i.test(s.phase ?? '') || /outline|plan/i.test(s.skill ?? '');
  const target = steps.find(isOutline) ?? steps[0];
  target.prompt = `${target.prompt}\n\n---\n${rail}`;
}
