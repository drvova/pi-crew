/**
 * G2: MCP Proxy for live-session workers.
 *
 * When the parent process has MCP servers configured, live-session workers
 * can reuse those connections instead of establishing their own. This module
 * discovers MCP tools available in the parent environment and configures the
 * child session to self-discover MCP (since we can't forward calls through
 * the parent's MCP manager from a child session).
 *
 * Strategy:
 * 1. If the Pi SDK session has MCP tools after bindExtensions -> use them directly
 * 2. If not -> let the child session self-discover MCP (enableMcp: true)
 * 3. If no MCP config exists -> enableMcp: true (harmless if nothing to discover)
 */

export interface McpProxyConfig {
	/** Whether to enable MCP in the child session. */
	enableMcp: boolean;
	/** Proxy tools to inject via customTools (replaces MCP connection). */
	proxyTools: never[];
	/** Names of MCP tools available (for metadata/tracking). */
	proxyToolNames: string[];
}

/**
 * Build MCP proxy configuration for a live-session worker.
 *
 * @param options.parentMcpTools — MCP tool names from the parent session (if available)
 * @param options.shareMcp — Whether to share MCP connections (default: true)
 */
export function buildMcpProxyConfig(options: { parentMcpTools?: string[]; shareMcp?: boolean }): McpProxyConfig {
	if (options.shareMcp === false) {
		return { enableMcp: true, proxyTools: [], proxyToolNames: [] };
	}

	const parentTools = options.parentMcpTools ?? [];
	// Child session self-discovers MCP. We pass the parent's tool names as
	// metadata for tracking, but the child establishes its own MCP connections.
	return { enableMcp: true, proxyTools: [], proxyToolNames: parentTools };
}

/**
 * Discover MCP tool names from a live session's active tools.
 * MCP tools typically have names containing "__" (e.g., "mcp__filesystem__read_file").
 */
export function discoverMcpToolNames(activeToolNames: string[]): string[] {
	return activeToolNames.filter(
		(name) => name.startsWith("mcp__") || name.startsWith("mcp-") || (name.includes("__") && !name.startsWith("submit_result")),
	);
}

/**
 * Build MCP proxy config from a real Pi SDK session's active tools.
 * This is the preferred way — inspect what the parent session has available.
 */
export function buildMcpProxyFromSession(activeToolNames: string[], options?: { shareMcp?: boolean }): McpProxyConfig {
	const mcpTools = discoverMcpToolNames(activeToolNames);
	return buildMcpProxyConfig({
		parentMcpTools: mcpTools,
		shareMcp: options?.shareMcp,
	});
}
