#!/usr/bin/env node
/**
 * CI gate: detect unresolved git merge conflict markers in source.
 *
 * Scans tracked source files for `<<<<<<<`, `=======` (lone), and
 * `>>>>>>>` patterns that indicate a botched merge. Fails CI if any
 * are found so they can't reach the bundle (which esbuild would
 * choke on with a parse error).
 *
 * History: 2026-07-01 CI #28498831579 (Ubuntu) failed because
 * src/runtime/child-pi.ts and src/extension/pi-api.ts shipped with
 * unresolved conflict markers left over from earlier stash/pop cycles
 * during Phase 2-5 implementation. The esbuild transformer in the
 * test runner hit `Expected identifier but found "<<"` at
 * src/runtime/child-pi.ts:1073 — a syntax error caused by the markers.
 *
 * Scope:
 *   - Tracks files in src/, test/, scripts/, workflows/, teams/,
 *     agents/, themes/ — anywhere a conflict would land.
 *   - Excludes test/unit/conflict-detect.test.ts which INTENTIONALLY
 *     contains `<<<<<<< HEAD` etc. as test fixtures (test the
     detector itself).
 *   - Detects both conflict-style (`<<<<<<<`, `=======`, `>>>>>>>`)
 *     and diff3-style (`|||||||`) markers.
 *
 * Exits:
 *   0 — clean (no markers found, or only allowed locations)
 *   1 — markers found (with file:line listing)
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const MARKER_PATTERNS = [
	/^<<<<<<< /m, // ours/incoming/conflict markers
	/^=======$/m, // conflict separator (lone, not bash =======)
	/^>>>>>>> /m, // theirs/outgoing markers
	/^\|\|\|\|\|\|\| /m, // diff3 base marker
];

const SCAN_PATHS = ["src/", "test/", "scripts/", "workflows/", "teams/", "agents/", "themes/"];
const EXCLUDE_FILES = new Set([
	// Intentionally contains conflict markers as test fixtures.
	"test/unit/conflict-detect.test.ts",
]);

function listTrackedFiles() {
	try {
		const all = execSync("git ls-files", { encoding: "utf-8" });
		return all
			.split("\n")
			.filter(Boolean)
			.filter((f) => SCAN_PATHS.some((p) => f.startsWith(p) || f === p.replace(/\/$/, "")))
			.filter((f) => !EXCLUDE_FILES.has(f));
	} catch {
		console.error("[conflict-markers] not a git repo; skipping check.");
		process.exit(0);
	}
}

const files = listTrackedFiles();
const offenders = [];

for (const file of files) {
	let content;
	try {
		content = readFileSync(file, "utf-8");
	} catch {
		// File listed but unreadable — skip silently.
		continue;
	}
	const lines = content.split(/\r?\n/);
	for (let i = 0; i < lines.length; i += 1) {
		const line = lines[i];
		if (MARKER_PATTERNS.some((re) => re.test(line))) {
			offenders.push({ file, line: i + 1, text: line });
		}
	}
}

if (offenders.length === 0) {
	console.log(`[conflict-markers] OK: scanned ${files.length} files, no markers found.`);
	process.exit(0);
}

console.error(`[conflict-markers] FAIL: ${offenders.length} conflict marker(s) found.`);
for (const o of offenders) {
	console.error(`  ${o.file}:${o.line}: ${o.text.trim().slice(0, 80)}`);
}
console.error("\nResolve with: git checkout --ours|--theirs or git add ... after manual edit.");
process.exit(1);