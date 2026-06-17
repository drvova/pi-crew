import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderRunStarted, renderRunCompleted, renderResumeDirective, registerCrewMessageRenderers } from "../../src/extension/message-renderers.ts";
import type { Theme } from "@earendil-works/pi-coding-agent";

// Minimal stub theme — the renderers only call theme.fg(level, text) and theme.bold(text).
const theme = {
	fg: (_level: string, text: string) => text,
	bold: (text: string) => `**${text}**`,
} as unknown as Theme;

const options = { expanded: false };

describe("renderRunStarted", () => {
	it("renders a launch line with team/workflow/goal", () => {
		const result = renderRunStarted(
			{ content: "", details: { runId: "team_123", team: "default", workflow: "fast-fix", goal: "fix bug" } },
			options,
			theme,
		);
		const rendered = result.render(120).join(" ");
		assert.match(rendered, /team_123/);
		assert.match(rendered, /default\/fast-fix/);
		assert.match(rendered, /fix bug/);
	});

	it("truncates long goals", () => {
		const longGoal = "x".repeat(100);
		const result = renderRunStarted(
			{ content: "", details: { runId: "r1", team: "t", goal: longGoal } },
			options,
			theme,
		);
		const rendered = result.render(120).join(" ");
		assert.ok(!rendered.includes("x".repeat(100)));
		assert.match(rendered, /…/);
	});

	it("falls back to 'direct' when no team/agent", () => {
		const result = renderRunStarted({ content: "", details: { runId: "r1" } }, options, theme);
		const rendered = result.render(120).join(" ");
		assert.match(rendered, /direct/);
	});
});

describe("renderRunCompleted", () => {
	it("uses success styling for completed runs", () => {
		const result = renderRunCompleted(
			{ content: "", details: { runId: "r1", status: "completed", taskCount: 5, goal: "done" } },
			options,
			theme,
		);
		const rendered = result.render(120).join(" ");
		assert.match(rendered, /completed/);
		assert.match(rendered, /5 tasks/);
		assert.match(rendered, /done/);
	});

	it("uses error styling for failed runs", () => {
		const result = renderRunCompleted(
			{ content: "", details: { runId: "r1", status: "failed" } },
			options,
			theme,
		);
		const rendered = result.render(120).join(" ");
		assert.match(rendered, /failed/);
	});

	it("uses warning styling for cancelled runs", () => {
		const result = renderRunCompleted(
			{ content: "", details: { runId: "r1", status: "cancelled" } },
			options,
			theme,
		);
		const rendered = result.render(120).join(" ");
		assert.match(rendered, /cancelled/);
	});

	it("handles missing details gracefully", () => {
		const result = renderRunCompleted({ content: "" }, options, theme);
		const rendered = result.render(120).join(" ");
		assert.match(rendered, /finished/);
	});
});

describe("renderResumeDirective", () => {
	it("extracts text from string content", () => {
		const result = renderResumeDirective({ content: "Context compacted, resuming" }, options, theme);
		const rendered = result.render(120).join(" ");
		assert.match(rendered, /Context compacted, resuming/);
	});

	it("falls back to default message when content is empty", () => {
		const result = renderResumeDirective({ content: "" }, options, theme);
		const rendered = result.render(120).join(" ");
		assert.match(rendered, /resuming in-flight crew work/);
	});

	it("extracts text from array content", () => {
		const result = renderResumeDirective({ content: [{ type: "text", text: "array content" }] }, options, theme);
		const rendered = result.render(120).join(" ");
		assert.match(rendered, /array content/);
	});
});

describe("registerCrewMessageRenderers", () => {
	it("registers all 3 renderers without throwing", () => {
		const registered: string[] = [];
		const fakePi = {
			registerMessageRenderer: (customType: string) => { registered.push(customType); },
		};
		registerCrewMessageRenderers(fakePi as never);
		assert.deepEqual(registered, ["crew:run-started", "crew:run-completed", "crew:resume-directive"]);
	});

	it("works with a real-shaped ExtensionAPI (registerMessageRenderer present)", () => {
		const fakePi = { registerMessageRenderer: () => {} };
		// Should not throw
		registerCrewMessageRenderers(fakePi as never);
	});
});

// --- Lifecycle bg-tint (ansi-box fillToolBackground consumer wiring) ---

describe("lifecycle bg tint (fillToolBackground consumer)", () => {
	it("renderRunCompleted applies a success-tinted bg fill on a bg-capable theme", () => {
		// Theme exposing getFgAnsi/getBgAnsi → deriveCardBackground can produce a bg.
		const bgTheme = {
			fg: (_level: string, text: string) => text,
			bold: (text: string) => `**${text}**`,
			getFgAnsi: () => "\x1b[38;2;100;200;100m",
			getBgAnsi: () => "\x1b[48;2;20;20;30m",
		} as unknown as Theme;
		const result = renderRunCompleted(
			{ content: "", details: { runId: "r1", status: "completed", taskCount: 3 } },
			options,
			bgTheme,
		);
		// The Text child carries the bg-tinted string: must contain a 48;2 bg fill.
		assert.ok(JSON.stringify(result).includes("48;2"), "success completion → bg-tinted line");
	});

	it("renderRunCompleted applies an error-tinted bg on failed runs", () => {
		const bgTheme = {
			fg: (_level: string, text: string) => text,
			bold: (text: string) => text,
			getFgAnsi: () => "\x1b[38;2;200;100;100m",
			getBgAnsi: () => "\x1b[48;2;20;20;30m",
		} as unknown as Theme;
		const result = renderRunCompleted(
			{ content: "", details: { runId: "r1", status: "failed" } },
			options,
			bgTheme,
		);
		assert.ok(JSON.stringify(result).includes("48;2"), "failed run → error-tinted bg line");
	});

	it("gracefully degrades (no bg) on a fg-only theme — message still readable", () => {
		// The original minimal stub theme has no getFgAnsi/getBgAnsi → no tint.
		const result = renderRunCompleted(
			{ content: "", details: { runId: "r1", status: "completed" } },
			options,
			theme,
		);
		// No bg fill injected; text content survives.
		assert.ok(!JSON.stringify(result).includes("48;2"), "fg-only theme → no bg tint");
		assert.ok(JSON.stringify(result).includes("crew"));
	});

	it("renderRunStarted applies an accent-tinted bg on a bg-capable theme", () => {
		const bgTheme = {
			fg: (_level: string, text: string) => text,
			bold: (text: string) => text,
			getFgAnsi: () => "\x1b[38;2;100;150;200m",
			getBgAnsi: () => "\x1b[48;2;20;20;30m",
		} as unknown as Theme;
		const result = renderRunStarted(
			{ content: "", details: { runId: "r1", team: "default", workflow: "default" } },
			options,
			bgTheme,
		);
		assert.ok(JSON.stringify(result).includes("48;2"), "run-started → accent-tinted bg line");
	});
});
