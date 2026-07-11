import assert from "node:assert/strict";
import test from "node:test";
import { registerPiTeams } from "../../src/extension/register.ts";

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
