import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
	suggestRunIds,
	suggestTeams,
	suggestWorkflows,
	suggestAgents,
	suggestTaskIds,
} from "../../src/extension/command-completions.ts";
import { createRunManifest } from "../../src/state/state-store.ts";
import type { TeamConfig } from "../../src/teams/team-config.ts";
import type { WorkflowConfig } from "../../src/workflows/workflow-config.ts";

const realTmp = fs.realpathSync(os.tmpdir());

const team: TeamConfig = { name: "test-team", description: "test team", source: "builtin", filePath: "test.team.md", roles: [{ name: "explorer", agent: "explorer" }] };
const workflow: WorkflowConfig = { name: "test-wf", description: "test workflow", source: "builtin", filePath: "test.workflow.md", steps: [{ id: "explore", role: "explorer", task: "Explore" }] };

let tmpCwd: string;
let previousHome: string | undefined;

function beforeEachFn() {
	tmpCwd = fs.mkdtempSync(path.join(realTmp, "pi-crew-completions-"));
	// Isolate the home dir so user-config team discovery doesn't leak in.
	previousHome = process.env.PI_TEAMS_HOME;
	const home = fs.mkdtempSync(path.join(realTmp, "pi-crew-comp-home-"));
	fs.mkdirSync(path.join(home, ".pi", "agent"), { recursive: true });
	process.env.PI_TEAMS_HOME = home;
	process.chdir(tmpCwd);
}

function afterEachFn() {
	if (previousHome === undefined) delete process.env.PI_TEAMS_HOME;
	else process.env.PI_TEAMS_HOME = previousHome;
	try { fs.rmSync(tmpCwd, { recursive: true, force: true }); } catch { /* ignore */ }
}

describe("suggestRunIds", () => {
	beforeEach(beforeEachFn);
	afterEach(afterEachFn);

	it("returns null when no runs exist", () => {
		assert.equal(suggestRunIds(""), null);
		assert.equal(suggestRunIds("team_"), null);
	});

	it("suggests run IDs for created runs", () => {
		const created = createRunManifest({ cwd: tmpCwd, team, workflow, goal: "test goal" });
		const result = suggestRunIds("");
		assert.ok(result, "expected run-id suggestions");
		const match = result.find((item) => item.value === created.manifest.runId);
		assert.ok(match, "created run should appear in suggestions");
		assert.ok(match.description);
	});

	it("filters by prefix", () => {
		const created = createRunManifest({ cwd: tmpCwd, team, workflow, goal: "filterable" });
		// Correct prefix → matches
		assert.ok(suggestRunIds(created.manifest.runId.slice(0, 10)));
		// Wrong prefix → no matches → null
		assert.equal(suggestRunIds("nonexistent_prefix_xyz"), null);
	});
});

describe("suggestTeams / suggestWorkflows / suggestAgents", () => {
	beforeEach(beforeEachFn);
	afterEach(afterEachFn);

	it("suggestTeams returns null or valid items without throwing", () => {
		const result = suggestTeams("");
		if (result) for (const item of result) assert.ok(item.value.length > 0);
	});

	it("suggestWorkflows returns null or valid items without throwing", () => {
		const result = suggestWorkflows("");
		if (result) for (const item of result) assert.ok(item.value.length > 0);
	});

	it("suggestAgents returns null or valid items without throwing", () => {
		const result = suggestAgents("");
		if (result) for (const item of result) assert.ok(item.value.length > 0);
	});
});

describe("suggestTaskIds", () => {
	beforeEach(beforeEachFn);
	afterEach(afterEachFn);

	it("returns null for non-existent run", async () => {
		const result = await suggestTaskIds("team_nonexistent", "");
		assert.equal(result, null);
	});

	it("suggests task IDs for a real run", async () => {
		const created = createRunManifest({ cwd: tmpCwd, team, workflow, goal: "task test" });
		const result = await suggestTaskIds(created.manifest.runId, "");
		assert.ok(result, "expected task-id suggestions");
		assert.ok(result.length > 0, "workflow has at least one task");
		for (const item of result) {
			assert.ok(item.value.length > 0);
			assert.ok(item.description);
		}
	});
});
