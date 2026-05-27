/**
 * Hook-to-instinct bridge - connects crewHooks events to instinct formation.
 * Auto-initializes when imported.
 */

import { crewHooks } from "../runtime/crew-hooks.ts";

// Lazy-initialized store and paths
let storeInstance: import("./instinct-store").InstinctStore | null = null;
let pathsInstance: typeof import("../utils/paths") | null = null;

async function getStore() {
	if (!storeInstance) {
		const { InstinctStore } = await import("./instinct-store");
		const paths = await import("../utils/paths");
		storeInstance = new InstinctStore(paths.projectCrewRoot(process.cwd()));
	}
	return storeInstance;
}

async function getPaths() {
	if (!pathsInstance) {
		pathsInstance = await import("../utils/paths");
	}
	return pathsInstance;
}

// Subscribe to events
crewHooks.register("task_completed", async (event) => {
	try {
		const store = await getStore();
		if (event.data?.role) {
			store.saveInstinct({
				trigger: `role:${event.data.role}`,
				action: "prefer",
				confidence: 0.6,
				scope: "global",
				evidence: [`task:${event.taskId} completed`],
			});
		}
	} catch {
		// Best-effort - don't crash on instinct formation failures
	}
});

crewHooks.register("task_failed", async (event) => {
	try {
		const store = await getStore();
		if (event.data?.role) {
			store.saveInstinct({
				trigger: `role:${event.data.role}`,
				action: "avoid",
				confidence: 0.3,
				scope: "global",
				evidence: [`task:${event.taskId} failed`],
			});
		}
	} catch {
		// Best-effort
	}
});

crewHooks.register("run_completed", async (event) => {
	try {
		const store = await getStore();
		if (event.data?.taskCount) {
			store.saveInstinct({
				trigger: "run_completed",
				action: `completed:${event.data.taskCount}tasks`,
				confidence: 0.6,
				scope: "global",
				evidence: [`run:${event.runId}`],
			});
		}
	} catch {
		// Best-effort
	}
});

/**
 * Get instinct-based recommendations.
 */
export async function getInstinctRecommendations() {
	try {
		const store = await getStore();
		return store.getInstincts().filter((i: { confidence: number }) => i.confidence >= 0.6);
	} catch {
		return [];
	}
}