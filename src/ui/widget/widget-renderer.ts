/**
 * Widget rendering — builds and colorizes widget lines.
 *
 * Extracted from crew-widget.ts.
 */

import type { CrewTheme } from "../theme-adapter.ts";
import { iconForStatus } from "../status-colors.ts";
import { truncate } from "../../utils/visual.ts";
import { Box, Text } from "../layout-primitives.ts";
import { listLiveAgents } from "../../runtime/live-agent-manager.ts";
import { computePhaseProgress, formatPhaseProgressLine } from "../../runtime/phase-progress.ts";
import { spinnerFrame } from "../spinner.ts";
import { agentActivity, agentStats, notificationBadge } from "./widget-formatters.ts";
import { shortRunLabel } from "./widget-model.ts";
import type { WidgetRun } from "./widget-types.ts";

const MAX_AGENTS_DISPLAY = 3;
const FINISHED_LINGER_MAX_AGE = 1;
/** Default terminal width when caller doesn't pass one explicitly. Keep <= 116
 * (the same default used elsewhere in pi-crew tool renderers) so we never paint
 * a line wider than the smallest expected TUI. Callers SHOULD pass the real
 * width when known (via ctx.width || process.stdout.columns). */
export const DEFAULT_WIDGET_WIDTH = 100;
/** Cap per-component text so a single field cannot blow past width on its own. */
export const TASK_DESC_MAX = 60;
const ERROR_LINGER_MAX_AGE = 2;
const ERROR_STATUSES = new Set(["failed", "cancelled", "stopped", "needs_attention"]);

// ── Header ────────────────────────────────────────────────────────────

export function widgetHeader(runs: WidgetRun[], runningGlyph: string, maxLines = 20, notificationCount = 0): string {
	const agents = runs.flatMap((item) => item.agents);
	const runningAgents = agents.filter((a) => a.status === "running").length;
	const queuedAgents = agents.filter((a) => a.status === "queued").length;
	const waitingAgents = agents.filter((a) => a.status === "waiting").length;
	const completedAgents = agents.filter((a) => a.status === "completed").length;
	const parts = [`${runningAgents} running`];
	if (queuedAgents) parts.push(`${queuedAgents} queued`);
	if (waitingAgents) parts.push(`${waitingAgents} waiting`);
	if (completedAgents) parts.push(`${completedAgents}/${agents.length} done`);
	return `${runningGlyph} Crew agents${notificationBadge(notificationCount)} · ${parts.join(" · ")} · /team-dashboard`;
}

// ── Line builder ──────────────────────────────────────────────────────

export function buildWidgetLines(cwd: string, frame = 0, maxLines = 8, providedRuns?: WidgetRun[], notificationCount = 0, width = DEFAULT_WIDGET_WIDTH): string[] {
	const runs = providedRuns ?? [];
	if (!runs.length) return [];

	const runningGlyph = spinnerFrame("widget-header");
	const lines: string[] = [widgetHeader(runs, runningGlyph, maxLines, notificationCount)];

	for (const { run, agents, snapshot } of runs) {
		const activeAgents = agents.filter((a) => a.status === "running" || a.status === "queued" || a.status === "waiting");
		const now = Date.now();
		const finishedAgents = agents.filter((item) => {
			if (item.status === "running" || item.status === "queued" || item.status === "waiting") return false;
			if (!item.completedAt) return false;
			const maxAgeMs = (ERROR_STATUSES.has(item.status) ? ERROR_LINGER_MAX_AGE : FINISHED_LINGER_MAX_AGE) * 60_000;
			const age = now - new Date(item.completedAt).getTime();
			return Number.isFinite(age) && age < maxAgeMs;
		});
		const completed = agents.filter((a) => a.status === "completed").length;
		const runGlyph = iconForStatus(run.status, { runningGlyph });
		const phaseLine = snapshot ? formatPhaseProgressLine(computePhaseProgress(snapshot.tasks)) : "";
		const progressPart = phaseLine || `${completed}/${agents.length} done`;
		lines.push(truncate(`├─ ${runGlyph} ${shortRunLabel(run)} · ${progressPart} · ${run.runId.slice(-8)}`, width));

		const liveForRun = listLiveAgents().filter((a) => a.runId === run.runId);

		for (const agent of finishedAgents.slice(0, 2)) {
			const liveHandle = liveForRun.find((h) => h.taskId === agent.taskId);
			const name = liveHandle?.agent ?? agent.agent;
			const icon = agent.status === "completed" ? "✓" : agent.status === "failed" ? "✗" : agent.status === "needs_attention" ? "⚠" : "▪";
			const stats = agentStats(agent, liveHandle);
			const desc = truncate(liveHandle?.description ?? agent.role ?? "", TASK_DESC_MAX);
			const _finished = truncate(`│  ├─ ${icon} ${name} · ${desc}${stats ? ` · ${stats}` : ""}`, width);
			lines.push(_finished);
		}

		const visibleAgents = activeAgents.slice(0, MAX_AGENTS_DISPLAY);
		for (const [index, agent] of visibleAgents.entries()) {
			const last = index === visibleAgents.length - 1 && activeAgents.length <= MAX_AGENTS_DISPLAY;
			const branch = last ? "└─" : "├─";
			const agentGlyph = iconForStatus(agent.status, { runningGlyph });
			const liveHandle = liveForRun.find((h) => h.taskId === agent.taskId);
			const stats = agentStats(agent, liveHandle);
			const name = liveHandle?.agent ?? agent.agent;
			const desc = truncate(liveHandle?.description ?? agent.role ?? "", TASK_DESC_MAX);
			const _activeMain = truncate(`│  ${branch} ${agentGlyph} ${name}${desc ? ` · ${desc}` : ` · ${agent.role}`}`, width);
			lines.push(_activeMain);
			const _activity = truncate(`│     ⊶ ${agentActivity(agent, liveHandle)}${stats ? ` · ${stats}` : ""}`, width);
			lines.push(_activity);
		}

		if (activeAgents.length > MAX_AGENTS_DISPLAY) {
			lines.push(truncate(`│  └─ … +${activeAgents.length - MAX_AGENTS_DISPLAY} more agents`, width));
		}

		if (lines.length >= maxLines) break;
	}

	return lines.slice(0, maxLines);
}

// ── Colorization ──────────────────────────────────────────────────────

function statusGlyphColor(icon: string): Parameters<CrewTheme["fg"]>[0] {
	const mapping: Record<string, Parameters<CrewTheme["fg"]>[0]> = {
		"✓": "success",
		"✗": "error",
		"■": "warning",
		"⏸": "warning",
		"◦": "dim",
		"·": "dim",
		"▶": "accent",
	};
	return mapping[icon] ?? "accent";
}

export function colorWidgetLine(line: string, index: number, theme: CrewTheme): string {
	let result = line;
	if (index === 0) {
		result = result.replace("Crew agents", theme.bold(theme.fg("accent", "Crew agents")));
	}
	result = result.replace(/[✓✗■⏸◦·▶]/g, (icon) => theme.fg(statusGlyphColor(icon), icon));
	if (index === 0) {
		result = theme.fg("accent", result);
	}
	return result;
}

export function renderLines(lines: string[], width: number): string[] {
	const box = new Box(0, 0);
	for (const line of lines) {
		box.addChild(new Text(line));
	}
	return box.render(width);
}
