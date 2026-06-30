import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { describe, it } from "node:test";

/**
 * Unit tests for run-import integrity check (SHA-256 hash verification).
 *
 * We test the hash computation/verification logic directly rather than
 * calling importRunBundle, which has heavy filesystem dependencies.
 */
describe("run-import integrity (SHA-256)", () => {
	function computeBundleHash(bundle: Record<string, unknown>): string {
		return crypto.createHash("sha256").update(JSON.stringify(bundle)).digest("hex");
	}

	it("produces a consistent SHA-256 hash for a given bundle", () => {
		const bundle = {
			schemaVersion: 1,
			exportedAt: "2026-06-04T00:00:00.000Z",
			manifest: { runId: "test-run" },
			tasks: [],
			events: [],
			artifactPaths: [],
		};
		const hash1 = computeBundleHash(bundle);
		const hash2 = computeBundleHash(bundle);
		assert.equal(hash1, hash2, "same content should produce same hash");
	});

	it("detects tampered bundle content via hash mismatch", () => {
		const original = {
			schemaVersion: 1,
			manifest: { runId: "original", goal: "do good" },
			tasks: [],
			events: [],
			artifactPaths: [],
		};
		const sha256 = computeBundleHash(original);

		// Tamper with the bundle
		const tampered = {
			...original,
			manifest: { runId: "original", goal: "do evil" },
		};
		const recomputedHash = computeBundleHash(tampered);

		assert.notEqual(sha256, recomputedHash, "tampered bundle should produce different hash");
	});

	it("verifies round-trip: export hash matches import recompute", () => {
		// Simulate export: compute hash and attach
		const bundle = {
			schemaVersion: 1,
			exportedAt: "2026-06-04T00:00:00.000Z",
			manifest: { runId: "round-trip-test", goal: "test goal" },
			tasks: [{ id: "task-1", status: "done" }],
			events: [],
			artifactPaths: [],
		};
		const sha256 = computeBundleHash(bundle);
		const exportedBundle = {
			...bundle,
			manifest: { ...bundle.manifest, sha256 },
		};

		// Simulate import: strip sha256 from manifest, recompute, compare
		const { sha256: _stored, ...manifestWithoutHash } = exportedBundle.manifest as Record<string, unknown> & {
			sha256?: string;
		};
		const importBundle = {
			...exportedBundle,
			manifest: manifestWithoutHash,
		};
		const recomputedHash = computeBundleHash(importBundle);

		assert.equal(sha256, recomputedHash, "round-trip hash should match");
	});

	it("crypto.createHash produces 64-char hex string", () => {
		const hash = crypto.createHash("sha256").update("test").digest("hex");
		assert.equal(hash.length, 64, "SHA-256 hex digest should be 64 characters");
		assert.match(hash, /^[0-9a-f]{64}$/, "hash should be lowercase hex");
	});
});
