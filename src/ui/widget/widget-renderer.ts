/**
 * Widget rendering — builds and colorizes widget lines.
 *
 * Extracted from crew-widget.ts.
 */

import { listLiveAgents } from "../../runtime/live-agent-manager.ts";
import { computePhaseProgress, formatPhaseProgressLine } from "../../runtime/phase-progress.ts";
import { isFinishedRunStatus } from "../../runtime/process-status.ts";
import { getTaskUsage } from "../../runtime/usage-tracker.ts";
import { truncate } from "../../utils/visual.ts";
import { Box, Text } from "../layout-primitives.ts";
import { computeLiveDurationMs } from "../live-duration.ts";
import { spinnerFrame } from "../spinner.ts";
import { colorizeStatusGlyphs, iconForStatus } from "../status-colors.ts";
import type { CrewTheme } from "../theme-adapter.ts";
import { agentActivity, agentStats, elapsed, formatTokensCompact, notificationBadge } from "./widget-formatters.ts";
import { activeWidgetRuns, shortRunLabel } from "./widget-model.ts";
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

import { fmtDuration } from "../live-duration.ts";

/** Compact 5-cell progress bar (`▰▰▰▱▱`) — instant read of completion. */
export function progressBar(completed: number, total: number, cells = 5): string {
	if (total <= 0) return "";
	const filled = Math.max(0, Math.min(cells, Math.round((completed / total) * cells)));
	return "▰".repeat(filled) + "▱".repeat(cells - filled);
}

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
	const bar = progressBar(completedAgents, agents.length);
	return `${runningGlyph} Crew agents${notificationBadge(notificationCount)}${bar ? ` ${bar}` : ""} · ${parts.join(" · ")} · /team-dashboard`;
}

// ── Line builder ──────────────────────────────────────────────────────

