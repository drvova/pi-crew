// watchdog monitored
// Auto-monitored by watchdog
// health monitor support
import * as fs from "node:fs";
import { listRuns } from "../run-index.ts";
import { loadRunManifestById } from "../../state/state-store.ts";
import { readCrewAgents } from "../../runtime/crew-agent-records.ts";
import { isActiveRunStatus, hasStaleAsyncProcess, isLikelyOrphanedActiveRun } from "../../runtime/process-status.ts";
import { result, type TeamContext } from "./context.ts";
import type { TeamToolParamsValue } from "../../schema/team-tool-schema.ts";
import type { PiTeamsToolResult } from "../tool-result.ts";

interface HealthEntry {
	runId: string;
	reason: string;
	detail: string;
}

interface CorruptEntry {
	runId: string;
	reason: string;
}

export function handleHealthMonitor(ctx: TeamContext, _params: TeamToolParamsValue): PiTeamsToolResult {
	const now = Date.now();
	const allRuns = listRuns(ctx.cwd, ctx.signal);
	const ghost: HealthEntry[] = [];
	const orphaned: HealthEntry[] = [];
	const corrupted: CorruptEntry[] = [];

	for (const run of allRuns) {
		// 1. Ghost: active status but cwd no longer exists
		if (isActiveRunStatus(run.status) && run.cwd && !fs.existsSync(run.cwd)) {
			ghost.push({ runId: run.runId, reason: "dead-cwd", detail: `cwd=${run.cwd}` });
			continue;
		}

		// 2. Corrupted: state root or artifacts root missing
		if (!fs.existsSync(run.stateRoot) || !fs.existsSync(run.artifactsRoot)) {
			corrupted.push({ runId: run.runId, reason: "missing-state-or-artifacts" });
			continue;
		}

		// 3. Only check orphan status for active runs
		if (!isActiveRunStatus(run.status)) continue;

		// 4. Orphaned: stale async PID
		if (hasStaleAsyncProcess(run, now)) {
			orphaned.push({ runId: run.runId, reason: "stale-async-pid", detail: `pid=${run.async?.pid}` });
			continue;
		}

		// 5. Orphaned: non-async active run with no recent update
		const agents = readCrewAgents(run);
		if (isLikelyOrphanedActiveRun(run, agents, now)) {
			orphaned.push({ runId: run.runId, reason: "stale-no-progress", detail: `status=${run.status}` });
		}
	}

	const lines: string[] = [
		"pi-crew health report",
		`Scanned: ${allRuns.length} runs`,
		"",
		`Ghost (dead cwd): ${ghost.length}`,
		`Orphaned (stale process): ${orphaned.length}`,
		`Corrupted (missing state): ${corrupted.length}`,
		"",
	];

	if (ghost.length > 0) {
		lines.push("Ghost runs:");
		for (const entry of ghost) {
			lines.push(`  - ${entry.runId}: ${entry.reason} (${entry.detail})`);
		}
		lines.push("");
	}

	if (orphaned.length > 0) {
		lines.push("Orphaned runs:");
		for (const entry of orphaned) {
			lines.push(`  - ${entry.runId}: ${entry.reason} (${entry.detail})`);
		}
		lines.push("");
	}

	if (corrupted.length > 0) {
		lines.push("Corrupted runs:");
		for (const entry of corrupted) {
			lines.push(`  - ${entry.runId}: ${entry.reason}`);
		}
		lines.push("");
	}

	const hasIssues = ghost.length > 0 || orphaned.length > 0 || corrupted.length > 0;

	if (!hasIssues) {
		lines.push("All runs healthy.");
	}

	const text = lines.join("\n");
	return result(text, { action: "health", status: hasIssues ? "error" : "ok" }, hasIssues);
}
