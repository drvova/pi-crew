/**
 * coalesce-tasks.ts — micro-task coalescing for scheduler batching (M6).
 *
 * Implements the workflow-level `coalesceMicroTasks` opt-in (plan §11
 * decision #7): default = false; when true, multiple ready tasks sharing
 * `role` and `cwd` are grouped into a single "coalesced task group" so the
 * scheduler dispatches ONE worker call instead of N. Trades individual task
 * observability for fewer cold-starts when many small tasks of the same kind
 * are queued simultaneously.
 *
 * Safety guards (per plan §5 M6):
 *   - Only groups tasks that share role + cwd (so the grouped worker can use
 *     a single worker prompt without per-task permission prompts).
 *   - Tasks that declare a non-false `output` are NEVER coalesced with
 *     another task that has the same write path (write-write conflict).
 *   - When the flag is off or the list is empty, returns the input list
 *     unchanged (no-op for production; zero overhead).
 *
 * Note: this module produces *group specifications* (arrays of tasks per
 * group). The actual worker prompt construction is left to the caller
 * (team-runner) — out of scope for v0.9.17 first ship.
 */

import type { TeamTaskState } from "../state/types.ts";
import type { WorkflowConfig, WorkflowStep } from "../workflows/workflow-config.ts";

export interface CoalescedGroup {
	/** Stable id derived from the group membership; deterministic for tests. */
	id: string;
	role: string;
	cwd: string;
	/** Tasks to be coalesced into one worker invocation, in input order. */
	tasks: TeamTaskState[];
}

/**
 * Group ready tasks by (role, cwd) while respecting write-path safety.
 *
 * Returns an array of `CoalescedGroup`. Each group contains tasks that:
 *   - share the same role and cwd
 *   - have NO write-path conflict with any other task in the group
 *
 * Singletons (groups with one task) are preserved — the caller can decide
 * whether to dispatch them as-is or skip the coalesce entirely.
 *
 * If `enabled` is false, returns `[]` (signal to the caller to skip
 * coalescing — use the original list).
 */
export function planCoalescedGroups(
	readyTaskIds: string[],
	tasks: TeamTaskState[],
	workflow: WorkflowConfig,
	enabled: boolean,
): CoalescedGroup[] {
	if (!enabled || readyTaskIds.length === 0) return [];
	const taskById = new Map<string, TeamTaskState>(tasks.map((task) => [task.id, task]));
	const stepById = new Map<string, WorkflowStep>(workflow.steps.map((step) => [step.id, step]));

	// Bucket: key = `${role}\0${cwd}` → task list preserving input order
	const buckets = new Map<string, TeamTaskState[]>();
	for (const taskId of readyTaskIds) {
		const task = taskById.get(taskId);
		if (!task || !task.stepId) continue;
		const step = stepById.get(task.stepId);
		if (!step) continue;
		const key = `${task.role}\0${task.cwd}`;
		const list = buckets.get(key);
		if (list) list.push(task);
		else buckets.set(key, [task]);
	}

	// Within each bucket, split further by write-path safety (groups of tasks
	// that all have distinct write outputs).
	const groups: CoalescedGroup[] = [];
	for (const [key, bucketTasks] of buckets) {
		const [role, cwd] = key.split("\0");
		const subgroups = splitByWriteSafety(bucketTasks, stepById);
		for (const subgroup of subgroups) {
			groups.push({
				id: subgroup.map((task) => task.id).join("+"),
				role,
				cwd,
				tasks: subgroup,
			});
		}
	}
	return groups;
}

/**
 * Split a bucket of tasks into write-safe subgroups: a subgroup may include
 * tasks only if no two of them have the same `step.output`.
 *
 * Greedy: first task always goes to current group; subsequent tasks join the
 * current group only if they don't conflict with any already-in-group member.
 * Otherwise, they start (and extend) the next subgroup.
 */
function splitByWriteSafety(bucketTasks: TeamTaskState[], stepById: Map<string, WorkflowStep>): TeamTaskState[][] {
	const result: TeamTaskState[][] = [];
	for (const task of bucketTasks) {
		const step = task.stepId ? stepById.get(task.stepId) : undefined;
		const writePath = step?.output;
		let placed = false;
		for (const group of result) {
			let conflict = false;
			for (const other of group) {
				const otherStep = other.stepId ? stepById.get(other.stepId) : undefined;
				if (typeof writePath === "string" && typeof otherStep?.output === "string" && writePath === otherStep.output) {
					conflict = true;
					break;
				}
			}
			if (!conflict) {
				group.push(task);
				placed = true;
				break;
			}
		}
		if (!placed) result.push([task]);
	}
	return result;
}

/**
 * Flatten a list of `CoalescedGroup` back into a flat task-id list (one entry
 * per group). For a group of N tasks, this returns N task IDs in order. When
 * M6 is enabled upstream, the caller can use this to count "effective ready
 * units" (groups vs raw tasks).
 */
export function flattenGroupIds(groups: CoalescedGroup[]): string[] {
	return groups.flatMap((group) => group.tasks.map((task) => task.id));
}