export function buildWidgetLines(
	cwd: string,
	frame = 0,
	maxLines = 8,
	providedRuns?: WidgetRun[],
	notificationCount = 0,
	width = DEFAULT_WIDGET_WIDTH,
): string[] {
	// Match the legacy `buildCrewWidgetLines` API: when no runs are supplied,
	// auto-fetch via activeWidgetRuns(cwd). Otherwise widgets calling with
	// only `(cwd, frame)` would render an empty line set (regression vs. the
	// pre-refactor implementation that called activeWidgetRuns here).
	const runs = providedRuns ?? activeWidgetRuns(cwd);
	if (!runs.length) return [];

	const runningGlyph = spinnerFrame("widget-header");
	const lines: string[] = [widgetHeader(runs, runningGlyph, maxLines, notificationCount)];
	// Pair-safe truncation: `groupStarts` records indices where a cut is safe
	// (run rows, agent main rows) so slicing never orphans an activity line
	// (`⎿ …`) from the agent row above it.
	const groupStarts: number[] = [0];

	for (const [runIdx, { run, agents, snapshot }] of runs.entries()) {
		// Tree correctness: the LAST run closes the tree (`└─`) and its children
		// drop the `│` continuation rail — previously every run rendered `├─`,
		// leaving the tree visually dangling forever.
		const isLastRun = runIdx === runs.length - 1;
		const runBranch = isLastRun ? "└─" : "├─";
		const rail = isLastRun ? "   " : "│  ";
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
		const isTerminal = isFinishedRunStatus(run.status);
		// Run progress line. v1–v3 flickered on snapshot.tasks state, v4 was
		// too minimal (`0/1 agents` only), v5 duplicated the worker activity
		// line (tools/tokens/duration already shown one row below). v6 (this)
		// shows only data that is RUN-level (not already in the per-agent
		// activity line) and is GUARANTEED stable across ticks:
		//   - agents count — from `agents` array, always populated, never empty.
		//   - run elapsed   — from `run.createdAt`, always set on manifest.
		// Both come from sources with no race window — `agents` is read from
		// snapshot.agents OR agentsFor(run) (both always return same length
		// for a healthy run), and `run.createdAt` is immutable. The format
		// shape `"X/Y agents · Ns"` is therefore truly invariant: same number
		// of `·`-separated fields, same field meanings, every render tick.
		//
		// Bug 022 (timer-fix + label): for TERMINAL runs (failed/cancelled/
		// completed) the elapsed counter previously kept ticking up forever
		// from createdAt (a failed run showed `2028s` and climbing, read as
		// "still running"). Now it FREEZES at updatedAt (when the run
		// reached its terminal status). The status label is also surfaced
		// explicitly so the row cannot be misread as an active run.
		const agentCountText = `${completed}/${agents.length} agents`;
		const runEndMs = isTerminal ? new Date(run.updatedAt).getTime() : Date.now();
		const runElapsedMs = Math.max(0, Number.isFinite(runEndMs) ? runEndMs - new Date(run.createdAt).getTime() : 0);
		const runElapsedText = fmtDuration(runElapsedMs);
		const statusLabel = isTerminal ? ` · ${run.status}` : "";
		const progressPart = `${agentCountText} · ${runElapsedText}${statusLabel}`;
		groupStarts.push(lines.length);
		lines.push(truncate(`${runBranch} ${runGlyph} ${shortRunLabel(run)} · ${progressPart} · ${run.runId.slice(-8)}`, width));

		const liveForRun = listLiveAgents().filter((a) => a.runId === run.runId);

		// L-4: prioritize RUNNING > QUEUED > WAITING within the visible window so the
		// most relevant live workers are always shown. Finished rows fill only the
		// leftover budget and never steal slots from running agents.
		const ACTIVE_PRIORITY: Record<string, number> = {
			running: 0,
			queued: 1,
			waiting: 2,
		};
		const prioritizedActive = [...activeAgents].sort((a, b) => (ACTIVE_PRIORITY[a.status] ?? 9) - (ACTIVE_PRIORITY[b.status] ?? 9));
		// Finished rows only appear in slots not used by active agents (max 2). When
		// there are >= MAX_AGENTS_DISPLAY live workers, finished rows are suppressed
		// entirely so they cannot push a live agent's activity line off-screen.
		const finishedSlots = Math.max(0, Math.min(2, MAX_AGENTS_DISPLAY - activeAgents.length));

		const visibleAgents = prioritizedActive.slice(0, MAX_AGENTS_DISPLAY);
		const shownFinished = finishedAgents.slice(0, finishedSlots);
		const overflowCount = Math.max(0, activeAgents.length - MAX_AGENTS_DISPLAY);
		// Total child rows below the run line, to place `└─` on the true last row.
		const childRows = visibleAgents.length + (overflowCount > 0 ? 1 : 0) + shownFinished.length;
		let childIdx = 0;
		for (const agent of visibleAgents) {
			childIdx++;
			const isLastChild = childIdx === childRows;
			const branch = isLastChild ? "└─" : "├─";
			// The activity row under the LAST child hangs without a rail.
			const activityRail = isLastChild ? "   " : "│  ";
			const agentGlyph = iconForStatus(agent.status, { runningGlyph });
			const liveHandle = liveForRun.find((h) => h.taskId === agent.taskId);
			const stats = agentStats(agent, liveHandle);
			const name = liveHandle?.agent ?? agent.agent;
			const desc = truncate(liveHandle?.description ?? agent.role ?? "", TASK_DESC_MAX);
			groupStarts.push(lines.length);
			lines.push(truncate(`${rail}${branch} ${agentGlyph} ${name}${desc ? ` · ${desc}` : ` · ${agent.role}`}`, width));
			lines.push(truncate(`${rail}${activityRail}  ⊶ ${agentActivity(agent, liveHandle)}${stats ? ` · ${stats}` : ""}`, width));
		}

		if (overflowCount > 0) {
			childIdx++;
			groupStarts.push(lines.length);
			lines.push(truncate(`${rail}${childIdx === childRows ? "└─" : "├─"} … +${overflowCount} more agents`, width));
		}

		for (const agent of shownFinished) {
			childIdx++;
			const liveHandle = liveForRun.find((h) => h.taskId === agent.taskId);
			const name = liveHandle?.agent ?? agent.agent;
			const icon =
				agent.status === "completed" ? "✓" : agent.status === "failed" ? "✗" : agent.status === "needs_attention" ? "⚠" : "▪";
			const stats = agentStats(agent, liveHandle);
			const desc = truncate(liveHandle?.description ?? agent.role ?? "", TASK_DESC_MAX);
			const branch = childIdx === childRows ? "└─" : "├─";
			groupStarts.push(lines.length);
			lines.push(truncate(`${rail}${branch} ${icon} ${name} · ${desc}${stats ? ` · ${stats}` : ""}`, width));
		}

		if (lines.length >= maxLines) break;
	}

	if (lines.length <= maxLines) return lines;
	// Keep whole groups while they fit — never cut mid-pair (an activity row
	// must never render without its agent row).
	let cut = 0;
	for (let i = 0; i < groupStarts.length; i++) {
		const end = i + 1 < groupStarts.length ? groupStarts[i + 1]! : lines.length;
		if (end <= maxLines) cut = end;
		else break;
	}
	return lines.slice(0, Math.max(1, cut));
}

// ── Colorization ──────────────────────────────────────────────────────

export function colorWidgetLine(line: string, index: number, theme: CrewTheme): string {
	let result = line;
	if (index === 0) {
		result = result.replace("Crew agents", theme.bold(theme.fg("accent", "Crew agents")));
		// De-emphasize the navigation hint — it is chrome, not data.
		result = result.replace("/team-dashboard", theme.fg("dim", "/team-dashboard"));
	}
	// Dim trailing run-id suffixes (` · 3a636ea9`) on run rows — reference
	// metadata, not something to read every tick.
	result = result.replace(/ · ([a-f0-9]{8})$/, (_m, id) => ` · ${theme.fg("dim", id)}`);
	// Shared glyph colorizer covers ALL status glyphs — including ⏳ (waiting),
	// ⚠ (needs_attention), and the braille spinner range ⠁-⣿ (running) — which the
	// previous local statusGlyphColor map + regex omitted (F-1, V-3).
	result = colorizeStatusGlyphs(result, theme);
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
