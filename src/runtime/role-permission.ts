export type RolePermissionMode = "read_only" | "workspace_write" | "danger_full_access" | "explicit_confirm";

// Read-only roles: cannot mutate files/source. `verifier` is NOT here — it runs
// tests (bash + cache writes) so it is a WRITE role (F4). `planner` stays
// read-only to preserve the plan-approval gate boundary (F3).
const READ_ONLY_ROLES = new Set(["explorer", "reviewer", "security-reviewer", "analyst", "critic", "planner"]);
const WRITE_ROLES = new Set(["executor", "test-engineer", "writer", "verifier"]);
export interface PermissionCheckResult {
	allowed: boolean;
	mode: RolePermissionMode;
	reason?: string;
}

export function permissionForRole(role: string): RolePermissionMode {
	if (READ_ONLY_ROLES.has(role)) return "read_only";
	if (WRITE_ROLES.has(role)) return "workspace_write";
	return "workspace_write";
}

export function currentCrewRole(env: NodeJS.ProcessEnv = process.env): string | undefined {
	return env.PI_CREW_ROLE?.trim() || env.PI_TEAMS_ROLE?.trim() || undefined;
}

export function checkSubagentSpawnPermission(role: string | undefined): PermissionCheckResult {
	if (!role) return { allowed: true, mode: "workspace_write" };
	const mode = permissionForRole(role);
	if (mode === "read_only")
		return {
			allowed: false,
			mode,
			reason: `Role '${role}' is read-only and cannot spawn additional subagents.`,
		};
	return { allowed: true, mode };
}
