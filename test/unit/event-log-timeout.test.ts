import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { withEventLogLockSync } from "../../src/state/event-log.ts";

describe("event-log lock timeout is capped at 5s", () => {
	it("should throw after ~5s when lock is contended", () => {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "evlog-timeout-"));
		const eventsPath = path.join(tmpDir, "events.jsonl");
		const lockDir = `${eventsPath}.lock`;

		// Simulate an existing lock held by another (dead) process
		fs.mkdirSync(lockDir);
		// Write a PID that is alive (our own PID) so stale detection does NOT clean it
		fs.writeFileSync(path.join(lockDir, "pid"), String(process.pid), "utf-8");

		const start = Date.now();
		assert.throws(
			() => withEventLogLockSync(eventsPath, () => "unreachable"),
			/lock timeout/,
		);
		const elapsed = Date.now() - start;

		// Must not block for more than ~7s (5s timeout + some overhead)
		assert.ok(elapsed < 10_000, `Expected < 10s but took ${elapsed}ms`);
		// Must have waited at least ~4s (close to the 5s cap)
		assert.ok(elapsed >= 4000, `Expected >= 4s but took only ${elapsed}ms`);

		// Cleanup
		try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
	});

	it("should succeed when no lock contention", () => {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "evlog-nocontention-"));
		const eventsPath = path.join(tmpDir, "events.jsonl");

		const result = withEventLogLockSync(eventsPath, () => 42);
		assert.equal(result, 42);

		// Cleanup
		try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
	});
});
