/**
 * Shared builder for the AI-generation context of an activity-log entry's
 * metadata: which provider, model, book, and skill produced a turn/step.
 *
 * This exists because the activity log recorded the provider but NOT the model,
 * book, or skill — so when a per-book model pin silently fell back to a tiny
 * default model, the activity feed gave no way to see it. Spread the result into
 * a call site's own metadata. Empty/undefined fields are omitted so entries stay
 * tidy and the dashboard renderer never shows blank keys.
 */
export interface GenerationMetaInput {
  provider?: string;
  model?: string;
  bookSlug?: string;
  skill?: string;
}

export function generationMeta(input: GenerationMetaInput): Record<string, string> {
  const m: Record<string, string> = {};
  if (input.provider) m.provider = input.provider;
  if (input.model) m.model = input.model;
  if (input.bookSlug) m.bookSlug = input.bookSlug;
  if (input.skill) m.skill = input.skill;
  return m;
}
