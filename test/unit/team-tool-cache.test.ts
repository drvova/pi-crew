/**
 * Unit tests for team-tool cache-control.
 * @see src/extension/team-tool/cache-control.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { invalidateSnapshot, type CacheControlDeps } from "../../src/extension/team-tool/cache-control.ts";
import { runEventBus } from "../../src/ui/run-event-bus.ts";

// ─── invalidateSnapshot ───────────────────────────────────────────────────────

describe("invalidateSnapshot", () => {
	it("calls invalidate on the snapshot cache with the given runId", () => {
		const invalidatedIds: string[] = [];
		const deps: CacheControlDeps = {
			getRunSnapshotCache: (_cwd: string) => ({
				invalidate: (runId: string) => { invalidatedIds.push(runId); },
			} as never),
		};

		invalidateSnapshot("run-abc", "/some/cwd", deps);

		assert.deepStrictEqual(invalidatedIds, ["run-abc"]);
	});

	it("passes runCwd to getRunSnapshotCache", () => {
		let receivedCwd: string | undefined;
		const deps: CacheControlDeps = {
			getRunSnapshotCache: (cwd: string) => {
				receivedCwd = cwd;
				return { invalidate: () => {} } as never;
			},
		};

		invalidateSnapshot("run-123", "/project/root", deps);

		assert.strictEqual(receivedCwd, "/project/root");
	});

	it("emits runEventBus event for cache invalidation", () => {
		const emitted: Array<{ runId: string; type: string }> = [];
		const unsub = runEventBus.onAny((e) => {
			emitted.push(e as { runId: string; type: string });
		});

		try {
			const deps: CacheControlDeps = {
				getRunSnapshotCache: () => ({ invalidate: () => {} } as never),
			};

			invalidateSnapshot("run-bus-test", "/cwd", deps);

			const found = emitted.find(
				(e) => e.runId === "run-bus-test" && e.type === "run.cache_invalidated",
			);
			assert.ok(found, `Expected run.cache_invalidated event for run-bus-test. Got ${emitted.length} events: ${emitted.map((e) => `${e.type}:${e.runId}`).join(", ")}`);
		} finally {
			unsub();
		}
	});

	it("propagates errors from cache invalidate", () => {
		const deps: CacheControlDeps = {
			getRunSnapshotCache: () => ({
				invalidate: () => { throw new Error("cache error"); },
			} as never),
		};

		assert.throws(() => {
			invalidateSnapshot("run-err", "/cwd", deps);
		}, /cache error/);
	});

	it("calls invalidate exactly once per call", () => {
		let callCount = 0;
		const deps: CacheControlDeps = {
			getRunSnapshotCache: () => ({
				invalidate: () => { callCount++; },
			} as never),
		};

		invalidateSnapshot("run-once", "/cwd", deps);
		invalidateSnapshot("run-once", "/cwd", deps);

		assert.strictEqual(callCount, 2);
	});
});
