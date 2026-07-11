import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PiSpawnCommand } from "../../src/runtime/pi-spawn.ts";
import { __setBunBinaryForTest, getPiSpawnCommand, workerRuntimeCommand } from "../../src/runtime/pi-spawn.ts";

// ── getPiSpawnCommand ──

describe("getPiSpawnCommand", () => {
	it("returns a command object with 'command' and 'args' properties", () => {
		const result = getPiSpawnCommand(["--help"]);
		assert.ok(result);
		assert.ok(typeof result.command === "string");
		assert.ok(Array.isArray(result.args));
	});

	it("passes through provided arguments", () => {
		const result = getPiSpawnCommand(["--mode", "json", "-p", "hello"]);
		assert.ok(result.args.includes("--mode"));
		assert.ok(result.args.includes("json"));
		assert.ok(result.args.includes("-p"));
		assert.ok(result.args.includes("hello"));
	});

	it("returns a usable runtime invocation when script is resolved", () => {
		const result = getPiSpawnCommand(["--version"]);
		// Should be either <runtime> <script> or pi directly
		assert.ok(
			result.command === "pi" || result.command === workerRuntimeCommand(),
			`Expected 'pi' or the worker runtime, got '${result.command}'`,
		);
	});

	it("handles empty args array", () => {
		const result = getPiSpawnCommand([]);
		// args may include a resolved script path, but no user-provided args
		assert.ok(Array.isArray(result.args));
		// The command should be usable
		assert.ok(result.command.length > 0);
	});

	it("works without explicit PI_TEAMS_PI_BIN env", () => {
		// Just ensure it doesn't crash
		const result = getPiSpawnCommand(["--help"]);
		assert.ok(result.command.length > 0);
	});
});

// ── workerRuntimeCommand ──

describe("workerRuntimeCommand", () => {
	it("PI_CREW_WORKER_RUNTIME=node forces the host runtime", () => {
		assert.equal(workerRuntimeCommand({ PI_CREW_WORKER_RUNTIME: "node" }), process.execPath);
	});

	it("PI_CREW_WORKER_RUNTIME=inherit forces the host runtime", () => {
		assert.equal(workerRuntimeCommand({ PI_CREW_WORKER_RUNTIME: "inherit" }), process.execPath);
	});

	it("default prefers a resolved bun binary", () => {
		__setBunBinaryForTest("/fake/bun");
		try {
			assert.equal(workerRuntimeCommand({}), "/fake/bun");
		} finally {
			__setBunBinaryForTest(null);
		}
	});

	it("default falls back to the host runtime when bun is absent", () => {
		__setBunBinaryForTest(false);
		try {
			assert.equal(workerRuntimeCommand({}), process.execPath);
		} finally {
			__setBunBinaryForTest(null);
		}
	});

	it("resolves a real bun binary from PATH when present (memo reset)", () => {
		__setBunBinaryForTest(null);
		try {
			const command = workerRuntimeCommand(process.env);
			// Either a real bun binary or the host runtime — never empty, never bare "bun".
			assert.ok(command.length > 0);
			assert.ok(command !== "bun", "must resolve to an absolute path or fall back to execPath");
		} finally {
			__setBunBinaryForTest(null);
		}
	});
});
