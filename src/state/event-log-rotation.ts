import * as fs from "node:fs";
import { readEvents } from "./event-log.ts";
import { atomicWriteFile } from "./atomic-write.ts";

export interface RotationConfig {
	maxFileSizeBytes: number;
	maxEventCount: number;
	compactToCount: number;
}

const DEFAULT_ROTATION_CONFIG: RotationConfig = {
	maxFileSizeBytes: 5 * 1024 * 1024,
	maxEventCount: 50_000,
	compactToCount: 1_000,
};

function resolveConfig(config?: Partial<RotationConfig>): RotationConfig {
	return { ...DEFAULT_ROTATION_CONFIG, ...config };
}

/**
 * Check if an event file needs rotation/compaction.
 * Checks both file size and event count thresholds.
 */
export function needsRotation(eventsPath: string, config?: Partial<RotationConfig>): boolean {
	if (!fs.existsSync(eventsPath)) return false;
	const cfg = resolveConfig(config);
	try {
		const stat = fs.statSync(eventsPath);
		if (stat.size > cfg.maxFileSizeBytes) return true;
	} catch {
		return false;
	}
	// Only count lines if size check didn't already trigger
	try {
		const content = fs.readFileSync(eventsPath, "utf-8");
		const lineCount = content.split("\n").filter(Boolean).length;
		return lineCount > cfg.maxEventCount;
	} catch {
		return false;
	}
}

export interface CompactionResult {
	originalSize: number;
	compactedSize: number;
	eventsRemoved: number;
	eventsKept: number;
}

/**
 * Compact an event log file:
 * 1. Read last `compactToCount` events
 * 2. Write them to a new temp file
 * 3. Atomically rename temp → original
 * 4. Return compaction stats
 */
export function compactEventLog(eventsPath: string, config?: Partial<RotationConfig>): CompactionResult | undefined {
	if (!fs.existsSync(eventsPath)) return undefined;
	const cfg = resolveConfig(config);
	let originalSize: number;
	try { originalSize = fs.statSync(eventsPath).size; } catch { return undefined; }
	const allEvents = readEvents(eventsPath);
	if (allEvents.length <= cfg.compactToCount) return undefined;
	const kept = allEvents.slice(-cfg.compactToCount);
	// Re-read after compaction to merge events appended during read
	const finalEvents = readEvents(eventsPath);
	const appendedAfterRead = finalEvents.slice(allEvents.length);
	const merged = [...kept, ...appendedAfterRead];
	const lines = merged.map((e) => JSON.stringify(e)).join("\n") + "\n";
	try {
		atomicWriteFile(eventsPath, lines);
	} catch {
		// Concurrent write conflict — skip compaction this cycle
		return undefined;
	}
	const compactedSize = fs.statSync(eventsPath).size;
	return {
		originalSize,
		compactedSize,
		eventsRemoved: allEvents.length + appendedAfterRead.length - merged.length,
		eventsKept: merged.length,
	};
}

export interface EventLogStats {
	fileSizeBytes: number;
	eventCount: number;
	oldestTimestamp?: string;
	newestTimestamp?: string;
}

/**
 * Get event log stats (file size, line count, oldest/newest timestamp).
 */
export function getEventLogStats(eventsPath: string): EventLogStats | undefined {
	if (!fs.existsSync(eventsPath)) return undefined;
	try {
		const stat = fs.statSync(eventsPath);
		const content = fs.readFileSync(eventsPath, "utf-8");
		const lines = content.split("\n").filter(Boolean);
		let oldestTimestamp: string | undefined;
		let newestTimestamp: string | undefined;
		if (lines.length > 0) {
			try {
				oldestTimestamp = (JSON.parse(lines[0]) as { time: string }).time;
			} catch { /* ignore corrupt line */ }
			try {
				newestTimestamp = (JSON.parse(lines[lines.length - 1]) as { time: string }).time;
			} catch { /* ignore corrupt line */ }
		}
		return {
			fileSizeBytes: stat.size,
			eventCount: lines.length,
			oldestTimestamp,
			newestTimestamp,
		};
	} catch {
		return undefined;
	}
}
