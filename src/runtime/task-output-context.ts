import * as fs from "node:fs";
import * as path from "node:path";
import type { ArtifactDescriptor, TeamRunManifest, TeamTaskState } from "../state/types.ts";
import { writeArtifact } from "../state/artifact-store.ts";
import { resolveRealContainedPath } from "../utils/safe-paths.ts";
import type { WorkflowStep } from "../workflows/workflow-config.ts";
import { pruneToolOutputs, type ToolResultEntry, type FileEditEvent, DEFAULT_PRUNE_CONFIG } from "./tool-output-pruner.ts";
import { applyCompactPipeline } from "./compact-pipeline.ts";
import { ANSI_STRIP_STAGE, BLANK_COLLAPSE_STAGE, TruncationStage } from "./compact-stages/index.ts";

export interface DependencyContextEntry {
	taskId: string;
	role: string;
	status: string;
	resultSummary: string;
	resultPath?: string;
	structuredResults?: Record<string, unknown>;
	artifactsProduced?: string[];
	usage?: { inputTokens: number; outputTokens: number; durationMs: number };
}

export interface DependencyOutputContext {
	dependencies: DependencyContextEntry[];
	sharedReads: Array<{ name: string; path: string; content: string }>;
}

function containedExists(filePath: string, baseDir?: string): boolean {
	try {
		const safePath = baseDir ? resolveRealContainedPath(baseDir, filePath) : filePath;
		return fs.existsSync(safePath);
	} catch {
		return false;
	}
}

/**
 * L4 output-handling: single consistent threshold for all artifact reads.
 * Sized from real data (27 result artifacts: max 9226 bytes; 100% < 16KB).
 * 32KB gives 2x headroom over the largest observed real output while still
 * bounding memory. Larger than the old inconsistent per-call-site values
 * (24K/40K/80K) which truncated the same artifact differently depending on
 * which code path read it.
 */
export const MAX_RESULT_INLINE_BYTES = 32_000;

/**
 * Read a file and return its content, truncating to a head+tail slice if it
 * exceeds {@link MAX_RESULT_INLINE_BYTES} characters. Multi-byte UTF-8
 * sequences are preserved by reading the full file as a UTF-8 string and
 * slicing by character count (not raw bytes).
 */
export function readIfSmall(filePath: string, baseDir?: string): string | undefined {
	const maxChars = MAX_RESULT_INLINE_BYTES;
	try {
		const safePath = baseDir ? resolveRealContainedPath(baseDir, filePath) : filePath;
		const content = fs.readFileSync(safePath, "utf-8");
		if (content.length > maxChars) {
			// L4: head + tail instead of head-only. Keeps closing markdown
			// structure (code fences, headings) instead of leaving them truncated.
			// Slice by character count to avoid splitting multi-byte UTF-8
			// sequences (which would produce U+FFFD replacement characters).
			// P0-A: compose the file through the stage-chain compression pipeline.
			// Artifact files are tool output context and frequently contain ANSI
			// color codes + blank-line noise (npm/cargo/jest output captured to
			// disk), so we apply ANSI strip + blank collapse BEFORE truncation.
			// For inputs WITHOUT ANSI or blank runs (e.g. plain text fixtures)
			// those stages are no-ops and the output is bit-identical to the
			// pre-P0-A format (L4 backward-compat safety).
			// P0-B: the TruncationStage scans the middle slice for important
			// diagnostic lines (error, file:line, HTTP 4xx/5xx, compiler codes)
			// and preserves them within a 15% slack budget. Artifact files
			// always scan (no assistant-text opt-out).
			const result = applyCompactPipeline(content, [
				ANSI_STRIP_STAGE,
				BLANK_COLLAPSE_STAGE,
				new TruncationStage(maxChars, {
					preserveImportant: true,
					marker: { verb: "truncated", unit: "chars", headSeparator: "\n\n", tailSeparator: "\n" },
				}),
			]);
			return result.text;
		}
		return content;
	} catch {
		return undefined;
	}
}

function safeSharedName(name: string): string {
	const normalized = name.replaceAll("\\", "/").replace(/^\.\/+/, "");
	if (!normalized || normalized.split("/").some((segment) => segment === "..") || path.isAbsolute(normalized)) throw new Error(`Invalid shared artifact name: ${name}`);
	return normalized;
}

