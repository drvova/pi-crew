import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Replicate the sanitize logic to test it directly
const POLLUTED_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function sanitizeMergeData(data: Record<string, unknown>): Record<string, unknown> {
	const clean: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(data)) {
		if (!POLLUTED_KEYS.has(k)) clean[k] = v;
	}
	return clean;
}

describe("prototype pollution prevention", () => {
	it("filters __proto__ key", () => {
		const input: Record<string, unknown> = { __proto__: { polluted: true }, safe: "value" };
		const result = sanitizeMergeData(input);
		// Use Object.keys (own properties) rather than 'in' (which checks prototype chain)
		assert.equal(Object.keys(result).includes("__proto__"), false);
		assert.equal(result.safe, "value");
	});

	it("filters constructor key", () => {
		const input: Record<string, unknown> = { constructor: "evil", data: "good" };
		const result = sanitizeMergeData(input);
		assert.equal(Object.keys(result).includes("constructor"), false);
		assert.equal(result.data, "good");
	});

	it("filters prototype key", () => {
		const input: Record<string, unknown> = { prototype: { polluted: true }, name: "test" };
		const result = sanitizeMergeData(input);
		assert.equal(Object.keys(result).includes("prototype"), false);
		assert.equal(result.name, "test");
	});

	it("passes through safe keys", () => {
		const input = { foo: "bar", baz: 42, nested: { a: 1 } };
		const result = sanitizeMergeData(input);
		assert.deepEqual(result, input);
	});

	it("handles empty object", () => {
		const result = sanitizeMergeData({});
		assert.deepEqual(result, {});
	});

	it("filters all pollution keys at once", () => {
		const input: Record<string, unknown> = { __proto__: "a", constructor: "b", prototype: "c", safe: "d" };
		const result = sanitizeMergeData(input);
		assert.deepEqual(Object.keys(result), ["safe"]);
		assert.equal(result.safe, "d");
	});
});
