/**
 * Unit tests for dynamic-workflow-context.ts (P2).
 *
 * Tests resolveAgentForRole (G4 4-tier precedence), synthesizeAgentConfig (C7),
 * makeWorkflowCtx surface (capability lock + setResult + semaphore).
 * The agent() path is exercised via PI_TEAMS_MOCK_CHILD_PI (no real pi spawn).
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {
	resolveAgentForRole,
	synthesizeAgentConfig,
	makeWorkflowCtx,
	getWorkflowFinalResult,
} from "../../src/runtime/dynamic-workflow-context.ts";
import type { TeamRunManifest } from "../../src/state/types.ts";

function tmpCwd(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-dwf-ctx-"));
}

function fakeManifest(cwd: string): TeamRunManifest {
	const now = new Date().toISOString();
	return {
		schemaVersion: 1,
		runId: "team_dwf_test_abc",
		team: "dwf-test",
		goal: "test goal",
		status: "running",
		workspaceMode: "single",
		createdAt: now,
		updatedAt: now,
		cwd,
		stateRoot: `${cwd}/.crew/state/runs/team_dwf_test_abc`,
		artifactsRoot: `${cwd}/.crew/artifacts/team_dwf_test_abc`,
		tasksPath: `${cwd}/.crew/state/runs/team_dwf_test_abc/tasks.json`,
		eventsPath: `${cwd}/.crew/state/runs/team_dwf_test_abc/events.jsonl`,
		artifacts: [],
	};
}

test("synthesizeAgentConfig uses source:'dynamic' (§0c C7 — not 'synthetic')", () => {
	const cfg = synthesizeAgentConfig("myrole");
	assert.equal(cfg.name, "myrole");
	assert.equal(cfg.source, "dynamic");
	assert.match(cfg.systemPrompt, /You are myrole/);
	assert.equal(cfg.inheritProjectContext, false);
});

test("resolveAgentForRole tier-4 fallback synthesizes when no agent matches", () => {
	const cwd = tmpCwd();
	try {
		const cfg = resolveAgentForRole("nonexistent-role-xyz", { cwd });
		assert.equal(cfg.name, "nonexistent-role-xyz");
		assert.equal(cfg.source, "dynamic", "tier-4 synthesis uses source:'dynamic'");
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("resolveAgentForRole tier-1 explicit agent wins over role name", () => {
	const cwd = tmpCwd();
	try {
		// No real agents in tmp cwd → tier-1 miss falls through to tier-4 synthesis,
		// but with the explicit name preserved.
		const cfg = resolveAgentForRole("some-role", { explicitAgent: "my-explicit", cwd });
		assert.equal(cfg.name, "my-explicit", "explicit agent name preserved in fallback");
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("makeWorkflowCtx exposes ONLY documented methods (capability lock)", () => {
	const cwd = tmpCwd();
	try {
		const manifest = fakeManifest(cwd);
		const ctx = makeWorkflowCtx(manifest, { signal: new AbortController().signal });
		// Public surface.
		assert.equal(typeof ctx.agent, "function");
		assert.equal(typeof ctx.fanOut, "function");
		assert.equal(typeof ctx.setResult, "function");
		assert.ok(ctx.semaphore);
		assert.equal(ctx.cwd, cwd);
		assert.equal(ctx.runId, "team_dwf_test_abc");
		// No raw manifest/process/require leaks on the ctx object.
		assert.equal((ctx as unknown as { manifest?: unknown }).manifest, undefined);
		assert.equal((ctx as unknown as { process?: unknown }).process, undefined);
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("ctx.setResult records the final result; runner reads it via getWorkflowFinalResult", () => {
	const cwd = tmpCwd();
	try {
		const manifest = fakeManifest(cwd);
		const ctx = makeWorkflowCtx(manifest, { signal: new AbortController().signal });
		assert.equal(getWorkflowFinalResult(ctx), undefined, "no final result until setResult is called");
		ctx.setResult("/tmp/fake-artifact.md", { ok: true });
		const final = getWorkflowFinalResult(ctx);
		assert.deepEqual(final, { artifactPath: "/tmp/fake-artifact.md", meta: { ok: true } });
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("ctx.agent() returns ok:false on spawn failure (mock without PI_CREW_ALLOW_MOCK)", async () => {
	const cwd = tmpCwd();
	try {
		process.env.PI_TEAMS_MOCK_CHILD_PI = "json-success";
		// PI_CREW_ALLOW_MOCK intentionally NOT set → mock returns exit 1.
		const manifest = fakeManifest(cwd);
		const ctx = makeWorkflowCtx(manifest, { signal: new AbortController().signal, concurrency: 1 });
		const res = await ctx.agent({ role: "executor", prompt: "say hi", maxTurns: 1 });
		assert.equal(res.ok, false, "without PI_CREW_ALLOW_MOCK, mock child-pi fails");
		assert.ok(res.error);
	} finally {
		delete process.env.PI_TEAMS_MOCK_CHILD_PI;
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});
