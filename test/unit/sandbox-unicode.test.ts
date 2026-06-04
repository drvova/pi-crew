import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeCodeForValidation, WorkflowSandbox } from "../../src/runtime/sandbox.ts";

describe("sandbox unicode bypass prevention", () => {
	it("should catch import\\u0028 (dynamic import with unicode escape)", () => {
		const sandbox = new WorkflowSandbox();
		assert.throws(
			() => sandbox.execute('import\\u0028"fs"\\u0029'),
			/Forbidden pattern/,
		);
	});

	it("should catch require\\u0028 with unicode escape", () => {
		const sandbox = new WorkflowSandbox();
		assert.throws(
			() => sandbox.execute('require\\u0028"child_process"\\u0029'),
			/Forbidden pattern/,
		);
	});

	it("should catch import with null bytes injected", () => {
		const sandbox = new WorkflowSandbox();
		// Null bytes cause SyntaxError at compile time, which also prevents execution
		assert.throws(
			() => sandbox.execute('impo\0rt("fs")'),
			/Forbidden pattern|Invalid or unexpected token/,
		);
	});

	it("normalizeCodeForValidation strips null bytes", () => {
		// Use an actual null byte (char code 0) in the string
		const result = normalizeCodeForValidation("re\0quire('fs')");
		assert.ok(!result.includes("\0"));
		assert.ok(result.includes("require"));
	});

	it("normalizeCodeForValidation decodes unicode escapes", () => {
		const result = normalizeCodeForValidation("import\\u0028\"fs\"\\u0029");
		assert.equal(result, 'import("fs")');
	});

	it("should still catch plain import()", () => {
		const sandbox = new WorkflowSandbox();
		assert.throws(
			() => sandbox.execute('import("fs")'),
			/Forbidden pattern/,
		);
	});

	it("should still catch plain require()", () => {
		const sandbox = new WorkflowSandbox();
		assert.throws(
			() => sandbox.execute('require("child_process")'),
			/Forbidden pattern/,
		);
	});

	it("should allow safe code after normalization", () => {
		const sandbox = new WorkflowSandbox();
		// Simple arithmetic should not trigger any forbidden patterns
		const result = sandbox.execute("return 1 + 2");
		assert.equal(result, 3);
	});

	it("should catch export with unicode escape", () => {
		const sandbox = new WorkflowSandbox();
		assert.throws(
			() => sandbox.execute("export\\u0020default 42"),
			/Forbidden pattern/,
		);
	});

	it("should catch module. with unicode escape in dot", () => {
		const sandbox = new WorkflowSandbox();
		assert.throws(
			() => sandbox.execute("module\\u002eexports = {}"),
			/Forbidden pattern/,
		);
	});
});
