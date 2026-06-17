import * as fs from "node:fs";
import type { TeamToolParamsValue } from "../../schema/team-tool-schema.ts";
import { appendEvent } from "../../state/event-log.ts";
import { loadRunManifestById } from "../../state/state-store.ts";
import { cleanupRunWorktrees } from "../../worktree/cleanup.ts";
import { listImportedRuns } from "../import-index.ts";
import { exportRunBundle } from "../run-export.ts";
import { importRunBundle } from "../run-import.ts";
import { pruneFinishedRuns } from "../run-maintenance.ts";
import type { PiTeamsToolResult } from "../tool-result.ts";
import { configRecord, result, type TeamContext } from "./context.ts";
import { RUN_NOT_FOUND_HINT } from "./run-not-found.ts";
import { enforceDestructiveIntent, intentFromConfig } from "./intent-policy.ts";
import { executeHook, appendHookEvent } from "../../hooks/registry.ts";
import { resolveRealContainedPath } from "../../utils/safe-paths.ts";
import { projectCrewRoot, userCrewRoot } from "../../utils/paths.ts";
import { removeGuidance } from "../../config/markers.ts";
import * as path from "node:path";

export function handleWorktrees(params: TeamToolParamsValue, ctx: TeamContext): PiTeamsToolResult {
	if (!params.runId) return result("Worktrees requires runId.", { action: "worktrees", status: "error" }, true);
	const loaded = loadRunManifestById(ctx.cwd, params.runId); // NOTE: no withRunLock - best-effort only; concurrent writes may cause inconsistency
	if (!loaded) return result(`Run '${params.runId}' not found.${RUN_NOT_FOUND_HINT}`, { action: "worktrees", status: "error" }, true);
	const withWorktrees = loaded.tasks.filter((task) => task.worktree);
	const lines = [`Worktrees for ${loaded.manifest.runId}:`, ...(withWorktrees.length ? withWorktrees.map((task) => `- ${task.id}: ${task.worktree!.path} branch=${task.worktree!.branch} reused=${task.worktree!.reused ? "true" : "false"}`) : ["- (none)"])];
	return result(lines.join("\n"), { action: "worktrees", status: "ok", runId: loaded.manifest.runId, artifactsRoot: loaded.manifest.artifactsRoot });
}

export function handleImports(_params: TeamToolParamsValue, ctx: TeamContext): PiTeamsToolResult {
	const imports = listImportedRuns(ctx.cwd);
	const lines = ["Imported pi-crew runs:", ...(imports.length ? imports.map((entry) => `- ${entry.runId} (${entry.scope})${entry.status ? ` [${entry.status}]` : ""} ${entry.team ?? "unknown"}/${entry.workflow ?? "none"}: ${entry.goal ?? ""}\n  Bundle: ${entry.bundlePath}\n  Summary: ${entry.summaryPath}`) : ["- (none)"])];
	return result(lines.join("\n"), { action: "imports", status: "ok" });
}

export function handleImport(params: TeamToolParamsValue, ctx: TeamContext): PiTeamsToolResult {
	const cfg = configRecord(params.config);
	const bundlePath = typeof cfg.path === "string" ? cfg.path : typeof cfg.bundlePath === "string" ? cfg.bundlePath : undefined;
	if (!bundlePath) return result("Import requires config.path pointing at run-export.json.", { action: "import", status: "error" }, true);
	const scope = cfg.scope === "user" ? "user" : "project";
	try {
		const imported = importRunBundle(ctx.cwd, bundlePath, scope);
		return result([`Imported run bundle ${imported.runId}.`, `Bundle: ${imported.bundlePath}`, `Summary: ${imported.summaryPath}`].join("\n"), { action: "import", status: "ok" });
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return result(`Import failed: ${message}`, { action: "import", status: "error" }, true);
	}
}

export async function handleExport(params: TeamToolParamsValue, ctx: TeamContext): Promise<PiTeamsToolResult> {
	if (!params.runId) return result("Export requires runId.", { action: "export", status: "error" }, true);
	const loaded = loadRunManifestById(ctx.cwd, params.runId); // NOTE: no withRunLock - best-effort only; concurrent writes may cause inconsistency
	if (!loaded) return result(`Run '${params.runId}' not found.${RUN_NOT_FOUND_HINT}`, { action: "export", status: "error" }, true);

	// SECURITY: Ownership check — only the owner session may export a run.
	// Foreign-run export requires confirm: true (explicit user intent).
	// Risk: exported bundles may contain sensitive data from another session's run.
	const foreignRun = typeof loaded.manifest.ownerSessionId === "string" && loaded.manifest.ownerSessionId !== ctx.sessionId;
	if (foreignRun && !params.confirm) {
		return result(`Run ${loaded.manifest.runId} belongs to another session. Use confirm: true to export anyway.`, { action: "export", status: "error", runId: loaded.manifest.runId }, true);
	}

	const hookReport = await executeHook("before_publish", { runId: loaded.manifest.runId, cwd: ctx.cwd });
	appendHookEvent(loaded.manifest, hookReport);
	if (hookReport.outcome === "block") {
		return result(`Export blocked by hook: ${hookReport.reason ?? "before_publish hook blocked the operation."}`, { action: "export", status: "error", runId: loaded.manifest.runId }, true);
	}

	const exported = exportRunBundle(loaded.manifest, loaded.tasks);
	appendEvent(loaded.manifest.eventsPath, { type: "run.exported", runId: loaded.manifest.runId, data: exported });
	return result([`Exported run ${loaded.manifest.runId}.`, `JSON: ${exported.jsonPath}`, `Markdown: ${exported.markdownPath}`].join("\n"), { action: "export", status: "ok", runId: loaded.manifest.runId, artifactsRoot: loaded.manifest.artifactsRoot });
}

