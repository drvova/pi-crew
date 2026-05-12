import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { createRunManifest } from "../../src/state/state-store.ts";
import { withRunLock, withRunLockSync } from "../../src/state/locks.ts";

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

test("withRunLock async throws immediately on active (non-stale) lock", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-lock-active-async-"));
	fs.mkdirSync(path.join(cwd, ".crew"), { recursive: true });
	const { manifest } = createRunManifest({
		cwd,
		team: { name: "active-team", description: "active", source: "builtin", filePath: "", roles: [{ name: "explorer", agent: "explorer" }] },
		workflow: { name: "active", description: "", source: "builtin", filePath: "", steps: [] },
		goal: "active",
	});

	// Hold the lock by writing a recent lock file
	const lockFile = path.join(cwd, ".crew", "state", "runs", manifest.runId, "run.lock");
	fs.mkdirSync(path.dirname(lockFile), { recursive: true });
	fs.writeFileSync(lockFile, String(Date.now()), "utf-8");

	await assert.rejects(() => withRunLock(manifest, async () => "should-not-reach"), /locked/);

	fs.rmSync(cwd, { recursive: true, force: true });
});

test("withRunLock serializes calls when first releases before second attempts", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-lock-seq-"));
	fs.mkdirSync(path.join(cwd, ".crew"), { recursive: true });
	const { manifest } = createRunManifest({
		cwd,
		team: { name: "seq-team", description: "seq", source: "builtin", filePath: "", roles: [{ name: "explorer", agent: "explorer" }] },
		workflow: { name: "seq", description: "", source: "builtin", filePath: "", steps: [] },
		goal: "seq",
	});

	const order: string[] = [];
	const run1 = await withRunLock(manifest, async () => {
		order.push("run-1-enter");
		await sleep(50);
		order.push("run-1-exit");
	});
	// run1 finished, lock released
	const run2 = await withRunLock(manifest, async () => {
		order.push("run-2-enter");
		order.push("run-2-exit");
	});

	assert.equal(order[0], "run-1-enter");
	assert.equal(order[1], "run-1-exit");
	assert.equal(order[2], "run-2-enter");
	assert.equal(order[3], "run-2-exit");

	fs.rmSync(cwd, { recursive: true, force: true });
});

test("withRunLockSync and withRunLock both recover from a stale lock", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-lock-stale-"));
	fs.mkdirSync(path.join(cwd, ".crew"), { recursive: true });
	const { manifest } = createRunManifest({
		cwd,
		team: { name: "stale-team", description: "stale", source: "builtin", filePath: "", roles: [{ name: "explorer", agent: "explorer" }] },
		workflow: { name: "stale", description: "", source: "builtin", filePath: "", steps: [] },
		goal: "stale",
	});

	// Simulate a stale lock by writing an old lock file
	const lockFile = path.join(cwd, ".crew", "state", "runs", manifest.runId, "run.lock");
	fs.mkdirSync(path.dirname(lockFile), { recursive: true });
	fs.writeFileSync(lockFile, JSON.stringify({ pid: 99999, createdAt: new Date(Date.now() - 100_000).toISOString() }), "utf-8");

	// Sync should succeed by removing the stale lock
	const syncResult = withRunLockSync(manifest, () => "sync-ok");
	assert.equal(syncResult, "sync-ok");

	// Recreate stale lock for async test
	fs.writeFileSync(lockFile, JSON.stringify({ pid: 99999, createdAt: new Date(Date.now() - 100_000).toISOString() }), "utf-8");
	const asyncResult = await withRunLock(manifest, async () => "async-ok");
	assert.equal(asyncResult, "async-ok");

	fs.rmSync(cwd, { recursive: true, force: true });
});

test("withRunLockSync throws immediately on active (non-stale) lock", async () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-lock-active-"));
	fs.mkdirSync(path.join(cwd, ".crew"), { recursive: true });
	const { manifest } = createRunManifest({
		cwd,
		team: { name: "active-team", description: "active", source: "builtin", filePath: "", roles: [{ name: "explorer", agent: "explorer" }] },
		workflow: { name: "active", description: "", source: "builtin", filePath: "", steps: [] },
		goal: "active",
	});

	// Hold the lock in another process context by writing a recent lock file
	const lockFile = path.join(cwd, ".crew", "state", "runs", manifest.runId, "run.lock");
	fs.mkdirSync(path.dirname(lockFile), { recursive: true });
	fs.writeFileSync(lockFile, String(Date.now()), "utf-8");

	assert.throws(() => withRunLockSync(manifest, () => "should-not-reach"), /locked/);

	fs.rmSync(cwd, { recursive: true, force: true });
});
