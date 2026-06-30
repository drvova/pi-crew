import assert from "node:assert/strict";
import test from "node:test";

/**
 * Tests for the hardened globMatch function (MEDIUM #4 fix).
 *
 * The globMatch function is inlined here because importing api.ts pulls in
 * heavy dependencies (pi-coding-agent) that are not available in unit test context.
 *
 * This copy must be kept in sync with src/extension/team-tool/api.ts.
 */

function globMatch(value: string, pattern: string): boolean {
	// Prevent ReDoS: reject excessively long patterns
	if (pattern.length > 200) return false;
	const regex = pattern
		.replace(/[.+^${}()|[\]\\]/g, "\\$&") // escape regex special chars
		.replace(/\*/g, "[^/]*") // * matches non-slash characters only
		.replace(/\?/g, "[^/]"); // ? matches single non-slash
	return new RegExp(`^${regex}$`).test(value);
}

test("globMatch: basic wildcard matches any non-slash chars", () => {
	assert.equal(globMatch("foo", "*"), true);
	assert.equal(globMatch("bar", "*"), true);
	assert.equal(globMatch("foo/bar", "*"), false); // * does not cross /
});

test("globMatch: path-safe * does not match path separator", () => {
	assert.equal(globMatch("src/index.ts", "*.ts"), false);
	assert.equal(globMatch("index.ts", "*.ts"), true);
	assert.equal(globMatch("src/utils/helpers.ts", "src/*.ts"), false);
});

test("globMatch: ? matches single non-slash char", () => {
	assert.equal(globMatch("a", "?"), true);
	assert.equal(globMatch("ab", "?"), false);
	assert.equal(globMatch("a/b", "?/?"), true); // ? matches a and b, / matches /
	assert.equal(globMatch("a/b", "?"), false); // single ? can't match two chars + /
});

test("globMatch: exact match without wildcards", () => {
	assert.equal(globMatch("hello", "hello"), true);
	assert.equal(globMatch("hello", "world"), false);
});

test("globMatch: combined * and ?", () => {
	assert.equal(globMatch("test.ts", "*.?s"), true);
	assert.equal(globMatch("test.js", "*.?s"), true);
	assert.equal(globMatch("test.txt", "*.?s"), false);
});

test("globMatch: regex special chars in pattern are escaped", () => {
	assert.equal(globMatch("file.name", "file.name"), true);
	assert.equal(globMatch("filename", "file.name"), false);
	assert.equal(globMatch("file+extra", "file+extra"), true);
	assert.equal(globMatch("fileextra", "file+extra"), false);
	assert.equal(globMatch("a$b", "a$b"), true);
	assert.equal(globMatch("a(b)", "a(b)"), true);
	assert.equal(globMatch("a[b]", "a[b]"), true);
});

test("globMatch: ReDoS pattern rejected via max length check", () => {
	// Patterns over 200 chars are rejected outright — prevents crafted ReDoS payloads
	const longPattern = "a".repeat(201);
	assert.equal(globMatch("anything", longPattern), false);
	// 200 chars is still allowed
	const maxPattern = "a".repeat(200);
	// This won't match but should not error
	assert.equal(globMatch("anything", maxPattern), false);
});

test("globMatch: no ReDoS with old .* conversion (verified path-safe)", () => {
	// The old globMatch used .* which allowed catastrophic backtracking.
	// The new version uses [^/]* which limits matching to non-slash chars.
	// Verify that * cannot cross path boundaries:
	const text = "foo/bar/baz/qux";
	// With old .* conversion: * would match "foo/bar/baz/qux"
	// With new [^/]* conversion: * only matches "foo"
	assert.equal(globMatch(text, "*"), false);
	assert.equal(globMatch(text, "*/*"), false);
	assert.equal(globMatch(text, "*/*/*/*"), true);
	// Ensure the match is deterministic and fast
	const start = Date.now();
	for (let i = 0; i < 1000; i++) {
		globMatch(text, "*/*/*/*");
	}
	const elapsed = Date.now() - start;
	assert.ok(elapsed < 200, `1000 iterations took ${elapsed}ms — possible ReDoS`);
});

test("globMatch: empty pattern matches empty string", () => {
	assert.equal(globMatch("", ""), true);
	assert.equal(globMatch("a", ""), false);
});

test("globMatch: path segments with *", () => {
	assert.equal(globMatch("src/test.ts", "src/*"), true);
	assert.equal(globMatch("src/sub/test.ts", "src/*"), false);
	assert.equal(globMatch("src/sub/test.ts", "src/*/*"), true);
});
