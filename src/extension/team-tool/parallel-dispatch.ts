/**
 * Parallel dispatch handler — accepts an array of independent tasks
 * and spawns them as concurrent background agents.
 *
 * Solves the host-agent limitation of only being able to emit
 * one Agent() call per response turn. By calling `action=parallel`
 * once with multiple tasks, the system handles fanout automatically.
 */
import { discoverAgents } from "../../agents/discover-agents.ts";
import { loadConfig } from "../../config/config.ts";
import type { TeamToolParamsValue } from "../../schema/team-tool-schema.ts";
import { createRunManifest } from "../../state/state-store.ts";
import { appendEvent } from "../../state/event-log.ts";
import { spawnBackgroundTeamRun } from "../../subagents/async-entry.ts";
import { resolveCrewRuntime } from "../../runtime/runtime-resolver.ts";
import { result, type TeamContext } from "./context.ts";
import type { PiTeamsToolResult } from "../tool-result.ts";
import { discoverTeams } from "../../teams/discover-teams.ts";
import { discoverWorkflows } from "../../workflows/discover-workflows.ts";

const MAX_CONCURRENCY = 8;
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_TEAM = "fast-fix";
const DEFAULT_AGENT = "explorer";

export async function handleParallel(params: TeamToolParamsValue, ctx: TeamContext): Promise<PiTeamsToolResult> {
	const tasksParam = params.config?.tasks;
	if (!Array.isArray(tasksParam) || tasksParam.length === 0) {
		return result("parallel action requires config.tasks: [{goal, agent?}]", { action: "parallel", status: "error" }, true);
	}

	const concurrency = Math.min(
		Math.max(1, Math.floor((params.config?.concurrency as number) ?? DEFAULT_CONCURRENCY)),
		MAX_CONCURRENCY,
	);

	const config = loadConfig(ctx.cwd);
	const agentsResult = discoverAgents(ctx.cwd);
	const allAgentsList = [...agentsResult.builtin, ...agentsResult.user, ...agentsResult.project];
	const teams = discoverTeams(ctx.cwd);
	const workflows = discoverWorkflows(ctx.cwd);

	const teamName = (params.config?.team as string) ?? DEFAULT_TEAM;
	const team = teams.builtin.find((t) => t.name === teamName)
		?? teams.user.find((t) => t.name === teamName)
		?? teams.project.find((t) => t.name === teamName);
	if (!team) {
		return result(`Team '${teamName}' not found`, { action: "parallel", status: "error" }, true);
	}

	const workflow = workflows.builtin.find((w) => w.name === "fast-fix");

	const runtime = await resolveCrewRuntime(config.config);

	const launched: Array<{ runId: string; goal: string; agent: string }> = [];
	const errors: Array<{ goal: string; error: string }> = [];

	for (const task of tasksParam) {
		try {
			const goal = (task as Record<string, unknown>).goal as string;
			const agentName = ((task as Record<string, unknown>).agent as string) ?? DEFAULT_AGENT;
			const taskCwd = ((task as Record<string, unknown>).cwd as string) ?? ctx.cwd;

			if (!goal) {
				errors.push({ goal: "(missing)", error: "Each task must have a 'goal' field" });
				continue;
			}

			const agent = allAgentsList.find((a) => a.name === agentName);
			if (!agent) {
				errors.push({ goal, error: `Agent '${agentName}' not found` });
				continue;
			}

			const created = createRunManifest({
				cwd: taskCwd,
				team,
				workflow,
				goal,
			});

			appendEvent(created.manifest.eventsPath, {
				type: "run.started",
				runId: created.manifest.runId,
				message: `Parallel task: ${goal}`,
			});

			if (runtime.available && runtime.kind === "child-process") {
				spawnBackgroundTeamRun(created.manifest);
			}

			launched.push({ runId: created.manifest.runId, goal, agent: agentName });
		} catch (error) {
			const goal = (task as Record<string, unknown>).goal as string;
			errors.push({ goal: goal ?? "(unknown)", error: error instanceof Error ? error.message : String(error) });
		}
	}

	const lines: string[] = [
		`Parallel dispatch: ${launched.length}/${tasksParam.length} tasks launched (concurrency: ${concurrency})`,
		"",
	];
	for (const l of launched) {
		lines.push(`  ✅ ${l.runId} — ${l.agent}: ${l.goal.slice(0, 80)}`);
	}
	for (const e of errors) {
		lines.push(`  ❌ ${e.goal.slice(0, 80)}: ${e.error}`);
	}

	return result(lines.join("\n"), {
		action: "parallel",
		status: errors.length === tasksParam.length ? "error" : "ok",
	}, errors.length === tasksParam.length);
}
