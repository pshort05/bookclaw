/** Caller-supplied bad input (non-.docx, out of tree, unmatched range, bad colour) → HTTP 400. */
export class FinishInputError extends Error {}
