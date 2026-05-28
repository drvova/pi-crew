/**
 * Types for the Tiered Evaluation System
 * 
 * Inspired by agent-eval's judge tiers for hierarchical evaluation.
 */

/**
 * Evaluation tiers with increasing computational cost.
 * 
 * - Tier 1: Deterministic, fast checks (file existence, parse errors)
 * - Tier 2: Pattern matching, structural checks (grep, regex)
 * - Tier 3: LLM-based evaluation for natural language checks
 */
export type EvalTier = 1 | 2 | 3;

/**
 * Configuration for a specific evaluation tier.
 */
export interface TierConfig {
	/** The tier level */
	tier: EvalTier;
	/** Human-readable name for the tier */
	name: string;
	/** Description of what this tier evaluates */
	description: string;
	/** Maximum time allowed for checks in this tier (milliseconds) */
	timeoutMs: number;
}

/**
 * Result of a single evaluation check.
 */
export interface EvalResult {
	/** The tier this result came from */
	tier: EvalTier;
	/** Whether the check passed */
	passed: boolean;
	/** Optional message with additional context */
	message?: string;
	/** How long the check took in milliseconds */
	durationMs: number;
}

/**
 * Summary of a tiered evaluation run.
 */
export interface TieredEvalSummary {
	/** Number of checks that passed */
	passed: number;
	/** Number of checks that failed */
	failed: number;
	/** Number of checks that timed out */
	timedOut: number;
	/** Total duration of all checks */
	totalDurationMs: number;
	/** Whether all checks passed */
	allPassed: boolean;
}
