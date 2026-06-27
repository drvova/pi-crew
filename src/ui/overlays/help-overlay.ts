/**
 * K-1 — dashboard keybinding cheatsheet overlay.
 *
 * Toggled by `?` (bound in keybinding-map.ts). Renders the dashboard's
 * keybindings grouped by scope (general / navigation / panes / run actions /
 * mailbox / health) directly from `DASHBOARD_KEYS`, so adding a key in one
 * place is reflected here automatically.
 *
 * Uses the same `innerWidth = max(20, width - 4)` formula as `run-dashboard.ts`
 * so the overlay's border column aligns with the dashboard's stable-height
 * blank-padding rows (preserves the "stable overlay height" strength — the
 * blank rows injected by the dashboard's pad/trim must land in the same
 * column as this overlay's `│` borders).
 *
 * Template origin: `confirm-overlay.ts`.
 */
import { Box, Text } from "../layout-primitives.ts";
import { asCrewTheme, type CrewTheme } from "../theme-adapter.ts";
import { pad, truncate } from "../../utils/visual.ts";
import { DASHBOARD_KEYS } from "../keybinding-map.ts";

/** Translate a raw key sequence into a readable token for the cheatsheet. */
function keyToken(key: string): string {
	switch (key) {
		case "\u001b":
			return "Esc";
		case "\u001b[A":
			return "↑";
		case "\u001b[B":
			return "↓";
		case "\r":
		case "\n":
			return "Enter";
		default:
			return key;
	}
}

function keyList(keys: readonly string[]): string {
	return [...keys].map(keyToken).join("/");
}

interface HelpEntry {
	readonly keys: string;
	readonly label: string;
}

interface HelpGroup {
	readonly title: string;
	readonly entries: readonly HelpEntry[];
}

const ROOT_LABELS: Record<string, string> = {
	summary: "summary",
	artifacts: "artifacts",
	api: "api",
	agents: "agents",
	mailbox: "mailbox",
	events: "events",
	output: "output",
	transcript: "transcript",
	liveConversation: "live conv",
	reload: "reload",
	progressToggle: "progress",
};

const MAILBOX_LABELS: Record<string, string> = {
	ack: "ack",
	nudge: "nudge",
	compose: "compose",
	preview: "preview",
	ackAll: "ack all",
};

const HEALTH_LABELS: Record<string, string> = {
	recovery: "recover",
	killStale: "kill stale",
	diagnosticExport: "diag export",
};

function buildHelpGroups(): HelpGroup[] {
	const paneEntries: HelpEntry[] = Object.entries(DASHBOARD_KEYS.pane).map(([name, keys]) => ({
		keys: keyList(keys),
		label: name,
	}));
	const rootEntries: HelpEntry[] = Object.entries(DASHBOARD_KEYS.root).map(([name, keys]) => ({
		keys: keyList(keys),
		label: ROOT_LABELS[name] ?? name,
	}));
	const mailboxEntries: HelpEntry[] = Object.entries(DASHBOARD_KEYS.mailbox)
		.filter(([name]) => name !== "openDetail")
		.map(([name, keys]) => ({ keys: keyList(keys), label: MAILBOX_LABELS[name] ?? name }));
	const healthEntries: HelpEntry[] = Object.entries(DASHBOARD_KEYS.health).map(([name, keys]) => ({
		keys: keyList(keys),
		label: HEALTH_LABELS[name] ?? name,
	}));
	return [
		{
			title: "General",
			entries: [
				{ keys: keyList(DASHBOARD_KEYS.close), label: "close dashboard" },
				{ keys: keyList(DASHBOARD_KEYS.select), label: "open run status" },
				{ keys: "?", label: "toggle this help" },
			],
		},
		{
			title: "Navigation",
			entries: [
				{ keys: `${keyList(DASHBOARD_KEYS.navigation.up)}/${keyList(DASHBOARD_KEYS.navigation.down)}`, label: "move selection" },
			],
		},
		{ title: "Panes", entries: paneEntries },
		{ title: "Run actions", entries: rootEntries },
		{ title: "Mailbox (pane 3)", entries: mailboxEntries },
		{
			title: "Health & notifications",
			entries: [
				...healthEntries,
				{ keys: keyList(DASHBOARD_KEYS.notification.dismissAll), label: "dismiss notifs" },
			],
		},
	];
}

export class HelpOverlay {
	private readonly theme: CrewTheme;

	constructor(theme: unknown = {}) {
		this.theme = asCrewTheme(theme);
	}

	invalidate(): void {
		// Stateless overlay.
	}

	render(width: number): string[] {
		// MUST mirror run-dashboard.ts's innerWidth so the dashboard's
		// stable-height blank-padding rows align with this overlay's borders.
		const innerWidth = Math.max(20, width - 4);
		const fg = (color: Parameters<CrewTheme["fg"]>[0], text: string) => this.theme.fg(color, text);
		const row = (text: string) => `│ ${pad(truncate(text, innerWidth - 1), innerWidth - 1)}│`;
		const bar = "─".repeat(innerWidth);
		const top = fg("border", `╭${bar}╮`);
		const mid = fg("border", `├${bar}┤`);
		const bot = fg("border", `╰${bar}╯`);
		const keyCol = 9;
		const lines: string[] = [
			top,
			row(`${fg("accent", "pi-crew dashboard")} ${fg("dim", "— key reference (press ? to close)")}`),
			mid,
		];
		for (const group of buildHelpGroups()) {
			lines.push(row(fg("accent", group.title)));
			for (let i = 0; i < group.entries.length; i += 2) {
				const pair = group.entries.slice(i, i + 2);
				const cell = (entry: HelpEntry) =>
					`${this.theme.bold(pad(entry.keys, keyCol))}${fg("dim", truncate(entry.label, 16))}`;
				lines.push(row(pair.map(cell).join("   ")));
			}
		}
		lines.push(bot);
		const box = new Box(0, 0);
		for (const line of lines) box.addChild(new Text(line));
		return box.render(width);
	}
}