// Note: handlePrune has no ownership check — intentionally cross-session.
// Prune is a maintenance-level operation that removes ALL finished runs
// regardless of which session created them. Requires confirm: true.
export async function handlePrune(params: TeamToolParamsValue, ctx: TeamContext): Promise<PiTeamsToolResult> {
	const intentError = enforceDestructiveIntent("prune", params, ctx.config);
	if (intentError) return intentError;
	if (!params.confirm) return result("prune requires confirm: true.", { action: "prune", status: "error" }, true);
	const keep = params.keep ?? 20;
	if (keep < 0 || !Number.isInteger(keep)) return result("keep must be an integer >= 0.", { action: "prune", status: "error" }, true);
	const intent = intentFromConfig(params.config);
	const pruned = pruneFinishedRuns(ctx.cwd, keep, { intent, signal: ctx.signal });
	// Fire hook once with all removed run IDs for batch visibility
	if (pruned.removed.length > 0) {
		const sampleManifest = loadRunManifestById(ctx.cwd, pruned.removed[0])?.manifest;
		if (sampleManifest) {
			const hookReport = await executeHook("before_cleanup", { runId: sampleManifest.runId, cwd: ctx.cwd, data: { removedRunIds: pruned.removed, keptCount: pruned.kept.length } });
			appendHookEvent(sampleManifest, hookReport);
		}
	}
	return result([`Pruned finished pi-crew runs.`, `Kept: ${pruned.kept.length}`, `Removed: ${pruned.removed.length}`, ...(pruned.auditPath ? [`Audit: ${pruned.auditPath}`] : []), ...(pruned.removed.length ? ["Removed runs:", ...pruned.removed.map((runId) => `- ${runId}`)] : [])].join("\n"), { action: "prune", status: "ok", intent });
}

export async function handleForget(params: TeamToolParamsValue, ctx: TeamContext): Promise<PiTeamsToolResult> {
	const intentError = enforceDestructiveIntent("forget", params, ctx.config);
	if (intentError) return intentError;
	if (!params.runId) return result("Forget requires runId.", { action: "forget", status: "error" }, true);
	if (!params.confirm) return result("forget requires confirm: true.", { action: "forget", status: "error" }, true);
	const loaded = loadRunManifestById(ctx.cwd, params.runId); // NOTE: no withRunLock - best-effort only; concurrent writes may cause inconsistency
	if (!loaded) return result(`Run '${params.runId}' not found.${RUN_NOT_FOUND_HINT}`, { action: "forget", status: "error" }, true);

	// Ownership check — prevent cross-session deletion unless force is set
	const foreignRun = typeof loaded.manifest.ownerSessionId === "string" && loaded.manifest.ownerSessionId !== ctx.sessionId;
	if (foreignRun && !params.force) return result(`Run ${params.runId} belongs to another session. Use force: true to override.`, { action: "forget", status: "error", runId: loaded.manifest.runId }, true);

	const hookReport = await executeHook("before_forget", { runId: loaded.manifest.runId, cwd: ctx.cwd });
	appendHookEvent(loaded.manifest, hookReport);
	if (hookReport.outcome === "block") {
		return result(`Forget blocked by hook: ${hookReport.reason ?? "before_forget hook blocked the operation."}`, { action: "forget", status: "error", runId: loaded.manifest.runId }, true);
	}

	const cleanup = cleanupRunWorktrees(loaded.manifest, { force: params.force });
	if (cleanup.preserved.length > 0 && !params.force) return result([`Run '${params.runId}' has preserved worktrees. Use force: true to forget anyway.`, ...cleanup.preserved.map((item) => `- ${item.path}: ${item.reason}`)].join("\n"), { action: "forget", status: "error", runId: loaded.manifest.runId, artifactsRoot: loaded.manifest.artifactsRoot }, true);
	const intent = intentFromConfig(params.config);
	appendEvent(loaded.manifest.eventsPath, { type: "run.forget_requested", runId: loaded.manifest.runId, message: "Run state and artifacts are being forgotten.", data: { force: params.force === true, removedWorktrees: cleanup.removed, preservedWorktrees: cleanup.preserved, intent } });
	// Determine scope from manifest paths (project vs user-level runs)
	const crewRoot = loaded.manifest.stateRoot.startsWith(userCrewRoot() + path.sep) ? userCrewRoot() : projectCrewRoot(loaded.manifest.cwd);
	const resolvedStateRoot = resolveRealContainedPath(crewRoot, loaded.manifest.stateRoot);
	const resolvedArtifactsRoot = resolveRealContainedPath(crewRoot, loaded.manifest.artifactsRoot);
	fs.rmSync(resolvedStateRoot, { recursive: true, force: true });
	fs.rmSync(resolvedArtifactsRoot, { recursive: true, force: true });
	return result([`Forgot run ${loaded.manifest.runId}.`, `Removed state: ${loaded.manifest.stateRoot}`, `Removed artifacts: ${loaded.manifest.artifactsRoot}`, ...(cleanup.removed.length ? ["Removed worktrees:", ...cleanup.removed.map((item) => `- ${item}`)] : [])].join("\n"), { action: "forget", status: "ok", runId: loaded.manifest.runId, intent });
}

