/**
 * Custom message renderers for pi-crew session entries (Round 13 UX).
 *
 * pi-crew emits CustomMessageEntry rows via `pi.appendEntry()` for run
 * lifecycle events (crew:run-started, crew:run-completed,
 * crew:resume-directive). Without a registered renderer these display as
 * raw JSON in the conversation. These renderers give them a clean,
 * crew-branded look using the active theme.
 */
import { Text } from "@earendil-works/pi-tui";
import type { ExtensionAPI, MessageRenderOptions, Theme } from "@earendil-works/pi-coding-agent";
import { fillToolBackground } from "../ui/ansi-box.ts";
import { deriveCardBackground } from "../ui/card-colors.ts";
import type { CrewTheme } from "../ui/theme-adapter.ts";

interface CrewMessageDetails {
	runId?: string;
	team?: string;
	workflow?: string;
	agent?: string;
	goal?: string;
	status?: string;
	taskCount?: number;
	timestamp?: number;
}

type MessageLike = {
	content: string | Array<{ type: string; text?: string }>;
	details?: CrewMessageDetails;
};

function extractText(message: MessageLike): string {
	if (typeof message.content === "string") return message.content;
	return (message.content ?? []).map((c) => c.text ?? "").join("");
}

/**
 * Wrap a single-line lifecycle message in a subtle status-tinted bg fill.
 * Uses deriveCardBackground (status→bg tint, low intensity) + fillToolBackground
 * (preserveBoxBackground so embedded resets don't punch through). Returns the
 * original styled text unchanged when the theme exposes no fg/bg ANSI (graceful
 * degradation — the message still renders, just without the tint). This wires
 * the ansi-box fillToolBackground primitive into a real visible consumer
 * (every run-start/run-completed lifecycle message).
 */
function tintedLifecycleLine(styledText: string, theme: Theme, bgSlot: "success" | "error" | "borderAccent" | "border"): string {
	const bg = deriveCardBackground(theme as unknown as CrewTheme, bgSlot);
	if (!bg) return styledText; // bg-less theme → no tint, message still readable
	return fillToolBackground(styledText, bg);
}

function statusLevel(status: string | undefined): "success" | "error" | "warning" | "muted" {
	switch (status) {
		case "completed":
			return "success";
		case "failed":
		case "blocked":
			return "error";
		case "cancelled":
			return "warning";
		default:
			return "muted";
	}
}

function statusIcon(status: string | undefined): string {
	switch (status) {
		case "completed":
			return "✅";
		case "failed":
		case "blocked":
			return "❌";
		case "cancelled":
			return "🚫";
		case "running":
		case "planning":
			return "🚀";
		default:
			return "•";
	}
}

/** Truncate a string to maxLen chars with an ellipsis. */
function truncate(text: string, maxLen: number): string {
	return text.length > maxLen ? `${text.slice(0, maxLen - 1)}…` : text;
}

/** Render crew:run-started entries as a branded launch line. */
export function renderRunStarted(message: MessageLike, _options: MessageRenderOptions, theme: Theme): Text {
	const details = message.details ?? {};
	const goal = details.goal ? truncate(details.goal, 70) : "";
	const team = details.team ?? details.agent ?? "direct";
	const workflow = details.workflow ?? "default";
	const text = `🚀 crew run ${details.runId ?? ""} started — ${team}/${workflow}${goal ? ` — ${goal}` : ""}`;
	const styled = theme.fg("accent", theme.bold("crew ")) + theme.fg("text", text);
	return new Text(tintedLifecycleLine(styled, theme, "borderAccent"), 0, 0);
}

/** Render crew:run-completed entries with a status-colored summary. */
export function renderRunCompleted(message: MessageLike, _options: MessageRenderOptions, theme: Theme): Text {
	const details = message.details ?? {};
	const status = details.status;
	const level = statusLevel(status);
	const icon = statusIcon(status);
	const goal = details.goal ? truncate(details.goal, 60) : "";
	const tasks = details.taskCount !== undefined ? ` · ${details.taskCount} tasks` : "";
	const text = `${icon} crew run ${details.runId ?? ""} ${status ?? "finished"}${tasks}${goal ? ` — ${goal}` : ""}`;
	const styled = theme.fg(level, theme.bold("crew ")) + theme.fg(level, text);
	// Status-tinted bg fill: success→success-tinted, failed/blocked→error-tinted.
	const bgSlot = level === "success" ? "success" : level === "error" ? "error" : "borderAccent";
	return new Text(tintedLifecycleLine(styled, theme, bgSlot), 0, 0);
}

/** Render crew:resume-directive entries as an informational system note. */
export function renderResumeDirective(message: MessageLike, _options: MessageRenderOptions, theme: Theme): Text {
	const text = extractText(message) || "Context compacted — resuming in-flight crew work.";
	return new Text(theme.fg("muted", theme.bold("crew ") + text), 0, 0);
}

/** Register all crew message renderers. Safe to call once at extension load. */
export function registerCrewMessageRenderers(
	pi: { registerMessageRenderer?: ExtensionAPI["registerMessageRenderer"] },
): void {
	// Optional chaining guards against older Pi versions (and test stubs)
	// without registerMessageRenderer.
	// The renderers return Text (a Component) — cast through never to match
	// the MessageRenderer<T> signature which expects Component | undefined.
	pi.registerMessageRenderer?.("crew:run-started", renderRunStarted as never);
	pi.registerMessageRenderer?.("crew:run-completed", renderRunCompleted as never);
	pi.registerMessageRenderer?.("crew:resume-directive", renderResumeDirective as never);
}
