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
 * Confidence below this asks the inspector to confirm a field before filing.
 *
 * It governs only which fields the review screen puts in front of them; the
 * verdict is the server's, and it re-runs against whatever they confirm.
 */
export const REVIEW_CONFIDENCE_THRESHOLD = 0.75;
