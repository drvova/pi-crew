/**
 * Hook integrations - subscribes to crewHooks and provides observability.
 * Auto-initializes when imported.
 */

import { crewHooks } from "../runtime/crew-hooks.ts";

// Statistics
let tasksCompleted = 0;
let tasksFailed = 0;
let runsCompleted = 0;
let runsFailed = 0;

// Subscribe to events (fire-and-forget)
crewHooks.register("task_completed", () => {
	tasksCompleted++;
});

crewHooks.register("task_failed", () => {
	tasksFailed++;
});

crewHooks.register("run_completed", () => {
	runsCompleted++;
});

crewHooks.register("run_failed", () => {
	runsFailed++;
});

/**
 * Get current hook statistics.
 */
export function getHookStats(): {
	tasksCompleted: number;
	tasksFailed: number;
	runsCompleted: number;
	runsFailed: number;
} {
	return { tasksCompleted, tasksFailed, runsCompleted, runsFailed };
}

/**
 * Reset statistics (useful for testing).
 */
export function resetHookStats(): void {
	tasksCompleted = 0;
	tasksFailed = 0;
	runsCompleted = 0;
	runsFailed = 0;
}
