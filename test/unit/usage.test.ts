import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TeamTaskState } from "../../src/state/types.ts";
import { addUsage, aggregateUsage, formatUsage, getLifetimeTotal, type LifetimeUsage } from "../../src/state/usage.ts";

function makeTask(usage?: Partial<Record<string, number>>): TeamTaskState {
	return {
		id: "01_task",
		runId: "run-1",
		role: "agent",
		agent: "default",
		title: "Test task",
		status: "completed",
		dependsOn: [],
		cwd: "/tmp",
		usage: usage
			? {
					input: usage.input,
					output: usage.output,
					cacheRead: usage.cacheRead,
					cacheWrite: usage.cacheWrite,
					cost: usage.cost,
					turns: usage.turns,
				}
			: undefined,
	};
}

describe("getLifetimeTotal", () => {
	it("returns 0 for undefined input", () => {
		assert.equal(getLifetimeTotal(undefined), 0);
	});

	it("sums input, output, and cacheWrite", () => {
		const u: LifetimeUsage = { input: 100, output: 50, cacheWrite: 25 };
		assert.equal(getLifetimeTotal(u), 175);
	});

	it("handles zero values", () => {
		const u: LifetimeUsage = { input: 0, output: 0, cacheWrite: 0 };
		assert.equal(getLifetimeTotal(u), 0);
	});
});

describe("addUsage", () => {
	it("adds delta values into target (mutation)", () => {
		const target: LifetimeUsage = { input: 10, output: 5, cacheWrite: 2 };
		const delta: LifetimeUsage = { input: 3, output: 7, cacheWrite: 1 };
		addUsage(target, delta);
		assert.deepEqual(target, { input: 13, output: 12, cacheWrite: 3 });
	});

	it("accumulates multiple deltas", () => {
		const target: LifetimeUsage = { input: 0, output: 0, cacheWrite: 0 };
		addUsage(target, { input: 5, output: 5, cacheWrite: 5 });
		addUsage(target, { input: 10, output: 10, cacheWrite: 10 });
		assert.deepEqual(target, { input: 15, output: 15, cacheWrite: 15 });
	});

	it("does not create new properties on target", () => {
		const target: LifetimeUsage = { input: 1, output: 1, cacheWrite: 1 };
		addUsage(target, { input: 2, output: 2, cacheWrite: 2 });
		const keys = Object.keys(target);
		assert.deepEqual(keys.sort(), ["cacheWrite", "input", "output"]);
	});
});

describe("aggregateUsage", () => {
	it("returns undefined for empty task list", () => {
		assert.equal(aggregateUsage([]), undefined);
	});

	it("returns undefined when no tasks have usage", () => {
		assert.equal(aggregateUsage([makeTask()]), undefined);
	});

	it("aggregates usage from multiple tasks", () => {
		const tasks = [
			makeTask({ input: 100, output: 50, cost: 0.5, turns: 3 }),
			makeTask({ input: 200, output: 80, cost: 1.0, turns: 5 }),
		];
		const agg = aggregateUsage(tasks);
		assert.ok(agg);
		assert.equal(agg.input, 300);
		assert.equal(agg.output, 130);
		assert.equal(agg.cost, 1.5);
		assert.equal(agg.turns, 8);
	});

	it("handles tasks with partial usage fields", () => {
		const tasks = [makeTask({ input: 10 }), makeTask({ output: 20 })];
		const agg = aggregateUsage(tasks);
		assert.ok(agg);
		assert.equal(agg.input, 10);
		assert.equal(agg.output, 20);
		assert.equal(agg.cacheRead, 0);
	});

	it("skips tasks without usage property", () => {
		const tasks = [makeTask(), makeTask({ input: 50 })];
		const agg = aggregateUsage(tasks);
		assert.ok(agg);
		assert.equal(agg.input, 50);
	});
});

describe("formatUsage", () => {
	it("returns '(none)' for undefined usage", () => {
		assert.equal(formatUsage(undefined), "(none)");
	});

	it("formats all available fields", () => {
		const result = formatUsage({
			input: 100,
			output: 50,
			cacheRead: 30,
			cacheWrite: 10,
			cost: 0.123456,
			turns: 5,
		});
		assert.ok(result.includes("input=100"));
		assert.ok(result.includes("output=50"));
		assert.ok(result.includes("cacheRead=30"));
		assert.ok(result.includes("cacheWrite=10"));
		assert.ok(result.includes("cost=0.123456"));
		assert.ok(result.includes("turns=5"));
	});

	it("omits fields that are undefined", () => {
		const result = formatUsage({ input: 100 });
		assert.ok(result.includes("input=100"));
		assert.ok(!result.includes("output="));
		assert.ok(!result.includes("cost="));
	});
});
