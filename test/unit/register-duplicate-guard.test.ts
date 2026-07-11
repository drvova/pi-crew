import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { registerPiTeams, removeDuplicatePackageEntry } from "../../src/extension/register.ts";

// Poka-Yoke (2026-07-11): duplicate-install guard. When another pi-crew copy
// (different source path) already registered in this process, registerPiTeams
// must no-op BEFORE touching the ExtensionAPI — otherwise Pi hard-fails with
// `Tool "…" conflicts` errors for every tool at startup.

const MARKER = Symbol.for("pi-crew.registered-from");

test("registerPiTeams no-ops when another copy already registered from a different path", () => {
	const holder = globalThis as Record<symbol, unknown>;
	const previous = holder[MARKER];
	holder[MARKER] = "/fake/other-install/src/extension/register.ts";
	try {
		// A poisoned ExtensionAPI: ANY property access throws. The guard must
		// return before touching it.
		const poisoned = new Proxy(
			{},
			{
				get() {
					throw new Error("ExtensionAPI touched despite duplicate-install guard");
				},
			},
		);
		assert.doesNotThrow(() => registerPiTeams(poisoned as never));
		assert.equal(holder[MARKER], "/fake/other-install/src/extension/register.ts", "first copy's marker must be preserved");
	} finally {
		if (previous === undefined) delete holder[MARKER];
		else holder[MARKER] = previous;
	}
});

// ── self-heal: remove the losing copy's package entry (2026-07-11) ──

test("removeDuplicatePackageEntry removes only the entry containing the losing copy", () => {
	const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-selfheal-"));
	try {
		const cloneDir = path.join(agentDir, "git", "github.com", "drvova", "pi-crew");
		fs.mkdirSync(path.join(cloneDir, "dist"), { recursive: true });
		fs.writeFileSync(
			path.join(agentDir, "settings.json"),
			`${JSON.stringify(
				{
					theme: "dark",
					packages: ["npm:context-mode", "../../pi-crew", "git:https://github.com/drvova/pi-crew"],
				},
				null,
				2,
			)}\n`,
			"utf-8",
		);
		const removed = removeDuplicatePackageEntry(path.join(cloneDir, "dist", "index.mjs"), agentDir);
		assert.equal(removed, "git:https://github.com/drvova/pi-crew");
		const after = JSON.parse(fs.readFileSync(path.join(agentDir, "settings.json"), "utf-8"));
		assert.deepEqual(after.packages, ["npm:context-mode", "../../pi-crew"], "other entries must be preserved");
		assert.equal(after.theme, "dark", "unrelated settings must survive the rewrite");
	} finally {
		fs.rmSync(agentDir, { recursive: true, force: true });
	}
});

test("removeDuplicatePackageEntry is a no-op when no entry matches the losing copy", () => {
	const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-selfheal-nomatch-"));
	try {
		const before = { packages: ["npm:context-mode", "../../pi-crew"] };
		fs.writeFileSync(path.join(agentDir, "settings.json"), `${JSON.stringify(before, null, 2)}\n`, "utf-8");
		const removed = removeDuplicatePackageEntry("/somewhere/else/dist/index.mjs", agentDir);
		assert.equal(removed, undefined);
		const after = JSON.parse(fs.readFileSync(path.join(agentDir, "settings.json"), "utf-8"));
		assert.deepEqual(after.packages, before.packages);
	} finally {
		fs.rmSync(agentDir, { recursive: true, force: true });
	}
});

test("removeDuplicatePackageEntry fails open on missing/corrupt settings", () => {
	assert.equal(removeDuplicatePackageEntry("/x/dist/index.mjs", "/nonexistent-agent-dir"), undefined);
});
