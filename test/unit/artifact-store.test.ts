import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { createHash } from "node:crypto";
import { writeArtifact } from "../../src/state/artifact-store.ts";

test("writeArtifact: contentHash matches sha256 of bytes on disk", () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-art-"));
	const desc = writeArtifact(root, {
		kind: "log",
		relativePath: "x.log",
		content: "api_key=AKIA0123456789ABCDEF\nplain text",
		producer: "test",
	});
	const onDisk = fs.readFileSync(desc.path);
	const expected = createHash("sha256").update(onDisk).digest("hex");
	assert.strictEqual(desc.contentHash, expected);
	assert.strictEqual(desc.sizeBytes, onDisk.length);
	assert.ok(!onDisk.toString("utf-8").includes("AKIA0123456789ABCDEF"));
	fs.rmSync(root, { recursive: true, force: true });
});

test("writeArtifact: rejects path traversal", () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-art-"));
	assert.throws(() => writeArtifact(root, {
		kind: "log",
		relativePath: "../escape.log",
		content: "x",
		producer: "t",
	}), /Invalid artifact path/);
	fs.rmSync(root, { recursive: true, force: true });
});

test("writeArtifact: creates nested directories", () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-art-"));
	const desc = writeArtifact(root, {
		kind: "log",
		relativePath: "a/b/c.log",
		content: "nested",
		producer: "test",
	});
	assert.ok(fs.existsSync(desc.path));
	fs.rmSync(root, { recursive: true, force: true });
});
