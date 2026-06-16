/**
 * T9 (v0.8.4) — cold-verifier agent (adversarial cross-check).
 *
 * Distilled from piolium's cold-verifier pattern. Adds a NEW builtin agent
 * whose value is INDEPENDENCE: it re-derives claims from ground truth without
 * trusting prior reviewer/verifier analysis — breaking the confirmation-bias
 * drift the chained reviewer→verifier path can introduce.
 *
 * These tests pin: the agent is discovered, parses cleanly, is in the SEC-001
 * protected-names blocklist (can't be shadowed by a dynamic registration), and
 * its system prompt contains the isolation discipline that distinguishes it
 * from the default (correlating) verifier.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import { allAgents, discoverAgents } from "../../src/agents/discover-agents.ts";

const CREW_CWD = fileURLToPath(new URL("../../", import.meta.url));

describe("T9: cold-verifier builtin agent", () => {
	test("cold-verifier is discovered as a builtin agent", () => {
		const agents = allAgents(discoverAgents(CREW_CWD));
		const cold = agents.find((a) => a.name === "cold-verifier");
		assert.ok(cold, "cold-verifier should be discovered");
		assert.equal(cold!.source, "builtin");
	});

	test("cold-verifier parses cleanly (description, systemPrompt, tools)", () => {
		const agents = allAgents(discoverAgents(CREW_CWD));
		const cold = agents.find((a) => a.name === "cold-verifier");
		assert.ok(cold);
		assert.ok(cold!.description.length > 0, "should have a description");
		assert.ok(cold!.systemPrompt.length > 0, "should have a system prompt");
		assert.ok(Array.isArray(cold!.tools), "should parse a tools list");
		// read-only + bash (needs to run tests), but NOT edit/write (it verifies, doesn't fix).
		assert.ok(cold!.tools!.includes("read"));
		assert.ok(cold!.tools!.includes("bash"));
		assert.ok(!cold!.tools!.includes("edit"));
		assert.ok(!cold!.tools!.includes("write"));
	});

	test("cold-verifier system prompt contains the isolation discipline (the T9 differentiator)", () => {
		const agents = allAgents(discoverAgents(CREW_CWD));
		const cold = agents.find((a) => a.name === "cold-verifier");
		assert.ok(cold);
		const prompt = cold!.systemPrompt.toLowerCase();
		// The core cold-verifier discipline: don't trust prior analysis.
		assert.ok(prompt.includes("must not"), "isolation rules must be present");
		assert.ok(prompt.includes("independently") || prompt.includes("independence"), "must emphasize independent re-derivation");
		assert.ok(prompt.includes("confirm") || prompt.includes("refute"), "must instruct to confirm/refute claims");
		// Distinct from the correlating verifier — look for the adversarial framing.
		assert.ok(prompt.includes("confirmation bias") || prompt.includes("contradict"), "must frame around confirmation bias / contradiction");
	});

	test("cold-verifier is in the SEC-001 protected-names blocklist (cannot be shadowed)", () => {
		// The blocklist is module-private; verify via the source text that the
		// name is listed alongside the other protected builtins.
		const src = readFileSync(fileURLToPath(new URL("../../src/agents/discover-agents.ts", import.meta.url)), "utf-8");
		const setBlock = src.match(/PROTECTED_AGENT_NAMES = new Set\(\[([\s\S]*?)\]\)/);
		assert.ok(setBlock, "PROTECTED_AGENT_NAMES set should exist");
		assert.ok(setBlock![1].includes("\"cold-verifier\""), "cold-verifier must be in the protected-names set");
	});

	test("the agent file on disk is well-formed frontmatter + body", () => {
		const raw = readFileSync(fileURLToPath(new URL("../../agents/cold-verifier.md", import.meta.url)), "utf-8");
		assert.ok(/^---\r?\n[\s\S]*?\r?\n---/.test(raw), "should start with frontmatter");
		assert.ok(/^name: cold-verifier$/m.test(raw), "frontmatter name should be cold-verifier");
	});
});
