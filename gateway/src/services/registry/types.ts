/**
 * Character Name Registry types (per-book, lightweight, never prompt-injected).
 * See docs/superpowers/specs/2026-07-16-character-name-registry-design.md.
 */

export type NameTier = 'primary' | 'secondary' | 'tertiary' | 'transient';

export interface RegistryCharacter {
  canonical: string;
  tier: NameTier;
  role: string;
  aliases: string[];
  driftMap: string[];
  firstChapter?: number;
}

export interface RegistryLocation {
  canonical: string;
  role: string;
  aliases: string[];
  driftMap: string[];
}

export interface NameRegistry {
  characters: RegistryCharacter[];
  locations: RegistryLocation[];
}
