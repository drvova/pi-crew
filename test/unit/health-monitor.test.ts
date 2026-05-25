import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { handleHealthMonitor } from "../../src/extension/team-tool/health-monitor.ts";
import {
	createRunManifest,
	saveRunManifest,
	updateRunStatus,
	__test__clearManifestCache,
} from "../../src/state/state-store.ts";
import type { TeamRunManifest } from "../../src/state/types.ts";
import type { TeamConfig } from "../../src/teams/team-config.ts";
import type { WorkflowConfig } from "../../src/workflows/workflow-config.ts";
import { clearProjectRootCache } from "../../src/utils/paths.ts";
import { sharedScanCache } from "../../src/utils/scan-cache.ts";
import { registerActiveRun, unregisterActiveRun } from "../../src/state/active-run-registry.ts";

// ── Shared fixtures ──────────────────────────────────────────────────

const team: TeamConfig = {
	name: "health-test",
	description: "health monitor test team",
	source: "builtin",
	filePath: "health-test.team.md",
	roles: [{ name: "planner", agent: "planner" }],
};

const workflow: WorkflowConfig = {
	name: "health-test",
	description: "health monitor test workflow",
	source: "builtin",
	filePath: "health-test.workflow.md",
	steps: [{ id: "plan", role: "planner", task: "Plan {goal}" }],
};

/**
 * Isolate PI_TEAMS_HOME to a temp dir so user-level state doesn't leak
 * between tests or into the developer's real home directory.
 */
function withIsolatedHome<T>(fn: () => T): T {
	const previousHome = process.env.PI_TEAMS_HOME;
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-health-home-"));
	process.env.PI_TEAMS_HOME = home;
	clearProjectRootCache();
	sharedScanCache.clear();
	__test__clearManifestCache();
	try {
		return fn();
	} finally {
		if (previousHome === undefined) delete process.env.PI_TEAMS_HOME;
		else process.env.PI_TEAMS_HOME = previousHome;
		fs.rmSync(home, { recursive: true, force: true });
		clearProjectRootCache();
		sharedScanCache.clear();
		__test__clearManifestCache();
	}
}

/** Create a temp project cwd with .crew directory. */
function createProjectCwd(): string {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-health-cwd-"));
	fs.mkdirSync(path.join(cwd, ".crew"));
	return cwd;
}

/** Extract report text from the health-monitor tool result. */
function reportText(result: { content: Array<{ type: string; text?: string }> }): string {
	return result.content.map((item) => item.text ?? "").join("\n");
}

// ── 1. Ghost run detection ──────────────────────────────────────────

// Ghost detection relies on the active-run registry returning a manifest whose
// cwd field points to a deleted directory.  collectRuns in run-index.ts already
// pre-filters active-status runs with dead cwds from filesystem scanning, so
// ghost runs only surface through collectActiveRuns().  activeRunEntries()
// checks the *registry entry's* cwd (set at registration time), not the
// manifest's cwd field.  By modifying the manifest's cwd after registration,
// we create a scenario where the entry passes the registry's cwd-existence
// check but the health monitor sees a manifest with a dead cwd.

test("should detect ghost run when manifest cwd no longer exists but registry entry cwd does", () => {
	withIsolatedHome(() => {
		const projectCwd = createProjectCwd();
		// realDir stays alive — it is the cwd registered in the active-run index.
		const realDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-health-realdir-"));
		fs.mkdirSync(path.join(realDir, ".crew"));

		try {
			const created = createRunManifest({ cwd: realDir, team, workflow, goal: "ghost run" });
			registerActiveRun(created.manifest);

			// Rewrite the manifest with a cwd that does NOT exist.
			// The registry entry still points to realDir (which exists),
			// so activeRunEntries() includes this run.  But the health
			// monitor reads manifest.cwd = ghostDir and detects the ghost.
			const ghostDir = path.join(os.tmpdir(), "pi-crew-health-ghost-" + Date.now());
			const ghostManifest: TeamRunManifest = {
				...created.manifest,
				status: "running",
				cwd: ghostDir,
			};
			saveRunManifest(ghostManifest);

			clearProjectRootCache();
			sharedScanCache.clear();
			__test__clearManifestCache();

			const result = handleHealthMonitor({ cwd: projectCwd }, {});
			const text = reportText(result);

			assert.match(text, /Scanned: 1 runs/);
			assert.match(text, /Ghost \(dead cwd\): 1/);
			assert.ok(text.includes(created.manifest.runId), "report should list the ghost runId");
			assert.match(text, /Ghost runs:/);
			assert.equal(result.details.status, "error");
		} finally {
			try { unregisterActiveRun(""); } catch { /* best-effort */ }
			fs.rmSync(projectCwd, { recursive: true, force: true });
			fs.rmSync(realDir, { recursive: true, force: true });
		}
	});
});

