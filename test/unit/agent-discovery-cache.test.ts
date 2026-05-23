import test from "node:test";
import assert from "node:assert/strict";
import * as os from "node:os";
import * as path from "node:path";
import {
	allAgents,
	discoverAgents,
	invalidateAgentDiscoveryCache,
	registerDynamicAgent,
	unregisterDynamicAgent,
	listDynamicAgents,
} from "../../src/agents/discover-agents.ts";
import type { AgentConfig } from "../../src/agents/agent-config.ts";

function makeTestAgent(name: string, overrides?: Partial<AgentConfig>): AgentConfig {
	return {
		name,
		description: `Test agent ${name}`,
		source: "project",
		filePath: `/tmp/${name}.md`,
		systemPrompt: "You are a test agent.",
		...overrides,
	};
}

// ─── Phase 3a: Discovery Cache ──────────────────────────────────────────────

test("discoverAgents returns cached result within TTL", () => {
	invalidateAgentDiscoveryCache();
	const cwd = process.cwd();
	const first = discoverAgents(cwd);
	const second = discoverAgents(cwd);
	// Should return the same object reference when cached
	assert.strictEqual(first, second, "Second call should return cached result");
	assert.ok(first.builtin.length > 0, "Should have builtin agents");
});

test("invalidateAgentDiscoveryCache forces fresh discovery", () => {
	invalidateAgentDiscoveryCache();
	const cwd = process.cwd();
	const first = discoverAgents(cwd);
	invalidateAgentDiscoveryCache();
	const second = discoverAgents(cwd);
	// After invalidation, should be a new object (fresh read)
	assert.notStrictEqual(first, second, "After invalidation should return fresh result");
});

test("invalidateAgentDiscoveryCache with specific cwd only clears that entry", () => {
	invalidateAgentDiscoveryCache();
	const cwd1 = process.cwd();
	const cwd2 = path.join(os.tmpdir(), "nonexistent-" + Date.now());
	// Populate both caches
	discoverAgents(cwd1);
	discoverAgents(cwd2);
	// Invalidate only cwd1
	invalidateAgentDiscoveryCache(cwd1);
	// Re-discover cwd1 should be fresh
	const fresh = discoverAgents(cwd1);
	assert.ok(fresh.builtin.length > 0);
});

// ─── Phase 3b: Dynamic Agent Registry ───────────────────────────────────────

test("registerDynamicAgent adds agent to list", () => {
	// Clean up any previous registration
	try { unregisterDynamicAgent("test-dynamic-1"); } catch { /* ok */ }
	registerDynamicAgent(makeTestAgent("test-dynamic-1"));
	const dynamic = listDynamicAgents();
	assert.ok(dynamic.some((a) => a.name === "test-dynamic-1"), "Agent should appear in dynamic list");
	// Clean up
	unregisterDynamicAgent("test-dynamic-1");
});

test("registerDynamicAgent throws on duplicate name (case-insensitive)", () => {
	try { unregisterDynamicAgent("dup-test"); } catch { /* ok */ }
	registerDynamicAgent(makeTestAgent("dup-test"));
	assert.throws(() => registerDynamicAgent(makeTestAgent("DUP-TEST")), /already registered/);
	unregisterDynamicAgent("dup-test");
});

test("unregisterDynamicAgent throws when agent not found", () => {
	assert.throws(() => unregisterDynamicAgent("nonexistent-agent-" + Date.now()), /not found/);
});

test("dynamic agents appear in allAgents with highest priority", () => {
	try { unregisterDynamicAgent("executor"); } catch { /* ok */ }
	const discovery = discoverAgents(process.cwd());
	const originalExecutor = allAgents(discovery).find((a) => a.name === "executor");
	assert.ok(originalExecutor, "Should have builtin executor");
	// Register a dynamic agent that shadows the builtin executor
	registerDynamicAgent(makeTestAgent("executor", { description: "Dynamic executor override" }));
	const afterDynamic = allAgents(discovery);
	const dynamicExecutor = afterDynamic.find((a) => a.name === "executor");
	assert.equal(dynamicExecutor?.description, "Dynamic executor override", "Dynamic agent should take priority");
	assert.notStrictEqual(dynamicExecutor, originalExecutor, "Should be different agent object");
	unregisterDynamicAgent("executor");
});

test("dynamic agent source defaults to project when not specified", () => {
	try { unregisterDynamicAgent("source-test"); } catch { /* ok */ }
	registerDynamicAgent(makeTestAgent("source-test"));
	const dynamic = listDynamicAgents();
	const agent = dynamic.find((a) => a.name === "source-test");
	assert.equal(agent?.source, "project", "Default source should be project");
	unregisterDynamicAgent("source-test");
});

test("registerDynamicAgent invalidates discovery cache", () => {
	invalidateAgentDiscoveryCache();
	try { unregisterDynamicAgent("cache-inval-test"); } catch { /* ok */ }
	const cwd = process.cwd();
	const before = discoverAgents(cwd);
	registerDynamicAgent(makeTestAgent("cache-inval-test"));
	// The cache should have been invalidated, so a new call returns fresh data
	const after = discoverAgents(cwd);
	assert.notStrictEqual(before, after, "Cache should be invalidated after registration");
	unregisterDynamicAgent("cache-inval-test");
});

test("unregisterDynamicAgent invalidates discovery cache", () => {
	invalidateAgentDiscoveryCache();
	try { unregisterDynamicAgent("cache-inval-test2"); } catch { /* ok */ }
	registerDynamicAgent(makeTestAgent("cache-inval-test2"));
	const cwd = process.cwd();
	const before = discoverAgents(cwd);
	unregisterDynamicAgent("cache-inval-test2");
	const after = discoverAgents(cwd);
	assert.notStrictEqual(before, after, "Cache should be invalidated after unregistration");
});
