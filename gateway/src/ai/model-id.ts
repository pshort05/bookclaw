/**
 * Validate a free-text model id before it is sent verbatim to a provider API
 * (and, for Gemini, interpolated into the request URL path). Conservative but
 * permissive enough for real ids: non-empty, length-capped, no control chars,
 * no whitespace/URL metacharacters, no path traversal. Examples that pass:
 * "google/gemini-2.5-flash", "claude-sonnet-4-5-20250929",
 * "anthropic/claude-3.5-sonnet:beta".
 */
export function isValidModelId(model: unknown): model is string {
  return typeof model === 'string'
    && model.length > 0 && model.length <= 200
    && !/[\x00-\x1f]/.test(model)   // control chars
    && !/[\s?#]/.test(model)        // whitespace + URL metacharacters
    && !model.includes('..');       // path traversal
}
