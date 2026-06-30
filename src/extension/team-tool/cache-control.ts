import { runEventBus } from "../../ui/run-event-bus.ts";
import type { RunSnapshotCache } from "../../ui/run-snapshot-cache.ts";

export interface CacheControlDeps {
	getRunSnapshotCache: (cwd: string) => RunSnapshotCache;
}

/**
 * Invalidate the run snapshot cache for a specific runId and emit
 * a runEventBus event so the render scheduler coalescer fires immediately.
 * Call this after any state mutation that changes task/agent status.
 */
export function invalidateSnapshot(runId: string, runCwd: string, deps: CacheControlDeps): void {
	// 1. Invalidate snapshot cache entry
	deps.getRunSnapshotCache(runCwd).invalidate(runId);

	// 2. Emit runEventBus event so renderScheduler coalescer fires
	runEventBus.emit({ runId, type: "run.cache_invalidated" });
}
