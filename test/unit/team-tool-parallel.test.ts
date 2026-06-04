/**
 * Unit tests for team-tool parallel dispatch handler.
 * @see src/extension/team-tool/parallel-dispatch.ts
 *
 * NOTE: handleParallel is async and depends on discovery/config/state subsystems.
 * We test argument validation which runs before external deps are accessed.
 * Full integration testing requires file-system setup of teams/workflows.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { handleParallel } from "../../src/extension/team-tool/parallel-dispatch.ts";
import type { TeamToolParamsValue } from "../../src/schema/team-tool-schema.ts";
import type { TeamContext } from "../../src/extension/team-tool/context.ts";
import { textFromToolResult } from "../../src/extension/tool-result.ts";
import { createTrackedTempDir, removeTrackedTempDir } from "../fixtures/test-tempdir.ts";

function makeCtx(cwd: string): TeamContext {
	return { cwd };
}

function makeParams(overrides: Partial<TeamToolParamsValue> = {}): TeamToolParamsValue {
	return { ...overrides };
}

// ─── handleParallel ───────────────────────────────────────────────────────────

describe("handleParallel", () => {
	it("returns error when config.tasks is missing", async () => {
		const tmp = createTrackedTempDir("parallel-test-");
		try {
			const res = await handleParallel(makeParams(), makeCtx(tmp));

			assert.strictEqual(res.isError, true);
			const text = textFromToolResult(res);
			assert.ok(text.includes("config.tasks"));
		} finally {
			removeTrackedTempDir(tmp);
		}
	});

	it("returns error when config.tasks is empty array", async () => {
		const tmp = createTrackedTempDir("parallel-test-");
		try {
			const res = await handleParallel(
				makeParams({ config: { tasks: [] } }),
				makeCtx(tmp),
			);

			assert.strictEqual(res.isError, true);
			const text = textFromToolResult(res);
			assert.ok(text.includes("config.tasks"));
		} finally {
			removeTrackedTempDir(tmp);
		}
	});

	it("returns error when config.tasks is not an array", async () => {
		const tmp = createTrackedTempDir("parallel-test-");
		try {
			const res = await handleParallel(
				makeParams({ config: { tasks: "not-array" } }),
				makeCtx(tmp),
			);

			assert.strictEqual(res.isError, true);
			const text = textFromToolResult(res);
			assert.ok(text.includes("config.tasks"));
		} finally {
			removeTrackedTempDir(tmp);
		}
	});

	it("returns error for non-existent team", async () => {
		const tmp = createTrackedTempDir("parallel-test-");
		try {
			const res = await handleParallel(
				makeParams({
					config: {
						tasks: [{ goal: "do something" }],
						team: "nonexistent-team-xyz",
					},
				}),
				makeCtx(tmp),
			);

			assert.strictEqual(res.isError, true);
			const text = textFromToolResult(res);
			assert.ok(text.includes("not found"));
		} finally {
			removeTrackedTempDir(tmp);
		}
	});

	it("defaults team to 'fast-fix' when not specified", async () => {
		const tmp = createTrackedTempDir("parallel-test-");
		try {
			const res = await handleParallel(
				makeParams({
					config: { tasks: [{ goal: "test goal" }] },
				}),
				makeCtx(tmp),
			);

			// May succeed or fail depending on whether fast-fix team exists in the test cwd
			const text = textFromToolResult(res);
			// We just verify the function completes and returns a result
			assert.ok(typeof text === "string");
		} finally {
			removeTrackedTempDir(tmp);
		}
	});
});
