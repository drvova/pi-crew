/**
 * failure-patterns.ts — Group failed tasks by error similarity (Round 17 BS-4).
 *
 * Before this, a run with 8 failed tasks surfaced 8 separate raw error
 * strings. The user had to mentally group them ("5 of these say 'model
 * routing fallback failed'"). This module detects common failure patterns
 * so `summary` can say "5 of 8 failures share root cause: X".
 *
 * Grouping strategy (cheap, deterministic, no ML):
 *   1. Normalize: lowercase, collapse whitespace, strip task ids / run ids /
 *      absolute paths / numbers → a canonical "signature".
 *   2. Bucket by signature. Buckets with >1 member are "common patterns".
 *   3. Sort by frequency desc.
 *
 * Conservative: only buckets with >=2 members count as a pattern (a single
 * failure is just itself). Returns [] when there are no repeated signatures.
 */

export interface FailurePattern {
	/** Canonical error signature used for grouping. */
	signature: string;
	/** A representative original error (the shortest variant) for display. */
	representative: string;
	/** Task ids that hit this pattern. */
	taskIds: string[];
	/** Count of failures in this bucket (== taskIds.length). */
	count: number;
}

export interface FailurePatternInput {
	id: string;
	status: string;
	error?: string;
}

/**
 * Normalize an error string into a grouping signature.
 * Exported for unit testing.
 */
export function normalizeErrorSignature(error: string | undefined): string {
	if (!error) return "(no error detail)";
	let s = error.toLowerCase();
	// Strip run ids (team_YYYYMMDDHHMMSS_xxxxxxxxxxxxxxxx)
	s = s.replace(/team_\d{8,}_[a-z0-9]{12,}/g, "<run>");
	// Strip task ids (01_explore, adaptive-03-executor, etc.)
	s = s.replace(/\b(adaptive-)?\d{2,}[a-z0-9_-]+/g, "<task>");
	// Strip absolute paths
	s = s.replace(/\/(?:home|users|tmp|var|opt|root)[^\s'"]*/g, "<path>");
	// Strip numbers (line numbers, counts, pids, ms durations)
	s = s.replace(/\b\d+\b/g, "N");
	// Collapse whitespace
	s = s.replace(/\s+/g, " ").trim();
	return s || "(no error detail)";
}

/**
 * Group failed tasks by error-pattern similarity. Only groups with >=2
 * members are returned (singletons are not "patterns"). Sorted by count desc.
 *
 * @param tasks  the run's tasks (any with status 'failed'/'cancelled' are
 *               considered failures for aggregation purposes).
 */
export function aggregateFailurePatterns(tasks: FailurePatternInput[]): FailurePattern[] {
	const failed = tasks.filter(
		(t) => t.status === "failed" || t.status === "cancelled",
	);
	if (failed.length === 0) return [];
	const buckets = new Map<string, FailurePattern>();
	for (const t of failed) {
		const signature = normalizeErrorSignature(t.error);
		const existing = buckets.get(signature);
		if (existing) {
			existing.taskIds.push(t.id);
			existing.count += 1;
			// Keep the shortest non-empty variant as representative (most readable).
			if (t.error && (!existing.representative || t.error.length < existing.representative.length)) {
				existing.representative = t.error;
			}
		} else {
			buckets.set(signature, {
				signature,
				representative: t.error ?? "(no error detail)",
				taskIds: [t.id],
				count: 1,
			});
		}
	}
	// Only patterns with >=2 members (repeated root causes).
	return [...buckets.values()]
		.filter((b) => b.count >= 2)
		.sort((a, b) => b.count - a.count);
}

/**
 * Render failure patterns as human-readable lines for the `summary` action.
 * Returns [] when there are no repeated patterns (so the caller can omit the
 * section entirely).
 *
 * Example output:
 *   Common failure patterns (3 of 5 failures share 2 root causes):
 *   - [×3] model routing fallback failed: all 2 candidates exhausted
 *       tasks: 02_exec, 03_exec, 04_exec
 *   - [×2] EPERM: operation not permitted, rename
 *       tasks: 05_exec, 06_exec
 */
export function formatFailurePatterns(tasks: FailurePatternInput[]): string[] {
	const patterns = aggregateFailurePatterns(tasks);
	if (patterns.length === 0) return [];
	const failedCount = tasks.filter(
		(t) => t.status === "failed" || t.status === "cancelled",
	).length;
	const groupedCount = patterns.reduce((sum, p) => sum + p.count, 0);
	const lines = [
		`Common failure patterns (${groupedCount} of ${failedCount} failures share ${patterns.length} root cause${patterns.length === 1 ? "" : "s"}):`,
	];
	for (const p of patterns) {
		const rep = p.representative.length > 100 ? `${p.representative.slice(0, 99)}…` : p.representative;
		lines.push(`- [×${p.count}] ${rep}`);
		const shown = p.taskIds.slice(0, 6);
		const more = p.taskIds.length > 6 ? `, +${p.taskIds.length - 6} more` : "";
		lines.push(`    tasks: ${shown.join(", ")}${more}`);
	}
	return lines;
}
