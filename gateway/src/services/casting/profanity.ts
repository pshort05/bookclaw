/**
 * Per-character profanity injection (Flagship Plan 2, Task 3).
 *
 * A character's `profanity` trait describes how authentically they swear.
 * profanityInjection() builds a prompt block instructing the model not to
 * sanitize that character's voice. isInCharacterProfanity() lets the
 * anti-slop humanize/strip passes whitelist a profane line instead of
 * scrubbing it out of a character who is supposed to swear.
 */

export interface CharacterProfanity { level: number; contexts: string[]; register: string }

/** Conservative common-profanity detector — deliberately not exhaustive; false
 * negatives (missed profanity) are safer here than false positives. */
const PROFANITY_RE = /\b(?:fuck(?:ing|ed|er)?|shit(?:ty)?|bitch(?:es)?|ass(?:hole)?|bastard|damn|hell|piss(?:ed)?|dick|cock|crap|bollocks|bugger|bloody)\b/i;

/** True if `text` contains a common profane word. */
export function containsProfanity(text: string): boolean {
  return PROFANITY_RE.test(text);
}

/** A prompt block instructing authentic in-voice profanity. Empty string when
 * the character has no profanity trait or it's set to 0 (clean). */
export function profanityInjection(character: { name: string; profanity?: CharacterProfanity }): string {
  const p = character.profanity;
  if (!p || !p.level) return '';
  const contextNote = p.contexts?.length ? `, especially when ${p.contexts.join(', ')}` : '';
  return `${character.name}'s authentic voice includes profanity (intensity ${p.level}/10, register: ${p.register}). Do NOT sanitize their dialogue — write it in-character${contextNote}.`;
}

/** True when a line is expected profanity for this character — used by the
 * anti-slop whitelist so humanize/strip passes never remove legitimate swearing. */
export function isInCharacterProfanity(line: string, character: { profanity?: CharacterProfanity }): boolean {
  const p = character.profanity;
  if (!p || p.level < 4) return false;
  return containsProfanity(line);
}
