import type { RunDashboardOptions } from "../run-dashboard.ts";
import { iconForStatus } from "../status-colors.ts";
import type { RunUiSnapshot } from "../snapshot-types.ts";
import { spinnerFrame } from "../spinner.ts";
import { listLiveAgents, type LiveAgentHandle } from "../../runtime/live-agent-manager.ts";

const TOOL_LABELS: Record<string, string> = {
	read: "reading",
	bash: "running command",
	edit: "editing",
	write: "writing",
	grep: "searching",
	find: "finding files",
	ls: "listing",
};

function describeLiveActivity(handle: LiveAgentHandle): string {
	const act = handle.activity;
	if (act.activeTools.size > 0) {
		const groups = new Map<string, number>();
		for (const toolName of act.activeTools.values()) {
			const label = TOOL_LABELS[toolName] ?? toolName;
			groups.set(label, (groups.get(label) ?? 0) + 1);
		}
		return [...groups.entries()].map(([l, c]) => c > 1 ? `${l} ${c} items` : l).join(", ") + "…";
	}
	if (act.responseText?.trim()) {
		const line = act.responseText.split("\n").find((l) => l.trim())?.trim() ?? "";
		return line.length > 40 ? line.slice(0, 40) + "…" : line;
	}
	return "thinking…";
}

function tokens(agent: RunUiSnapshot["agents"][number]): string {
	const total = (agent.usage?.input ?? 0) + (agent.usage?.output ?? agent.progress?.tokens ?? 0) + (agent.usage?.cacheRead ?? 0) + (agent.usage?.cacheWrite ?? 0);
	return total ? `${total} tok` : "tok pending";
}

export function renderAgentsPane(snapshot: RunUiSnapshot | undefined, options: RunDashboardOptions = {}): string[] {
	if (!snapshot) return ["Agents pane: snapshot unavailable"];
	if (!snapshot.agents.length) return ["Agents pane: no agents"];
	const liveForRun = listLiveAgents();
	return [
		`Agents pane: ${snapshot.agents.length} agents · ${snapshot.progress.completed}/${snapshot.progress.total} tasks done`,
		...snapshot.agents.slice(0, 12).map((agent) => {
			const liveHandle = liveForRun.find((h) => h.taskId === agent.taskId);
			const parts = [
				agent.status,
				options.showTools !== false && liveHandle && liveHandle.activity.activeTools.size > 0
					? `tools=${[...liveHandle.activity.activeTools.values()].join(",")}`
					: options.showTools !== false && agent.progress?.currentTool ? `tool=${agent.progress.currentTool}` : undefined,
				options.showTools !== false ? `${liveHandle?.activity.toolUses ?? agent.toolUses ?? agent.progress?.toolCount ?? 0} tools` : undefined,
				options.showTokens !== false ? tokens(agent) : undefined,
				options.showModel !== false ? (agent.model ? `model=${agent.model}` : undefined) : undefined,
				liveHandle ? describeLiveActivity(liveHandle) : undefined,
			].filter((part): part is string => Boolean(part));
			const icon = iconForStatus(agent.status, { runningGlyph: spinnerFrame(agent.taskId) });
			return `${icon} ${agent.taskId} ${agent.role}->${agent.agent} · ${parts.join(" · ")}`;
		}),
	];
}