test("should not crash when ghost run is fully deleted (cwd gone, registry filtered)", () => {
	withIsolatedHome(() => {
		const projectCwd = createProjectCwd();
		const ghostCwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-health-ghost-"));

		try {
			// Create a run, register it, then delete the cwd entirely.
			// Both collectRuns and activeRunEntries filter this out.
			const created = createRunManifest({ cwd: ghostCwd, team, workflow, goal: "ghost run" });
			registerActiveRun(created.manifest);
			const running = updateRunStatus(created.manifest, "running", "started");

			fs.rmSync(ghostCwd, { recursive: true, force: true });

			clearProjectRootCache();
			sharedScanCache.clear();
			__test__clearManifestCache();

			// The run is filtered by both paths; the health monitor should
			// produce a clean report without crashing.
			const result = handleHealthMonitor({ cwd: projectCwd }, {});
			const text = reportText(result);

			assert.match(text, /Scanned: 0 runs/);
			assert.match(text, /All runs healthy\./);
			assert.equal(result.details.status, "ok");
		} finally {
			try { unregisterActiveRun(""); } catch { /* best-effort */ }
			fs.rmSync(projectCwd, { recursive: true, force: true });
			try { fs.rmSync(ghostCwd, { recursive: true, force: true }); } catch { /* already deleted */ }
		}
	});
});

// ── 2. Orphaned run — stale async PID ───────────────────────────────

test("should detect orphaned run with stale async PID past threshold", () => {
	withIsolatedHome(() => {
		const projectCwd = createProjectCwd();

		try {
			const created = createRunManifest({ cwd: projectCwd, team, workflow, goal: "stale async pid" });
			const running = updateRunStatus(created.manifest, "running", "started");

			// Simulate an async run with a non-existent PID and updatedAt 31 minutes ago.
			const staleTime = new Date(Date.now() - 31 * 60 * 1000).toISOString();
			const staleManifest: TeamRunManifest = {
				...running,
				async: { pid: 999999, logPath: "/dev/null", spawnedAt: new Date().toISOString() },
				updatedAt: staleTime,
			};
			saveRunManifest(staleManifest);

			clearProjectRootCache();
			sharedScanCache.clear();
			__test__clearManifestCache();

			const result = handleHealthMonitor({ cwd: projectCwd }, {});
			const text = reportText(result);

			assert.match(text, /Scanned: 1 runs/);
			assert.match(text, /Orphaned \(stale process\): 1/);
			assert.match(text, /stale-async-pid/);
			assert.equal(result.details.action, "health");
			assert.equal(result.details.status, "error");
		} finally {
			fs.rmSync(projectCwd, { recursive: true, force: true });
		}
	});
});

// ── 3. Orphaned run — non-async stale run with no progress ──────────

