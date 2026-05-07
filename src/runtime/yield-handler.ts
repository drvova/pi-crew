import { subprocessToolRegistry, type SubprocessToolEvent } from "./subprocess-tool-registry.ts";

export interface YieldResult {
	summary: string;
	artifacts?: Record<string, string>;
	structuredData?: Record<string, unknown>;
	toolCallId: string;
}

export interface YieldConfig {
	enabled: boolean;
	maxReminders: number;
	reminderPrompt: string;
}

export const DEFAULT_YIELD_CONFIG: YieldConfig = {
	enabled: true,
	maxReminders: 3,
	reminderPrompt: "You must call the submit_result tool to return your results.",
};

/** Tool name used by workers to yield their result. */
export const YIELD_TOOL_NAME = "submit_result";

/**
 * Check if a value is a plain object record (non-null, non-array object).
 */
function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Check if a value is a record with all string values.
 */
function isStringRecord(value: unknown): value is Record<string, string> {
	if (!isObjectRecord(value)) return false;
	return Object.values(value).every((v) => typeof v === "string");
}

/**
 * Shared helper to extract yield data from tool call arguments.
 * Used by both `extractYieldResult` and `registerYieldTool.extractData`
 * to avoid duplicating parsing logic.
 */
export function extractYieldDataFromArgs(args: unknown, toolCallId: string): YieldResult | undefined {
	if (!isObjectRecord(args)) return undefined;
	const summary = typeof args.summary === "string" ? args.summary : "";
	if (!summary) return undefined;
	const result: YieldResult = { summary, toolCallId };
	if (args.artifacts && isStringRecord(args.artifacts)) {
		result.artifacts = args.artifacts;
	}
	if (args.structuredData && isObjectRecord(args.structuredData)) {
		result.structuredData = args.structuredData;
	}
	return result;
}

/**
 * Check if a JSON event represents a yield/submit_result tool call.
 * Supports event types: tool_execution_start, toolCall, tool_call.
 */
export function isYieldEvent(event: Record<string, unknown>): boolean {
	const type = event.type;
	if (type !== "tool_execution_start" && type !== "toolCall" && type !== "tool_call") return false;
	const toolName = event.toolName ?? event.name ?? event.tool;
	return toolName === YIELD_TOOL_NAME;
}

/**
 * Extract structured result from a yield event.
 */
export function extractYieldResult(event: Record<string, unknown>): YieldResult | undefined {
	if (!isYieldEvent(event)) return undefined;
	const toolCallId = typeof event.toolCallId === "string" ? event.toolCallId : "";
	return extractYieldDataFromArgs(event.args, toolCallId);
}

/**
 * Check if a worker output sequence contains a yield.
 */
export function hasYieldInOutput(events: Record<string, unknown>[]): boolean {
	return events.some((event) => isYieldEvent(event));
}

/**
 * Build a reminder prompt for workers that haven't yielded.
 */
export function buildYieldReminder(attempt: number, maxAttempts: number, reminderPrompt?: string): string {
	return `[Yield Reminder ${attempt}/${maxAttempts}] ${reminderPrompt ?? DEFAULT_YIELD_CONFIG.reminderPrompt}`;
}

/**
 * Register the submit_result tool handler in the subprocess tool registry.
 */
export function registerYieldTool(): void {
	subprocessToolRegistry.register<YieldResult>(YIELD_TOOL_NAME, {
		extractData(event: SubprocessToolEvent): YieldResult | undefined {
			return extractYieldDataFromArgs(event.args, event.toolCallId);
		},
		shouldTerminate(): boolean {
			return true;
		},
	});
}
