export type FactType = 'immutable' | 'stateful';
export type FactSource = 'canon' | 'manuscript';
export interface LedgerFact {
  world: string | null; bookSlug: string | null;
  entity: string; aliases: string[]; attribute: string;
  type: FactType; valueRaw: string; valueNorm: string;
  storyTime: number; timeLabel: string | null; transition: string | null;
  chapter: string; scene: number; source: FactSource; evidence: string;
  /** Human-readable label for a canon source (e.g. "World: Mythria", "Series bible"). Optional. */
  sourceLabel?: string;
}
export type FindingCategory = 'contradiction' | 'continuity' | 'impossibility' | 'canon-divergence';
export type Severity = 'high' | 'medium' | 'low';
export interface FindingRef { chapter: string; scene: number; quote: string; }
export interface CanonRef { canonSource: string; quote: string; }
export interface ConsistencyFinding {
  category: FindingCategory; severity: Severity; entity: string; attribute: string;
  a: FindingRef; b: FindingRef | CanonRef; explanation: string; suggestedFix: string;
}
