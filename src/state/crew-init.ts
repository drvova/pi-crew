/**
 * Auto-initialize .crew directory structure and .gitignore entries.
 * Called on first team run in a workspace to ensure all required
 * directories and files exist.
 *
 * IMPORTANT: This module must be COMPLETELY self-contained with NO dependencies
 * on other pi-crew modules (especially paths.ts). It is called via dynamic
 * import from child-process contexts (background runners, subagents) where
 * module binding can fail. Keep this file minimal and self-contained.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { updateGitignore } from "./gitignore-manager.ts";

// Re-export updateGitignore for backwards compatibility with tests.
export { updateGitignore };

/** README content for the .crew directory. */
const CREW_README = `# .crew — pi-crew Runtime Directory

This directory contains pi-crew runtime state and artifacts.

## What's Here

| Directory | Purpose | Commit? |
|-----------|---------|---------|
| \`state/runs/\` | Run manifests, tasks, events | No |
| \`state/subagents/\` | Subagent state | No |
| \`artifacts/\` | Run outputs (test files, docs, etc.) | Optional |
| \`cache/\` | Cached run results (fingerprint-based) | No |
| \`graphs/\` | Archived run graphs | Optional |
| \`audit/\` | Security event logs | No |

## Cleanup

To prune old runs:
\`\`\`bash
team action='prune' keep=5
\`\`\`

To clear cache:
\`\`\`bash
team action='cache' action='clear'
\`\`\`
`;

/**
 * Find the project root by walking up from start directory.
 * Inline implementation to avoid module dependency on paths.ts.
 * Matches the logic in src/utils/paths.ts:computeRepoRoot().
 */
function findProjectRoot(start: string): string | undefined {
	const dirMarkers = [".git", ".hg", ".svn"];
	const fileMarkers = ["package.json", "pyproject.toml", "Cargo.toml", "go.mod"];
	const root = path.parse(start).root;
	let current = path.resolve(start);
	// Walk up to find project root
	while (current !== root) {
		for (const marker of dirMarkers) {
			if (fs.existsSync(path.join(current, marker))) return current;
		}
		for (const marker of fileMarkers) {
			if (fs.existsSync(path.join(current, marker))) return current;
		}
		const parent = path.dirname(current);
		if (parent === current) break;
		current = parent;
	}
	// Check root as fallback
	if (dirMarkers.some((m) => fs.existsSync(path.join(root, m)))) return root;
	return undefined;
}

/**
 * Compute the crew root directory for a given working directory.
 * Matches src/utils/paths.ts:projectCrewRoot() logic.
 */
function computeCrewRoot(cwd: string): string {
	const repoRoot = findProjectRoot(cwd) ?? cwd;
	const crewDir = path.join(repoRoot, ".crew");
	// Keep existing .crew/ stable even when .pi/ exists for project config.
	if (fs.existsSync(crewDir)) return crewDir;
	// Legacy reuse: if .pi/ already exists, namespace under .pi/teams/
	const piDir = path.join(repoRoot, ".pi");
	return fs.existsSync(piDir) ? path.join(piDir, "teams") : crewDir;
}

/**
 * Ensure the .crew directory structure exists with all required subdirectories,
 * placeholder files, README, and .gitignore entries.
 *
 * This function is self-contained with NO dependencies on other pi-crew modules.
 * It uses inline implementations of findProjectRoot and computeCrewRoot to avoid
 * module binding issues in child-process contexts.
 */
export async function ensureCrewDirectory(cwd: string): Promise<void> {
	const crewRoot = computeCrewRoot(cwd);

	// 1. Create directory structure
	const dirs = [
		crewRoot,
		path.join(crewRoot, "state", "runs"),
		path.join(crewRoot, "state", "subagents"),
		path.join(crewRoot, "artifacts"),
		path.join(crewRoot, "cache"),
		path.join(crewRoot, "graphs"),
		path.join(crewRoot, "audit"),
	];

	for (const dir of dirs) {
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true });
		}
	}

	// 2. Create .gitkeep placeholders in directories that should be tracked
	const placeholders = [
		path.join(crewRoot, "artifacts", ".gitkeep"),
		path.join(crewRoot, "cache", ".gitkeep"),
		path.join(crewRoot, "graphs", ".gitkeep"),
		path.join(crewRoot, "audit", ".gitkeep"),
	];

	for (const placeholder of placeholders) {
		if (!fs.existsSync(placeholder)) {
			fs.writeFileSync(placeholder, "", "utf-8");
		}
	}

	// 3. Write README.md (always overwrite to keep it current)
	fs.writeFileSync(path.join(crewRoot, "README.md"), CREW_README, "utf-8");

	// 4. Update .gitignore at project root
	const repoRoot = findProjectRoot(cwd);
	if (repoRoot) {
		const gitignorePath = path.join(repoRoot, ".gitignore");
		await updateGitignore(gitignorePath);
	}
}