export async function handleCleanup(params: TeamToolParamsValue, ctx: TeamContext): Promise<PiTeamsToolResult> {
	// Intent policy applies to the cleanup action in BOTH modes (per-run and
	// project-level). Checked once here so handleRunCleanup/handleProjectCleanup
	// can stay focused on their own logic.
	const intentError = enforceDestructiveIntent("cleanup", params, ctx.config);
	if (intentError) return intentError;
	// Two cleanup modes:
	//  1. WITH runId    → per-run worktree cleanup (existing behavior).
	//  2. WITHOUT runId → PROJECT-LEVEL uninstall cleanup: removes the
	//     AGENTS.md guidance block pi-crew injected (`team action=init`) and
	//     optionally the `.crew/` state dir. Use this before/after
	//     `pi uninstall npm:pi-crew` to leave the project pristine.
	//     Issue #35: pi doesn't fire an uninstall hook for extensions, so this
	//     mode is the documented way to reverse an init.
	if (params.runId) {
		return handleRunCleanup(params, ctx);
	}
	return handleProjectCleanup(params, ctx);
}

/**
 * Project-level uninstall cleanup (no runId). Reverses `team action=init`:
 * removes the pi-crew guidance block from AGENTS.md (marker-delimited, so
 * user content is untouched) and, with `force: true`, removes the `.crew/`
 * runtime state directory. `dryRun: true` previews without writing.
 *
 * Safety:
 *  - `removeGuidance` only touches content between the PI-CREW markers.
 *  - `.crew/` removal requires explicit `force: true` (it holds run history,
 *    artifacts, and worktrees — irreversible). Default is guidance-only.
 *  - The user pi-crew user dir (`~/.pi/agent/extensions/pi-crew/`) is NEVER
 *    touched here — `pi uninstall` owns that; we only touch project state.
 */
function handleProjectCleanup(params: TeamToolParamsValue, ctx: TeamContext): PiTeamsToolResult {
	const cwd = ctx.cwd;
	const dryRun = params.dryRun === true;
	const removeState = params.force === true;
	const scope = typeof params.scope === "string" ? params.scope : "project";
	if (scope !== "project") {
		return result(
			`Project cleanup operates on the project only (got scope='${scope}'). ` +
				`User-scope files are owned by 'pi uninstall npm:pi-crew'.`,
			{ action: "cleanup", status: "error", scope },
			true,
		);
	}

	const lines: string[] = ["Project cleanup for pi-crew:"];

	// 1. Remove the AGENTS.md guidance block (marker-delimited → user content preserved).
	const guidancePath = path.join(cwd, "AGENTS.md");
	const guidanceResult = dryRun
		? { path: guidancePath, modified: fs.existsSync(guidancePath), added: [], removed: dryRunRemovedIds(guidancePath) }
		: removeGuidance(guidancePath);
	lines.push("AGENTS.md guidance block:");
	if (guidanceResult.modified) {
		lines.push(`  - ${dryRun ? "would remove" : "removed"}: ${guidanceResult.removed.length ? guidanceResult.removed.join(", ") : "(marker section)"}`);
	} else {
		lines.push("  - (no pi-crew marker section found — nothing to do)");
	}

	// 2. Optionally remove the .crew/ runtime state directory (force: true).
	const crewRoot = projectCrewRoot(cwd);
	lines.push(".crew/ state directory:");
	const crewExists = fs.existsSync(crewRoot);
	if (!crewExists) {
		lines.push(`  - (not present at ${crewRoot} — nothing to do)`);
	} else if (!removeState) {
		lines.push(`  - present at ${crewRoot} (preserved — use force: true to remove; contains run history/artifacts/worktrees and is irreversible)`);
	} else {
		// SAFETY: realpath + contain-check before rmSync, so a crafted cwd can't
		// trick us into deleting an arbitrary directory.
		let resolved: string;
		try {
			resolved = fs.realpathSync.native(crewRoot);
		} catch {
			lines.push(`  - ERROR: could not resolve ${crewRoot} (skipped)`);
			return result(lines.join("\n"), { action: "cleanup", status: "ok", scope }, false);
		}
		if (!resolved.endsWith(path.sep + ".crew") && !resolved.endsWith("/teams") && path.basename(resolved) !== ".crew") {
			lines.push(`  - ERROR: refused to remove ${resolved} (does not look like a .crew dir) — skipped`);
		} else {
			if (!dryRun) {
				try {
					fs.rmSync(resolved, { recursive: true, force: true });
				} catch (e) {
					lines.push(`  - ERROR removing ${resolved}: ${(e as Error).message}`);
				}
			}
			lines.push(`  - ${dryRun ? "would remove" : "removed"}: ${resolved}`);
		}
	}

	lines.push("");
	lines.push(
		dryRun
			? "(dry-run preview — no files were changed. Re-run without dryRun to apply.)"
			: "Done. To fully remove pi-crew, also run: pi uninstall npm:pi-crew",
	);
	return result(lines.join("\n"), { action: "cleanup", status: "ok", scope }, false);
}

