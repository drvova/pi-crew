/**
 * Regression test for RFC 17: dwf.runDynamicWorkflow must propagate setResult
 * to getWorkflowFinalResult via the frozen ctx.
 *
 * Live pi session was returning "(dynamic workflow X completed without calling
 * ctx.setResult())" even when the dwf called ctx.setResult(path). This test
 * reproduces the issue at the unit level so the bug is caught by CI.
 */
import { fileURLToPath } from "node:url";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import assert from "node:assert/strict";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const thisFile = fileURLToPath(import.meta.url);

test("runDynamicWorkflow: dwf calling ctx.setResult(path) is recognized", async () => {
	const jitiMod = require(path.join(repoRoot, "node_modules/jiti/lib/jiti.cjs"));
	const createJiti = jitiMod.default ?? jitiMod;
	const jiti = createJiti(thisFile);
	const dwfMod = await jiti.import(path.join(repoRoot, "src/runtime/dynamic-workflow-runner.ts") as string);
	const { runDynamicWorkflow } = dwfMod.default ?? dwfMod;
	assert.equal(typeof runDynamicWorkflow, "function");

	const tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-dwf-sr-"));
	fs.mkdirSync(path.join(tmpCwd, ".crew", "workflows"), { recursive: true });

	const artifactPath = path.join(tmpCwd, "expected-result.txt");
	const dwfPath = path.join(tmpCwd, ".crew", "workflows", "setresult-test.dwf.ts");
	fs.writeFileSync(
		dwfPath,
		`export default async function run(ctx) {
  ctx.setResult(${JSON.stringify(artifactPath)});
}
`,
	);

	const runId = "team_dwf_sr_test_" + Date.now();
	const stateRoot = path.join(tmpCwd, "state");
	fs.mkdirSync(stateRoot, { recursive: true });
	const eventsPath = path.join(stateRoot, "events.jsonl");
	fs.writeFileSync(eventsPath, "");

	const manifest = {
		schemaVersion: 1,
		runId,
		team: "test-team",
		workflow: "setresult-test",
		goal: "test setResult",
		status: "running" as const,
		workspaceMode: "single" as const,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		cwd: tmpCwd,
		stateRoot,
		artifactsRoot: path.join(tmpCwd, "artifacts"),
		tasksPath: path.join(stateRoot, "tasks.json"),
		eventsPath,
		artifacts: [],
	};
	const workflow = {
		name: "setresult-test",
		description: "test",
		source: "project" as const,
		filePath: dwfPath,
		steps: [],
		runtime: "dynamic" as const,
		dynamicScript: dwfPath,
	};
	const team = {
		name: "test-team",
		description: "test",
		source: "dynamic" as const,
		filePath: "<test>",
		roles: [{ name: "worker", agent: "executor" }],
		workspaceMode: "single" as const,
	};

	const result = await runDynamicWorkflow({
		manifest,
		workflow,
		team,
		signal: AbortSignal.timeout(5000),
	});
	assert.notEqual(
		result.manifest.summary,
		"(dynamic workflow 'setresult-test' completed without calling ctx.setResult())",
		`setResult was called by the dwf but the runner reports it wasn't. summary=${result.manifest.summary}`,
	);
});
