import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { prepareTaskWorkspace, findGitRoot, assertCleanLeader } from "../../src/worktree/worktree-manager.ts";
import type { TeamRunManifest, TeamTaskState } from "../../src/state/types.ts";

function initGitRepo(dir: string) {
	execFileSync("git", ["init", "-q", "--initial-branch=main"], { cwd: dir });
	fs.writeFileSync(path.join(dir, ".gitignore"), ".crew\n", "utf-8");
	execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "add", ".gitignore"], { cwd: dir });
	execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "init"], { cwd: dir });
}

function minimalManifest(cwd: string, runId: string): TeamRunManifest {
	return {
		schemaVersion: 1,
		runId,
		team: "test-team",
		workflow: "test-workflow",
		goal: "test",
		status: "running",
		workspaceMode: "worktree",
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		cwd,
		stateRoot: path.join(cwd, ".crew", "state", "runs", runId),
		artifactsRoot: path.join(cwd, ".crew", "artifacts", runId),
		tasksPath: "tasks.json",
		eventsPath: "events.jsonl",
		artifacts: [],
	};
}

function minimalTask(id: string, cwd: string): TeamTaskState {
	return {
		id,
		agent: "explorer",
		status: "waiting",
		role: "explorer",
		title: "Test task",
		dependsOn: [],
		cwd,
		runId: "run_test",
	};
}

test("prepareTaskWorkspace recovers when branch exists but worktree dir is gone", () => {
	const repo = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-wt-"));
	initGitRepo(repo);
	// Pre-create the branch (simulating leftover from crashed run)
	execFileSync("git", ["branch", "pi-crew/run1/task1"], { cwd: repo });
	const manifest = minimalManifest(repo, "run1");
	const task = minimalTask("task1", repo);
	const result = prepareTaskWorkspace(manifest, task);
	assert.ok(result.worktreePath);
	assert.equal(result.branch, "pi-crew/run1/task1");
	// Cleanup
	fs.rmSync(repo, { recursive: true, force: true });
});

test("prepareTaskWorkspace reuses existing valid worktree", () => {
	const repo = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-wt-"));
	initGitRepo(repo);
	const manifest = minimalManifest(repo, "run2");
	const task = minimalTask("task2", repo);
	const first = prepareTaskWorkspace(manifest, task);
	assert.ok(first.worktreePath);
	assert.equal(first.reused, false);
	const second = prepareTaskWorkspace(manifest, task);
	assert.equal(second.reused, true);
	assert.equal(second.worktreePath, first.worktreePath);
	// Cleanup
	fs.rmSync(repo, { recursive: true, force: true });
});

test("prepareTaskWorkspace skips linkNodeModules when source is a file", () => {
	const repo = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-wt-fn-"));
	initGitRepo(repo);
	// Place a FILE at node_modules instead of a directory, then commit it so repo is clean
	fs.writeFileSync(path.join(repo, "node_modules"), "not a dir", "utf-8");
	execFileSync("git", ["add", "node_modules"], { cwd: repo });
	execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "add nm"], { cwd: repo });
	// Write project config to enable linkNodeModules
	const cfgDir = path.join(repo, ".crew");
	fs.mkdirSync(cfgDir, { recursive: true });
	fs.writeFileSync(path.join(cfgDir, "config.json"), JSON.stringify({
		worktree: { linkNodeModules: true },
	}), "utf-8");
	const manifest = minimalManifest(repo, "run-fn");
	const task = minimalTask("task-fn", repo);
	const result = prepareTaskWorkspace(manifest, task);
	assert.equal(result.nodeModulesLinked, false);
	fs.rmSync(repo, { recursive: true, force: true });
});

test("assertCleanLeader throws when repo has uncommitted changes", () => {
	const repo = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-wt-"));
	initGitRepo(repo);
	fs.writeFileSync(path.join(repo, "dirty.txt"), "x", "utf-8");
	assert.throws(() => assertCleanLeader(repo), /clean leader/);
	// Cleanup
	fs.rmSync(repo, { recursive: true, force: true });
});
