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

function writeSettings(agentDir: string, packages: string[]): void {
	fs.writeFileSync(path.join(agentDir, "settings.json"), `${JSON.stringify({ theme: "dark", packages }, null, 2)}\n`, "utf-8");
}

function makeAgentDir(): { agentDir: string; cloneMjs: string; devMjs: string } {
	const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-selfheal-"));
	const cloneDir = path.join(agentDir, "git", "github.com", "drvova", "pi-crew");
	const devDir = `${agentDir}-dev`; // sibling of agentDir in tmp
	// dev checkout addressed via a RELATIVE entry from agentDir
	const relDev = path.relative(agentDir, devDir);
	fs.mkdirSync(path.join(cloneDir, "dist"), { recursive: true });
	fs.mkdirSync(path.join(devDir, "dist"), { recursive: true });
	writeSettings(agentDir, ["npm:context-mode", relDev, "git:https://github.com/drvova/pi-crew"]);
	return { agentDir, cloneMjs: path.join(cloneDir, "dist", "index.mjs"), devMjs: path.join(devDir, "dist", "index.mjs") };
}

test("self-heal: clone loses race -> git entry removed, dev preserved", () => {
	const { agentDir, cloneMjs, devMjs } = makeAgentDir();
	try {
		const removed = removeDuplicatePackageEntry(cloneMjs, devMjs, agentDir);
		assert.equal(removed, "git:https://github.com/drvova/pi-crew");
		const after = JSON.parse(fs.readFileSync(path.join(agentDir, "settings.json"), "utf-8"));
		assert.equal(after.packages.length, 2);
		assert.ok(!after.packages.includes("git:https://github.com/drvova/pi-crew"));
		assert.equal(after.theme, "dark", "unrelated settings must survive the rewrite");
	} finally {
		fs.rmSync(agentDir, { recursive: true, force: true });
	}
});

test("self-heal: dev loses race -> git entry STILL removed (observed live 2026-07-11)", () => {
	// The exact incident: clone won the registration race, old policy removed
	// the dev path entry. The deterministic policy must keep the path entry
	// regardless of which copy lost.
	const { agentDir, cloneMjs, devMjs } = makeAgentDir();
	try {
		const removed = removeDuplicatePackageEntry(devMjs, cloneMjs, agentDir);
		assert.equal(removed, "git:https://github.com/drvova/pi-crew", "path entry must be kept even when it lost the race");
		const after = JSON.parse(fs.readFileSync(path.join(agentDir, "settings.json"), "utf-8"));
		assert.ok(!after.packages.includes("git:https://github.com/drvova/pi-crew"));
		assert.equal(after.packages.length, 2, "dev path entry and unrelated npm entry preserved");
	} finally {
		fs.rmSync(agentDir, { recursive: true, force: true });
	}
});

test("self-heal: no-op when only one side resolves to a package entry", () => {
	const { agentDir, cloneMjs } = makeAgentDir();
	try {
		const removed = removeDuplicatePackageEntry(cloneMjs, "/loaded/from/elsewhere/index.mjs", agentDir);
		assert.equal(removed, undefined, "must never remove the sole matching entry");
		const after = JSON.parse(fs.readFileSync(path.join(agentDir, "settings.json"), "utf-8"));
		assert.equal(after.packages.length, 3, "settings untouched");
	} finally {
		fs.rmSync(agentDir, { recursive: true, force: true });
		fs.rmSync(`${agentDir}-dev`, { recursive: true, force: true });
	}
});

test("self-heal: fails open on missing/corrupt settings", () => {
	assert.equal(removeDuplicatePackageEntry("/x/dist/index.mjs", "/y/dist/index.mjs", "/nonexistent-agent-dir"), undefined);
});
