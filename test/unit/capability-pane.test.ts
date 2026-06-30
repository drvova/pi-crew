import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { renderCapabilityPane } from "../../src/ui/dashboard-panes/capability-pane.ts";

test("capability pane renders teams and agents", () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-cap-pane-"));
	fs.mkdirSync(path.join(cwd, ".crew"), { recursive: true });
	try {
		const lines = renderCapabilityPane(cwd);
		assert.ok(lines.length > 1);
		assert.ok(lines[0].includes("Capability pane"));
		assert.ok(lines.some((l) => l.includes("team") || l.includes("agent")));
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

test("capability pane with filter reduces results", () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-cap-pane2-"));
	fs.mkdirSync(path.join(cwd, ".crew"), { recursive: true });
	try {
		const all = renderCapabilityPane(cwd);
		const filtered = renderCapabilityPane(cwd, { filter: "team" });
		assert.ok(filtered.length > 0);
		assert.ok(filtered.some((l) => l.includes("team")));
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});
