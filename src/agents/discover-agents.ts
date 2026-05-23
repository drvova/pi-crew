import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentConfig, ResourceSource } from "./agent-config.ts";
import { loadConfig, type LoadedPiTeamsConfig } from "../config/config.ts";
import { parseCsv, parseFrontmatter } from "../utils/frontmatter.ts";
import { logInternalError } from "../utils/internal-error.ts";
import { packageRoot, projectCrewRoot, userPiRoot } from "../utils/paths.ts";

export interface AgentDiscoveryResult {
	builtin: AgentConfig[];
	user: AgentConfig[];
	project: AgentConfig[];
}

function parseCost(value: string | undefined): "free" | "cheap" | "expensive" | undefined {
	return value === "free" || value === "cheap" || value === "expensive" ? value : undefined;
}

function parseMemory(value: string | undefined): "user" | "project" | "local" | undefined {
	return value === "user" || value === "project" || value === "local" ? value : undefined;
}

function parseLoadMode(value: string | undefined): "essential" | "lean" | undefined {
	return value === "essential" || value === "lean" ? value : undefined;
}

function parseContextMode(value: string | undefined): "fresh" | "fork" | undefined {
	return value === "fresh" || value === "fork" ? value : undefined;
}

function parseAgentFile(filePath: string, source: ResourceSource): AgentConfig | undefined {
	try {
		const content = fs.readFileSync(filePath, "utf-8");
		const { frontmatter, body } = parseFrontmatter(content);
		const name = frontmatter.name?.trim() || path.basename(filePath, path.extname(filePath));
		const description = frontmatter.description?.trim() || "No description provided.";
		const triggers = parseCsv(frontmatter.triggers ?? frontmatter.trigger);
		const useWhen = parseCsv(frontmatter.useWhen);
		const avoidWhen = parseCsv(frontmatter.avoidWhen);
		const cost = parseCost(frontmatter.cost);
		const category = frontmatter.category?.trim() || undefined;
		return {
			name,
			description,
			source,
			filePath,
			systemPrompt: body.trim(),
			model: frontmatter.model === "false" ? undefined : frontmatter.model || undefined,
			fallbackModels: parseCsv(frontmatter.fallbackModels),
			thinking: frontmatter.thinking === "false" ? undefined : frontmatter.thinking || undefined,
			tools: parseCsv(frontmatter.tools),
			extensions: frontmatter.extensions === "" ? [] : parseCsv(frontmatter.extensions),
			skills: parseCsv(frontmatter.skills ?? frontmatter.skill),
			systemPromptMode: frontmatter.systemPromptMode === "append" ? "append" : "replace",
			inheritProjectContext: frontmatter.inheritProjectContext === "true",
		inheritSkills: frontmatter.inheritSkills === "true",
		memory: parseMemory(frontmatter.memory),
		loadMode: parseLoadMode(frontmatter.loadMode),
		defaultTools: frontmatter.defaultTools !== undefined ? parseCsv(frontmatter.defaultTools) ?? null : undefined,
		contextMode: parseContextMode(frontmatter.contextMode),
		maxTurns: (() => { const n = Number.parseInt(frontmatter.maxTurns, 10); return Number.isFinite(n) && n > 0 ? n : undefined; })(),
		disabled: frontmatter.disabled === "true" || frontmatter.enabled === "false",
		routing: triggers || useWhen || avoidWhen || cost || category ? { triggers, useWhen, avoidWhen, cost, category } : undefined,
		};
	} catch (error) {
		logInternalError("discoverAgents.parseAgentFile", error, `filePath=${filePath}`);
		return undefined;
	}
}

function readAgentDir(dir: string, source: ResourceSource): AgentConfig[] {
	if (!fs.existsSync(dir)) return [];
	return fs.readdirSync(dir)
		.filter((entry) => entry.endsWith(".md") && !entry.endsWith(".team.md") && !entry.endsWith(".workflow.md"))
		.map((entry) => parseAgentFile(path.join(dir, entry), source))
		.filter((agent): agent is AgentConfig => agent !== undefined)
		.sort((a, b) => a.name.localeCompare(b.name));
}