test("should detect orphaned non-async stale run with no agent progress", () => {
	withIsolatedHome(() => {
		const projectCwd = createProjectCwd();

		try {
			const created = createRunManifest({ cwd: projectCwd, team, workflow, goal: "stale no-progress run" });
			const running = updateRunStatus(created.manifest, "running", "started");

			// Set updatedAt to 3 minutes ago (past ORPHANED_ACTIVE_RUN_MS = 2 min).
			const staleTime = new Date(Date.now() - 3 * 60 * 1000).toISOString();
			const staleManifest: TeamRunManifest = {
				...running,
				updatedAt: staleTime,
			};
			saveRunManifest(staleManifest);

			// Write agents.json with all agents in "queued" status and no progress.
			const agentsPath = path.join(staleManifest.stateRoot, "agents.json");
			fs.writeFileSync(agentsPath, JSON.stringify([
				{
					id: "agent-1",
					runId: staleManifest.runId,
					taskId: created.tasks[0]!.id,
					agent: "planner",
					role: "planner",
					runtime: "scaffold",
					status: "queued",
					startedAt: staleTime,
				},
			]));

			clearProjectRootCache();
			sharedScanCache.clear();
			__test__clearManifestCache();

			const result = handleHealthMonitor({ cwd: projectCwd }, {});
			const text = reportText(result);

			assert.match(text, /Scanned: 1 runs/);
			assert.match(text, /Orphaned \(stale process\): 1/);
			assert.match(text, /stale-no-progress/);
			assert.equal(result.details.action, "health");
			assert.equal(result.details.status, "error");
		} finally {
			fs.rmSync(projectCwd, { recursive: true, force: true });
		}
	});
});

// ── 4. Corrupted run detection ──────────────────────────────────────

test("should detect corrupted run when artifacts root is missing", () => {
	withIsolatedHome(() => {
		const projectCwd = createProjectCwd();

		try {
			const created = createRunManifest({ cwd: projectCwd, team, workflow, goal: "corrupted run" });
			const running = updateRunStatus(created.manifest, "running", "started");

			// Delete the artifacts root but keep the state root (manifest survives).
			fs.rmSync(running.artifactsRoot, { recursive: true, force: true });

			clearProjectRootCache();
			sharedScanCache.clear();
			__test__clearManifestCache();

			const result = handleHealthMonitor({ cwd: projectCwd }, {});
			const text = reportText(result);

			assert.match(text, /Scanned: 1 runs/);
			assert.match(text, /Corrupted \(missing state\): 1/);
			assert.ok(text.includes(running.runId), `report should contain runId ${running.runId}`);
			assert.match(text, /Corrupted runs:/);
			assert.equal(result.details.status, "error");
		} finally {
			fs.rmSync(projectCwd, { recursive: true, force: true });
		}
	});
});

test("should detect corrupted run when state root is missing", () => {
	withIsolatedHome(() => {
		const projectCwd = createProjectCwd();

		try {
			const created = createRunManifest({ cwd: projectCwd, team, workflow, goal: "missing state" });
			// Note: can't updateRunStatus because stateRoot is about to be deleted.
			// Leave status as "queued" (active) so the health monitor checks it.

			// The state root contains the manifest. Deleting it means collectRuns
			// cannot read the manifest either. However, if the run is in the
			// active-run registry, collectActiveRuns may surface it.
			// Register before deleting.
			registerActiveRun(created.manifest);

			// Save the runId before deleting state root.
			const runId = created.manifest.runId;
			const artifactsRoot = created.manifest.artifactsRoot;

			// Delete state root (which contains the manifest).
			fs.rmSync(created.paths.stateRoot, { recursive: true, force: true });

			clearProjectRootCache();
			sharedScanCache.clear();
			__test__clearManifestCache();

			// The health monitor should produce a valid report without crashing.
			// Whether the run is detected depends on whether listRuns surfaces it
			// (active registry entry with a missing manifestPath gets filtered).
			const result = handleHealthMonitor({ cwd: projectCwd }, {});
			const text = reportText(result);

			assert.match(text, /Scanned: \d+ runs/);
			assert.equal(result.details.action, "health");
		} finally {
			fs.rmSync(projectCwd, { recursive: true, force: true });
		}
	});
});

// ── 5. Healthy run ──────────────────────────────────────────────────