/** Dry-run helper: read what removeGuidance WOULD remove without writing. */
function dryRunRemovedIds(guidancePath: string): string[] {
	try {
		if (!fs.existsSync(guidancePath)) return [];
		const content = fs.readFileSync(guidancePath, "utf-8");
		const startIdx = content.indexOf("<!-- PI-CREW:GUIDANCE:START -->");
		const endIdx = content.indexOf("<!-- PI-CREW:GUIDANCE:END -->");
		if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) return [];
		// Cheap approximation: report the marker section as a unit. Exact block
		// IDs aren't needed for the dry-run summary; the non-dryRun path uses
		// removeGuidance which returns the precise removed IDs.
		return ["pi-crew-overview", "pi-crew-commands"];
	} catch {
		return [];
	}
}

/** Per-run worktree cleanup (existing behavior, preserved). */
async function handleRunCleanup(params: TeamToolParamsValue, ctx: TeamContext): Promise<PiTeamsToolResult> {
	const loaded = loadRunManifestById(ctx.cwd, params.runId!); // NOTE: no withRunLock - best-effort only; concurrent writes may cause inconsistency
	if (!loaded) return result(`Run '${params.runId}' not found.${RUN_NOT_FOUND_HINT}`, { action: "cleanup", status: "error", runId: params.runId }, true);
	// Ownership check — prevent cross-session worktree cleanup unless force is set
	const foreignRun = typeof loaded.manifest.ownerSessionId === "string" && loaded.manifest.ownerSessionId !== ctx.sessionId;
	if (foreignRun && !params.force) return result(`Run ${params.runId} belongs to another session. Use force: true to override.`, { action: "cleanup", status: "error", runId: loaded.manifest.runId }, true);

	const hookReport = await executeHook("before_cleanup", { runId: loaded.manifest.runId, cwd: ctx.cwd });
	appendHookEvent(loaded.manifest, hookReport);
	if (hookReport.outcome === "block") {
		return result(`Cleanup blocked by hook: ${hookReport.reason ?? "before_cleanup hook blocked the operation."}`, { action: "cleanup", status: "error", runId: loaded.manifest.runId }, true);
	}

	const cleanup = cleanupRunWorktrees(loaded.manifest, { force: params.force, signal: ctx.signal });
	const intent = intentFromConfig(params.config);
	appendEvent(loaded.manifest.eventsPath, { type: "worktree.cleanup", runId: loaded.manifest.runId, data: { removed: cleanup.removed, preserved: cleanup.preserved, artifacts: cleanup.artifactPaths, intent } });
	const lines = [`Worktree cleanup for ${loaded.manifest.runId}:`, "Removed:", ...(cleanup.removed.length ? cleanup.removed.map((item) => `- ${item}`) : ["- (none)"]), "Preserved:", ...(cleanup.preserved.length ? cleanup.preserved.map((item) => `- ${item.path}: ${item.reason}`) : ["- (none)"]), "Artifacts:", ...(cleanup.artifactPaths.length ? cleanup.artifactPaths.map((item) => `- ${item}`) : ["- (none)"])];
	return result(lines.join("\n"), { action: "cleanup", status: "ok", runId: loaded.manifest.runId, artifactsRoot: loaded.manifest.artifactsRoot, intent });
}