function applyAgentOverrides(agents: AgentConfig[], cwd: string, loadedConfig?: LoadedPiTeamsConfig): AgentConfig[] {
	const loaded = loadedConfig ?? loadConfig(cwd);
	const agentsConfig = loaded.config.agents;
	const overrides = agentsConfig?.overrides ?? {};
	return agents
		.filter((agent) => !(agentsConfig?.disableBuiltins && agent.source === "builtin"))
		.map((agent) => {
			const overrideEntry = Object.entries(overrides).find(([name]) => name.toLowerCase() === agent.name.toLowerCase());
			if (!overrideEntry) return agent;
			const [, override] = overrideEntry;
			return {
				...agent,
				disabled: override.disabled ?? agent.disabled,
				model: override.model === false ? undefined : override.model ?? agent.model,
				fallbackModels: override.fallbackModels === false ? undefined : override.fallbackModels ?? agent.fallbackModels,
				thinking: override.thinking === false ? undefined : override.thinking ?? agent.thinking,
				tools: override.tools === false ? undefined : override.tools ?? agent.tools,
				skills: override.skills === false ? undefined : override.skills ?? agent.skills,
				override: { source: "config", path: loaded.path },
			};
		});
}

// ─── Agent Discovery Cache (Phase 3a) ────────────────────────────────────
// Caches discoverAgents results by cwd with a short TTL to avoid repeated
// disk I/O when multiple callers request agents for the same project.

const DISCOVERY_CACHE_TTL_MS = 500;
const discoveryCache = new Map<string, { result: AgentDiscoveryResult; expiresAt: number }>();
const DISCOVERY_CACHE_MAX_ENTRIES = 32;

function pruneDiscoveryCache(): void {
	const now = Date.now();
	for (const [key, entry] of discoveryCache) {
		if (entry.expiresAt <= now) discoveryCache.delete(key);
	}
}

/** Invalidate cached discovery result for a given cwd (or all if omitted). */
export function invalidateAgentDiscoveryCache(cwd?: string): void {
	if (cwd) {
		discoveryCache.delete(cwd);
	} else {
		discoveryCache.clear();
	}
}

export function discoverAgents(cwd: string): AgentDiscoveryResult {
	pruneDiscoveryCache();
	const cached = discoveryCache.get(cwd);
	if (cached && cached.expiresAt > Date.now()) {
		return cached.result;
	}
	const loaded = loadConfig(cwd);
	const result: AgentDiscoveryResult = {
		builtin: applyAgentOverrides(readAgentDir(path.join(packageRoot(), "agents"), "builtin"), cwd, loaded),
		user: applyAgentOverrides(readAgentDir(path.join(userPiRoot(), "agents"), "user"), cwd, loaded),
		project: applyAgentOverrides(readAgentDir(path.join(projectCrewRoot(cwd), "agents"), "project"), cwd, loaded),
	};
	discoveryCache.set(cwd, { result, expiresAt: Date.now() + DISCOVERY_CACHE_TTL_MS });
	while (discoveryCache.size > DISCOVERY_CACHE_MAX_ENTRIES) {
		const oldest = discoveryCache.keys().next().value;
		if (oldest !== undefined) discoveryCache.delete(oldest);
	}
	return result;
}

// ─── Dynamic Agent Registry (Phase 3b) ───────────────────────────────────
// In-memory store for runtime-registered agents. Merged into discovery results
// with highest priority (after project agents).

const dynamicAgents = new Map<string, AgentConfig>();

/** Register a dynamic agent at runtime. Throws if already registered. */
export function registerDynamicAgent(config: AgentConfig): void {
	const key = config.name.toLowerCase();
	if (dynamicAgents.has(key)) {
		throw new Error(`Agent already registered: ${config.name}`);
	}
	dynamicAgents.set(key, { ...config, source: config.source ?? "project" });
	invalidateAgentDiscoveryCache();
}

/** Unregister a previously registered dynamic agent. Throws if not found. */
export function unregisterDynamicAgent(name: string): void {
	const removed = dynamicAgents.delete(name.toLowerCase());
	if (!removed) {
		throw new Error(`Agent not found: ${name}`);
	}
	invalidateAgentDiscoveryCache();
}

/** List all currently registered dynamic agents. */
export function listDynamicAgents(): AgentConfig[] {
	return [...dynamicAgents.values()];
}

export function allAgents(discovery: AgentDiscoveryResult): AgentConfig[] {
	const byName = new Map<string, AgentConfig>();
	// Priority for disambiguation (security): project < builtin < user.
	// Project config cannot override trusted builtins (security-hardening).
	// Later entries in the loop overwrite earlier ones, so user wins.
	for (const agent of [...discovery.project, ...discovery.builtin, ...discovery.user]) {
		byName.set(agent.name.toLowerCase(), agent);
	}
	// Dynamic agents (registered at runtime) take highest precedence.
	// They can override any discovered agent (project/builtin/user).
	for (const agent of dynamicAgents.values()) {
		byName.set(agent.name.toLowerCase(), agent);
	}
	return [...byName.values()].filter((agent) => !agent.disabled).sort((a, b) => a.name.localeCompare(b.name));
}