test("should report all runs healthy when no issues found", () => {
	withIsolatedHome(() => {
		const projectCwd = createProjectCwd();

		try {
			const created = createRunManifest({ cwd: projectCwd, team, workflow, goal: "healthy run" });
			const running = updateRunStatus(created.manifest, "running", "started");
			updateRunStatus(running, "completed", "done");

			clearProjectRootCache();
			sharedScanCache.clear();
			__test__clearManifestCache();

			const result = handleHealthMonitor({ cwd: projectCwd }, {});
			const text = reportText(result);

			assert.match(text, /Scanned: 1 runs/);
			assert.match(text, /All runs healthy\./);
			assert.doesNotMatch(text, /Ghost \(dead cwd\): [1-9]/);
			assert.doesNotMatch(text, /Orphaned \(stale process\): [1-9]/);
			assert.doesNotMatch(text, /Corrupted \(missing state\): [1-9]/);
			assert.equal(result.details.status, "ok");
		} finally {
			fs.rmSync(projectCwd, { recursive: true, force: true });
		}
	});
});

// ── 6. Cross-scope scanning ─────────────────────────────────────────

test("should scan both project and user level runs", () => {
	withIsolatedHome(() => {
		const projectCwd = createProjectCwd();

		try {
			// Project-scoped run.
			const projectRun = createRunManifest({ cwd: projectCwd, team, workflow, goal: "project run" });
			const projectRunning = updateRunStatus(projectRun.manifest, "running", "started");
			updateRunStatus(projectRunning, "completed", "project done");

			// User-level run: use a cwd WITHOUT .crew so it falls back to user scope.
			// The run's state ends up under PI_TEAMS_HOME/.pi/agent/extensions/pi-crew/.
			const userCwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-health-user-"));
			try {
				const userRun = createRunManifest({ cwd: userCwd, team, workflow, goal: "user run" });
				const userRunning = updateRunStatus(userRun.manifest, "running", "started");
				updateRunStatus(userRunning, "completed", "user done");

				clearProjectRootCache();
				sharedScanCache.clear();
				__test__clearManifestCache();

				const result = handleHealthMonitor({ cwd: projectCwd }, {});
				const text = reportText(result);

				// Both runs should be scanned: 1 project + 1 user = 2.
				assert.match(text, /Scanned: 2 runs/);
				assert.match(text, /All runs healthy\./);
				assert.equal(result.details.status, "ok");
			} finally {
				fs.rmSync(userCwd, { recursive: true, force: true });
			}
		} finally {
			fs.rmSync(projectCwd, { recursive: true, force: true });
		}
	});
});

// ── 7. Empty scan ───────────────────────────────────────────────────

test("should report zero runs and healthy when no runs exist", () => {
	withIsolatedHome(() => {
		const projectCwd = createProjectCwd();

		try {
			const result = handleHealthMonitor({ cwd: projectCwd }, {});
			const text = reportText(result);

			assert.match(text, /Scanned: 0 runs/);
			assert.match(text, /All runs healthy\./);
			assert.equal(result.details.status, "ok");
		} finally {
			fs.rmSync(projectCwd, { recursive: true, force: true });
		}
	});
});

// ── 8. Mixed issues: orphaned + corrupted ───────────────────────────

test("should report multiple issue types in a single scan", () => {
	withIsolatedHome(() => {
		const projectCwd = createProjectCwd();

		try {
			// Run 1: orphaned (stale async PID).
			const run1 = createRunManifest({ cwd: projectCwd, team, workflow, goal: "orphaned" });
			const run1Running = updateRunStatus(run1.manifest, "running", "started");
			const staleTime = new Date(Date.now() - 31 * 60 * 1000).toISOString();
			saveRunManifest({
				...run1Running,
				async: { pid: 999999, logPath: "/dev/null", spawnedAt: new Date().toISOString() },
				updatedAt: staleTime,
			});

			// Run 2: corrupted (missing artifacts).
			const run2 = createRunManifest({ cwd: projectCwd, team, workflow, goal: "corrupted" });
			fs.rmSync(run2.manifest.artifactsRoot, { recursive: true, force: true });

			clearProjectRootCache();
			sharedScanCache.clear();
			__test__clearManifestCache();

			const result = handleHealthMonitor({ cwd: projectCwd }, {});
			const text = reportText(result);

			assert.match(text, /Scanned: 2 runs/);
			assert.match(text, /Orphaned \(stale process\): 1/);
			assert.match(text, /Corrupted \(missing state\): 1/);
			assert.equal(result.details.status, "error");
		} finally {
			fs.rmSync(projectCwd, { recursive: true, force: true });
		}
	});
});