export function sharedPath(manifest: TeamRunManifest, name: string): string {
	const sharedRoot = path.resolve(manifest.artifactsRoot, "shared");
	const resolved = path.resolve(sharedRoot, safeSharedName(name));
	const relative = path.relative(sharedRoot, resolved);
	if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Invalid shared artifact name: ${name}`);
	return resolved;
}

function tryParseJson(text: string): Record<string, unknown> | undefined {
	try {
		const parsed = JSON.parse(text);
		if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
	} catch {
		// Not valid JSON object — return undefined.
	}
	return undefined;
}

function listTaskArtifacts(manifest: TeamRunManifest, taskId: string): string[] | undefined {
	const produced = manifest.artifacts.filter((a) => a.producer === taskId);
	if (produced.length === 0) return undefined;
	return produced.map((a) => {
		const relative = path.relative(manifest.artifactsRoot, a.path);
		return relative.startsWith("..") ? a.path : relative;
	});
}

function aggregateUsage(task: TeamTaskState): DependencyContextEntry["usage"] {
	if (!task.usage) return undefined;
	const inputTokens = task.usage.input ?? 0;
	const outputTokens = task.usage.output ?? 0;
	const started = task.startedAt ? new Date(task.startedAt).getTime() : 0;
	const finished = task.finishedAt ? new Date(task.finishedAt).getTime() : 0;
	const durationMs = started && finished ? finished - started : 0;
	if (inputTokens === 0 && outputTokens === 0 && durationMs === 0) return undefined;
	return { inputTokens, outputTokens, durationMs };
}

/**
 * Apply staleness-aware pruning to shared reads before they are injected
 * into a downstream worker's prompt. Converts shared reads to generic
 * {@link ToolResultEntry}s (toolName="read") and file edits from dependency
 * artifacts, then delegates to {@link pruneToolOutputs}. Superseded reads
 * (same base file re-read, or file edited by a later dependency) are replaced
 * with compact digest notices, reducing context bloat.
 *
 * OPT-IN: the default prune config protects recent results and only fires
 * when minimum-savings hysteresis is met, so small/unique reads pass through
 * unchanged.
 */
function pruneSharedReads(
	reads: Array<{ name: string; path: string; content: string }>,
	dependencies: DependencyContextEntry[],
	artifactsRoot: string,
): Array<{ name: string; path: string; content: string }> {
	if (reads.length === 0) return reads;
	// Convert shared reads to tool result entries (ordered oldest → newest
	// by position in the reads array — earlier entries are "older").
	const entries: ToolResultEntry[] = reads.map((read, index) => ({
		id: `shared-read-${index}`,
		toolName: "read",
		target: read.path,
		content: read.content,
	}));
	// Collect file edit events from dependency artifacts produced to shared/.
	// A dependency that wrote a shared file after an earlier read invalidates
	// that read (the content is now stale relative to the latest version).
	// Artifact entries from listTaskArtifacts() are already relative to
	// artifactsRoot (e.g. "shared/foo.md"), so resolve directly against
	// artifactsRoot — NOT against a "shared" subdirectory (which would
	// double-prefix to <artifactsRoot>/shared/shared/foo.md).
	const fileEdits: FileEditEvent[] = [];
	for (let depIndex = 0; depIndex < dependencies.length; depIndex++) {
		const dep = dependencies[depIndex]!;
		const produced = dep.artifactsProduced ?? [];
		for (const artifact of produced) {
			if (typeof artifact !== "string") continue;
			// Map artifact path (relative to artifactsRoot) to absolute and
			// check against read targets.
			fileEdits.push({ target: path.resolve(artifactsRoot, artifact), index: reads.length + depIndex });
		}
	}
	const pruned = pruneToolOutputs(entries, DEFAULT_PRUNE_CONFIG);
	if (pruned.prunedCount === 0) return reads;
	// Map pruned entries back to the shared-read shape.
	return pruned.results.map((entry, index) => ({ ...reads[index]!, content: entry.content }));
}

export function collectDependencyOutputContext(manifest: TeamRunManifest, tasks: TeamTaskState[], task: TeamTaskState, step: WorkflowStep): DependencyOutputContext {
	const byStep = new Map(tasks.map((item) => [item.stepId, item]).filter((entry): entry is [string, TeamTaskState] => Boolean(entry[0])));
	const byId = new Map(tasks.map((item) => [item.id, item]));
	const dependencies = task.dependsOn.map((dep) => byStep.get(dep) ?? byId.get(dep)).filter((item): item is TeamTaskState => Boolean(item)).map((item) => {
		const resultText = item.resultArtifact ? readIfSmall(item.resultArtifact.path, manifest.artifactsRoot) : undefined;
		return {
			taskId: item.id,
			role: item.role,
			status: item.status,
			resultSummary: resultText ?? "",
			resultPath: item.resultArtifact?.path,
			structuredResults: resultText ? tryParseJson(resultText) : undefined,
			artifactsProduced: listTaskArtifacts(manifest, item.id),
			usage: aggregateUsage(item),
		};
	});
	const rawSharedReads = (step.reads === false ? [] : step.reads ?? []).map((name) => {
		const filePath = sharedPath(manifest, name);
		return { name, path: filePath, content: readIfSmall(filePath, path.resolve(manifest.artifactsRoot, "shared")) ?? "" };
	}).filter((item) => item.content.trim().length > 0);
	// Apply staleness-aware pruning to shared reads: drops superseded reads
	// (same file re-read with different selectors) and replaces stale large
	// outputs with compact digest notices before injecting into the worker
	// prompt. OPT-IN: default config protects recent results.
	const sharedReads = pruneSharedReads(rawSharedReads, dependencies, manifest.artifactsRoot);
	return { dependencies, sharedReads };
}

export function renderDependencyOutputContext(context: DependencyOutputContext): string {
	const parts: string[] = [];
	if (context.dependencies.length) {
		parts.push("# Dependency Outputs", "");
		for (const dep of context.dependencies) {
			parts.push(`## ${dep.taskId} (${dep.role})`, `Status: ${dep.status}`, dep.resultPath ? `Result artifact: ${dep.resultPath}` : "", "", dep.resultSummary?.trim() || "(no result output)", "");
			if (dep.structuredResults) parts.push("Structured results:", JSON.stringify(dep.structuredResults, null, 2), "");
			if (dep.artifactsProduced?.length) parts.push(`Artifacts produced: ${dep.artifactsProduced.join(", ")}`, "");
			if (dep.usage) parts.push(`Usage: ${dep.usage.inputTokens} input tokens, ${dep.usage.outputTokens} output tokens, ${dep.usage.durationMs}ms`, "");
		}
	}
	if (context.sharedReads.length) {
		parts.push("# Shared Run Context Reads", "");
		for (const read of context.sharedReads) parts.push(`## shared/${read.name}`, `Path: ${read.path}`, "", read.content.trim(), "");
	}
	return parts.join("\n").trim();
}

