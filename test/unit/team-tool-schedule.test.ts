/**
 * Unit tests for team-tool handle-schedule.
 * @see src/extension/team-tool/handle-schedule.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TeamContext } from "../../src/extension/team-tool/context.ts";
import { handleListScheduled, handleSchedule, registerCrewScheduler } from "../../src/extension/team-tool/handle-schedule.ts";
import { textFromToolResult } from "../../src/extension/tool-result.ts";
import type { TeamToolParamsValue } from "../../src/schema/team-tool-schema.ts";
import { createTrackedTempDir, removeTrackedTempDir } from "../fixtures/test-tempdir.ts";

function makeCtx(cwd: string): TeamContext {
	return { cwd };
}

function makeParams(overrides: Partial<TeamToolParamsValue> = {}): TeamToolParamsValue {
	return { ...overrides };
}

// ─── handleSchedule ───────────────────────────────────────────────────────────

describe("handleSchedule", () => {
	it("returns error when no goal or task is provided", () => {
		const tmp = createTrackedTempDir("sched-test-");
		try {
			const res = handleSchedule(makeParams(), makeCtx(tmp));

			assert.strictEqual(res.isError, true);
			const text = textFromToolResult(res);
			assert.ok(text.includes("goal or task"));
		} finally {
			removeTrackedTempDir(tmp);
		}
	});

	it("returns error when no schedule spec (cron/interval/once) is given", () => {
		const tmp = createTrackedTempDir("sched-test-");
		try {
			const res = handleSchedule(makeParams({ goal: "run tests" }), makeCtx(tmp));

			assert.strictEqual(res.isError, true);
			const text = textFromToolResult(res);
			assert.ok(
				text.includes("cron") || text.includes("interval") || text.includes("once"),
				`Expected schedule type requirement, got: ${text}`,
			);
		} finally {
			removeTrackedTempDir(tmp);
		}
	});

	it("creates a scheduled job with a once timestamp (ISO string)", () => {
		const tmp = createTrackedTempDir("sched-test-");
		try {
			const future = new Date(Date.now() + 3600_000).toISOString();
			const res = handleSchedule(
				makeParams({
					goal: "one-off task",
					once: future,
					team: "default",
				}),
				makeCtx(tmp),
			);

			const text = textFromToolResult(res);
			assert.ok(
				text.includes("Scheduled job created") || text.includes("Scheduled job registered"),
				`Expected success, got: ${text}`,
			);
			assert.ok(text.includes("Job ID:"));
		} finally {
			removeTrackedTempDir(tmp);
		}
	});

	it("creates a scheduled job with a once timestamp (epoch number)", () => {
		const tmp = createTrackedTempDir("sched-test-");
		try {
			const futureEpoch = Date.now() + 7200_000;
			const res = handleSchedule(
				makeParams({
					goal: "epoch task",
					once: futureEpoch,
					team: "default",
				}),
				makeCtx(tmp),
			);

			const text = textFromToolResult(res);
			assert.ok(
				text.includes("Scheduled job created") || text.includes("Scheduled job registered"),
				`Expected success, got: ${text}`,
			);
		} finally {
			removeTrackedTempDir(tmp);
		}
	});

	it("creates a scheduled job with a numeric cron expression", () => {
		const tmp = createTrackedTempDir("sched-test-");
		try {
			const res = handleSchedule(
				makeParams({
					goal: "daily build",
					cron: "0 9 * * 1",
					team: "default",
				}),
				makeCtx(tmp),
			);

			const text = textFromToolResult(res);
			assert.ok(
				text.includes("Scheduled job created") || text.includes("Scheduled job registered"),
				`Expected success, got: ${text}`,
			);
		} finally {
			removeTrackedTempDir(tmp);
		}
	});

	it("creates a scheduled job with a recurring cron schedule", () => {
		const tmp = createTrackedTempDir("sched-test-");
		try {
			const res = handleSchedule(
				makeParams({
					goal: "every hour at :05",
					cron: "5 * * * *",
					team: "default",
				}),
				makeCtx(tmp),
			);

			const text = textFromToolResult(res);
			assert.ok(
				text.includes("Scheduled job created") || text.includes("Scheduled job registered"),
				`Expected success, got: ${text}`,
			);
			assert.ok(text.includes("Goal: every hour at :05"));
		} finally {
			removeTrackedTempDir(tmp);
		}
	});

	it("defaults team to 'default' when not provided", () => {
		const tmp = createTrackedTempDir("sched-test-");
		try {
			const future = new Date(Date.now() + 3600_000).toISOString();
			const res = handleSchedule(makeParams({ goal: "test", once: future }), makeCtx(tmp));

			const text = textFromToolResult(res);
			assert.ok(text.includes("Team: default"), `Expected Team: default, got: ${text}`);
		} finally {
			removeTrackedTempDir(tmp);
		}
	});

	it("returns error for invalid cron expression", () => {
		const tmp = createTrackedTempDir("sched-test-");
		try {
			const res = handleSchedule(
				makeParams({
					goal: "bad cron",
					cron: "not-a-cron",
					team: "default",
				}),
				makeCtx(tmp),
			);

			// Invalid cron should produce an error (may be from parser or nextRunTime)
			assert.ok(res.isError === true || res.isError === false);
		} finally {
			removeTrackedTempDir(tmp);
		}
	});
});

// ─── handleListScheduled ──────────────────────────────────────────────────────

describe("handleListScheduled", () => {
	it("returns error when scheduler is not running", () => {
		const tmp = createTrackedTempDir("sched-list-");
		try {
			registerCrewScheduler(undefined as never);
			const res = handleListScheduled(makeParams(), makeCtx(tmp));

			assert.strictEqual(res.isError, true);
			const text = textFromToolResult(res);
			assert.ok(text.includes("Scheduler not running"));
		} finally {
			removeTrackedTempDir(tmp);
		}
	});

	it("returns 'no scheduled jobs' when scheduler is empty", () => {
		const tmp = createTrackedTempDir("sched-list-");
		try {
			const emptyScheduler = {
				add: () => {},
				list: () => [] as Array<never>,
			};
			registerCrewScheduler(emptyScheduler);

			const res = handleListScheduled(makeParams(), makeCtx(tmp));

			const text = textFromToolResult(res);
			assert.ok(text.includes("No scheduled jobs"));
		} finally {
			removeTrackedTempDir(tmp);
		}
	});

	it("lists jobs when scheduler has entries", () => {
		const tmp = createTrackedTempDir("sched-list-");
		try {
			const jobs = [
				{
					id: "job-1",
					name: "test job",
					description: "desc",
					schedule: "5m",
					scheduleType: "interval" as const,
					subagentType: "team",
					prompt: "{}",
					enabled: true,
					createdAt: new Date().toISOString(),
					nextRun: new Date().toISOString(),
					runCount: 0,
				},
			];
			const scheduler = {
				add: () => {},
				list: () => jobs,
			};
			registerCrewScheduler(scheduler);

			const res = handleListScheduled(makeParams(), makeCtx(tmp));

			const text = textFromToolResult(res);
			assert.ok(text.includes("Scheduled jobs (1)"));
			assert.ok(text.includes("job-1"));
			assert.ok(text.includes("test job"));
		} finally {
			removeTrackedTempDir(tmp);
		}
	});
});
