import * as fs from "node:fs";
import * as path from "node:path";
import { loadRunManifestById } from "../state/state-store.ts";
import { closeWatcher, watchWithErrorHandler } from "../utils/fs-watch.ts";
import type { TeamRunManifest, TeamTaskState } from "../state/types.ts";
import { projectCrewRoot } from "../utils/paths.ts";
import { isFinishedRunStatus } from "./process-status.ts";

export interface ActiveRunPromise {
	promise: Promise<{ manifest: TeamRunManifest; tasks: TeamTaskState[] }>;
	resolve: (value: { manifest: TeamRunManifest; tasks: TeamTaskState[] }) => void;
	reject: (reason: unknown) => void;
}

const activeRunPromises = new Map<string, ActiveRunPromise>();

export function registerRunPromise(runId: string): ActiveRunPromise {
	let resolve!: (value: { manifest: TeamRunManifest; tasks: TeamTaskState[] }) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<{
		manifest: TeamRunManifest;
		tasks: TeamTaskState[];
	}>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	const entry: ActiveRunPromise = { promise, resolve, reject };
	activeRunPromises.set(runId, entry);
	return entry;
}

export function resolveRunPromise(runId: string, result: { manifest: TeamRunManifest; tasks: TeamTaskState[] }): void {
	const entry = activeRunPromises.get(runId);
	if (entry) {
		entry.resolve(result);
		activeRunPromises.delete(runId);
	}
}

export function rejectRunPromise(runId: string, reason: unknown): void {
	const entry = activeRunPromises.get(runId);
	if (entry) {
		entry.reject(reason);
		activeRunPromises.delete(runId);
	}
}

/**
 * Wait for a team run to reach a terminal status.
 * - If the run is already finished on disk, returns immediately.
 * - If a foreground promise is registered for this runId, awaits it.
 * - Otherwise falls back to lightweight fs.watchFile-based waiting.
 */
export async function waitForRun(
	runId: string,
	cwd: string,
	options: { timeoutMs?: number; pollIntervalMs?: number } = {},
): Promise<{ manifest: TeamRunManifest; tasks: TeamTaskState[] }> {
	const { timeoutMs = 300_000, pollIntervalMs = 500 } = options;
	const deadline = Date.now() + timeoutMs;

	// Fast path: already terminal on disk
	const loaded = loadRunManifestById(cwd, runId); // NOTE: no withRunLock - best-effort only; concurrent writes may cause inconsistency;
	if (loaded && isFinishedRunStatus(loaded.manifest.status)) {
		return loaded;
	}

	// Medium path: foreground promise registered in this process
	const entry = activeRunPromises.get(runId);
	if (entry) {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const timeoutPromise = new Promise<never>((_, reject) => {
			timer = setTimeout(() => reject(new Error(`waitForRun timed out after ${timeoutMs}ms`)), timeoutMs);
		});
		try {
			return await Promise.race([entry.promise, timeoutPromise]);
		} finally {
			if (timer) clearTimeout(timer);
		}
	}

	// Slow path: background run — poll with exponential backoff capped at pollIntervalMs
	let attempt = 0;
	while (Date.now() < deadline) {
		if (attempt === 0) {
			// Early exit: if the run directory doesn't exist, don't waste time polling.
			// Use projectCrewRoot() to honour the .pi/teams/ fallback for .pi-based
			// projects (see issue #29). Without this, the hardcoded `.crew/state/runs/`
			// path never resolves in projects that use the `.pi/` layout, the throw
			// escapes via subagent-manager.ts:281, and pi crashes with uncaughtException.
			const runDir = path.join(projectCrewRoot(cwd), "state", "runs", runId);
			if (!fs.existsSync(runDir)) {
				throw new Error(`Run ${runId} not found. No run directory at ${runDir}`);
			}
		}
		const fresh = loadRunManifestById(cwd, runId); // NOTE: no withRunLock - best-effort only; concurrent writes may cause inconsistency;
		if (fresh && isFinishedRunStatus(fresh.manifest.status)) {
			return fresh;
		}
		const delay = Math.min(pollIntervalMs, 50 * 2 ** Math.min(attempt, 6)); // max ~3.2s
		await sleepUntilRunChange(cwd, runId, delay);
		attempt++;
	}

	throw new Error(`waitForRun timed out after ${timeoutMs}ms`);
}

/**
 * Sleep until the run's state directory changes or `maxMs` elapses,
 * whichever comes first.
 *
 * Manifest/task-state updates are atomic renames INTO the run directory, so a
 * non-recursive `fs.watch` on that directory observes every status transition.
 * The watcher is purely an accelerator: callers re-read the manifest after
 * every wake, and when `fs.watch` is unavailable (or the dir does not exist
 * yet) this degrades to a plain `setTimeout(maxMs)` — exactly the old poll.
 *
 * Spurious wakes (task-state or event writes in the same dir) only cause an
 * earlier re-check by the caller's loop; correctness is unaffected.
 */
export function sleepUntilRunChange(cwd: string, runId: string, maxMs: number): Promise<void> {
	return new Promise((resolve) => {
		const runDir = path.join(projectCrewRoot(cwd), "state", "runs", runId);
		let settled = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let watcher: ReturnType<typeof watchWithErrorHandler> = null;
		const done = (): void => {
			if (settled) return;
			settled = true;
			if (timer) clearTimeout(timer);
			closeWatcher(watcher);
			resolve();
		};
		timer = setTimeout(done, maxMs);
		// Watch failure (dir missing, inotify exhausted, error mid-wait) must NOT
		// wake early — that would hot-spin the caller's loop. The timer alone
		// completes the sleep, reproducing the legacy poll cadence exactly.
		watcher = watchWithErrorHandler(runDir, done, () => closeWatcher(watcher));
	});
}

export function hasActiveRunPromise(runId: string): boolean {
	return activeRunPromises.has(runId);
}

export function clearRunPromisesForTest(): void {
	for (const entry of activeRunPromises.values()) {
		entry.reject(new Error("Cleared by test"));
	}
	activeRunPromises.clear();
}