export function writeTaskSharedOutput(manifest: TeamRunManifest, step: WorkflowStep, task: TeamTaskState): ArtifactDescriptor | undefined {
	if (step.output === false) return undefined;
	const name = safeSharedName(step.output || `${task.id}.md`);
	const source = task.resultArtifact ? readIfSmall(task.resultArtifact.path, manifest.artifactsRoot) : undefined;
	if (!source) return undefined;
	return writeArtifact(manifest.artifactsRoot, {
		kind: "metadata",
		relativePath: `shared/${name}`,
		producer: task.id,
		content: source.endsWith("\n") ? source : `${source}\n`,
	});
}

export function writeTaskInputsArtifact(manifest: TeamRunManifest, task: TeamTaskState, context: DependencyOutputContext): ArtifactDescriptor {
	return writeArtifact(manifest.artifactsRoot, {
		kind: "metadata",
		relativePath: `metadata/${task.id}.inputs.json`,
		producer: task.id,
		content: `${JSON.stringify(context, null, 2)}\n`,
	});
}

export function aggregateTaskOutputs(tasks: TeamTaskState[], manifest?: TeamRunManifest): string {
	return tasks.map((task, index) => {
		const body = task.resultArtifact ? readIfSmall(task.resultArtifact.path, manifest?.artifactsRoot) : undefined;
		const hasBody = Boolean(body?.trim());
		const expectedMissing = task.resultArtifact && !containedExists(task.resultArtifact.path, manifest?.artifactsRoot);
		const status = task.status === "skipped"
			? "SKIPPED"
			: task.status === "failed"
				? `FAILED${task.exitCode !== undefined ? ` (exit code ${task.exitCode ?? "null"})` : ""}${task.error ? `: ${task.error}` : ""}`
				: expectedMissing
					? `EMPTY OUTPUT (expected result artifact missing: ${task.resultArtifact?.path})`
					: !hasBody
						? "EMPTY OUTPUT (no textual response returned)"
						: task.status.toUpperCase();
		return [
			`=== Task ${index + 1}: ${task.id} (${task.agent}) ===`,
			`Status: ${status}`,
			task.role ? `Role: ${task.role}` : "",
			task.resultArtifact?.path ? `Result artifact: ${task.resultArtifact.path}` : "",
			task.logArtifact?.path ? `Log artifact: ${task.logArtifact.path}` : "",
			task.transcriptArtifact?.path ? `Transcript: ${task.transcriptArtifact.path}` : "",
			task.usage ? `Usage: ${JSON.stringify(task.usage)}` : "",
			"",
			hasBody ? body!.trim() : status,
		].filter(Boolean).join("\n");
	}).join("\n\n");
}
