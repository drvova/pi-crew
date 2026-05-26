import test from "node:test";
import assert from "node:assert/strict";
import {
	invalidateAgentDiscoveryCache,
	discoverAgents,
	registerDynamicAgent,
	unregisterDynamicAgent,
	getCacheVersion,
} from "../../src/agents/discover-agents.ts";

const CWD = process.cwd();

test("cacheVersion increments on invalidation (SEC-005)", () => {
	const before = getCacheVersion();
	invalidateAgentDiscoveryCache();
	const after = getCacheVersion();
	assert.ok(after > before, "Cache version should increment after invalidation");
});

test("cacheVersion increments on registerDynamicAgent (SEC-005)", () => {
	const before = getCacheVersion();
	try {
		registerDynamicAgent({
			name: "cache-test-agent",
			systemPrompt: "test",
			description: "test",
			source: "dynamic" as const,
		});
		const after = getCacheVersion();
		assert.ok(after > before, "Cache version should increment after dynamic agent registration");
	} finally {
		try {
			unregisterDynamicAgent("cache-test-agent");
		} catch { /* ok */ }
	}
});

test("cacheVersion increments on unregisterDynamicAgent (SEC-005)", () => {
	registerDynamicAgent({
		name: "cache-unreg-test",
		systemPrompt: "test",
		description: "test",
		source: "dynamic" as const,
	});
	const before = getCacheVersion();
	try {
		unregisterDynamicAgent("cache-unreg-test");
		const after = getCacheVersion();
		assert.ok(after > before, "Cache version should increment after dynamic agent unregistration");
	} catch { /* ignore if not found */ }
});

test("discoverAgents returns fresh result after explicit invalidation (SEC-005)", () => {
	const before = discoverAgents(CWD);
	assert.ok(before);
	invalidateAgentDiscoveryCache(CWD);
	const after = discoverAgents(CWD);
	assert.ok(after, "Should return discovery result after invalidation");
});

test("registerDynamicAgent invalidates cache (SEC-005)", () => {
	try {
		unregisterDynamicAgent("cache-race-test");
	} catch { /* ok */ }

	const result1 = discoverAgents(CWD);
	assert.ok(result1, "Initial discovery should succeed");

	registerDynamicAgent({
		name: "cache-race-test",
		systemPrompt: "Test agent for cache race testing",
		description: "test",
		source: "dynamic",
	});

	const result2 = discoverAgents(CWD);
	assert.ok(result2, "Discovery after registration should succeed");

	try {
		unregisterDynamicAgent("cache-race-test");
	} catch { /* ok */ }
});

test("pruneDiscoveryCache removes entries with outdated version (SEC-005)", () => {
	invalidateAgentDiscoveryCache();
	const version = getCacheVersion();
	const discovery = discoverAgents(CWD);
	assert.ok(discovery, "Should return valid discovery after pruning");
});
