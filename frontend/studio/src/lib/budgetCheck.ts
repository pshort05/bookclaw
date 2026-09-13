/**
 * Merge + identity helpers for the premise-intake budget re-check
 * (POST /api/books/intake/budget-check, see PremiseIntake.tsx).
 *
 * The review screen holds ONE discrepancy list: the grounding fact-check from
 * analyze plus the deterministic budget conflicts. Editing the chapter/word counts
 * re-runs only the budget half, so a re-check must REPLACE the budget findings in
 * place — never append a second copy, never touch a grounding finding.
 */

/** Prefix of the ids minted by `budgetDiscrepancies` (gateway/src/services/premise-intake.ts). */
const BUDGET_ID_PREFIX = 'budget-';

export interface MergeableDiscrepancy { id: string; finding: string; }

export const isBudgetDiscrepancy = (d: MergeableDiscrepancy): boolean => d.id.startsWith(BUDGET_ID_PREFIX);

/**
 * Key for the Apply/Keep resolution map: id AND finding, not id alone. Budget ids
 * are positional, so the same id can come back describing a DIFFERENT conflict once
 * the author edits the counts; including the finding (which quotes the chosen
 * numbers) means a changed conflict has to be decided again. A resolution left
 * behind by a conflict that disappeared is simply never read — it cannot block
 * "Start book", which only looks at the discrepancies currently listed.
 */
export const discKey = (d: MergeableDiscrepancy): string => `${d.id}|${d.finding}`;

/** Swap the budget findings for the freshly re-checked set, keeping grounding ones in place. */
export function mergeBudgetDiscrepancies<D extends MergeableDiscrepancy>(current: D[], budget: D[]): D[] {
  return [...current.filter((d) => !isBudgetDiscrepancy(d)), ...budget];
}
