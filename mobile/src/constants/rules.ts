/**
 * Client-side compliance constants.
 *
 * Phase 1 carried a presentation-side copy of the declaration requirements
 * (`RULE_SETS` / `resolveRuleSet`) so the result screen could be category-aware
 * with no backend. That table was deleted when the API landed, exactly as its
 * own note said it should be: the backend is now authoritative, and every
 * verdict arrives carrying the rule set it was assessed against —
 * `ComplianceResult.ruleSetId` and `.ruleSetLabel`, rendered by
 * `ResultScreen`. A second copy of the law here could only drift out of step
 * with the one that actually decided the outcome.
 *
 * What remains is the one value that is genuinely a client concern.
 */

/**
 * Confidence below this routes a field to human review.
 *
 * The server makes the same call when it sets `REVIEW_REQUIRED`; this threshold
 * governs only how the review screen orders and highlights fields for the
 * inspector working through them.
 */
export const REVIEW_CONFIDENCE_THRESHOLD = 0.75;
