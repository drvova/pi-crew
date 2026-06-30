import { effectiveAutonomousConfig, type PiTeamsAutonomousConfig, type PiTeamsConfig, parseConfig } from "../../config/config.ts";

const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** Recursively strip dangerous prototype-pollution keys from all levels of an object. */
export function sanitizeObject<T>(obj: T): T {
	if (obj === null || obj === undefined || typeof obj !== "object") return obj;
	if (Array.isArray(obj)) return obj.map((item) => sanitizeObject(item)) as T;
	const safe: Record<string, unknown> = {};
	for (const key of Object.keys(obj as Record<string, unknown>)) {
		if (DANGEROUS_KEYS.has(key)) continue;
		safe[key] = sanitizeObject((obj as Record<string, unknown>)[key]);
	}
	return safe as T;
}

export function autonomousPatchFromConfig(config: unknown): PiTeamsAutonomousConfig {
	const rootPatch = parseConfig(config).autonomous;
	if (rootPatch) return rootPatch;
	return parseConfig({ autonomous: config }).autonomous ?? {};
}

export function configPatchFromConfig(config: unknown): PiTeamsConfig {
	return parseConfig(config);
}

export function effectiveRunConfig(base: PiTeamsConfig, rawOverride: unknown): PiTeamsConfig {
	const patch = sanitizeObject(parseConfig(rawOverride));
	return {
		...base,
		...patch,
		limits: patch.limits ? { ...(base.limits ?? {}), ...patch.limits } : base.limits,
		runtime: patch.runtime ? { ...(base.runtime ?? {}), ...patch.runtime } : base.runtime,
		control: patch.control ? { ...(base.control ?? {}), ...patch.control } : base.control,
		worktree: patch.worktree ? { ...(base.worktree ?? {}), ...patch.worktree } : base.worktree,
	};
}

export function formatAutonomyStatus(config: PiTeamsAutonomousConfig | undefined, pathValue: string, updated: boolean): string {
	const effective = effectiveAutonomousConfig(config);
	return [
		updated ? "Updated pi-crew autonomous mode." : "pi-crew autonomous mode:",
		`Path: ${pathValue}`,
		`Profile: ${effective.profile}`,
		`Enabled: ${effective.enabled}`,
		`Inject policy: ${effective.injectPolicy}`,
		`Prefer async for long tasks: ${effective.preferAsyncForLongTasks}`,
		`Allow worktree suggestion: ${effective.allowWorktreeSuggestion}`,
	].join("\n");
}
