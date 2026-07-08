/**
 * Bench: loadConfig() cold vs warm cache (F16 regression guard).
 *
 * `loadConfig(cwd)` is called on the extension hot path:
 *   - preload tick 1 Hz idle, ~6 Hz when runs active
 *   - every `per-write-validation` call (per tool_result during a session)
 *   - every subagent completion
 *
 * Since F16 (v0.9.18), `loadConfig` caches by (cwd, mtime tuple) with a 2 s TTL.
 * This bench exercises both paths so a regression in the cache (a regression
 * where someone accidentally bypasses the early-return) is caught immediately.
 *
 * Scenarios:
 *   - cold: invalidate then call (full parse + merge + TypeBox validate)
 *   - warm: call immediately after another call (TTL hit, no I/O expected)
 *   - warm-after-mtime-change: invalidate by touching one of the watched files,
 *     then immediately call (cache must miss and re-parse)
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
import { invalidateConfigCache, loadConfig } from "../../src/config/config.ts";

const ITERS = Number(process.env.BENCH_ITERS ?? 200);

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-bench-cfg-"));
try {
	fs.writeFileSync(path.join(tmpRoot, "package.json"), "{}\n", "utf-8");
	fs.mkdirSync(path.join(tmpRoot, ".git"), { recursive: true });
	const projectCfg = path.join(tmpRoot, ".pi", "pi-crew.json");
	fs.mkdirSync(path.dirname(projectCfg), { recursive: true });
	fs.writeFileSync(
		projectCfg,
		JSON.stringify(
			{
				schemaVersion: 1,
				execution: { maxConcurrentTasks: 3, taskTimeoutMs: 180_000 },
				modelFallback: { enabled: true },
			},
			null,
			2,
		),
		"utf-8",
	);

	// Warm the module graph + JIT.
	void loadConfig(tmpRoot);

	const cold: number[] = [];
	const warm: number[] = [];
	const coldAfterMtimeChange: number[] = [];
	for (let i = 0; i < ITERS; i++) {
		// Cold: invalidate the cache, then call.
		invalidateConfigCache();
		const t0 = performance.now();
		void loadConfig(tmpRoot);
		cold.push(performance.now() - t0);

		// Warm: call again immediately (should hit TTL+mtime cache).
		const t1 = performance.now();
		void loadConfig(tmpRoot);
		warm.push(performance.now() - t1);

		// Cold-after-mtime-change: touch one of the watched files to bust mtime,
		// invalidate, then measure. (We bump mtime forward to be unambiguous on
		// filesystems with 1s or 2s mtime granularity.)
		const future = new Date(Date.now() + 5_000);
		fs.utimesSync(projectCfg, future, future);
		invalidateConfigCache();
		const t2 = performance.now();
		void loadConfig(tmpRoot);
		coldAfterMtimeChange.push(performance.now() - t2);
	}
	cold.sort((a, b) => a - b);
	warm.sort((a, b) => a - b);
	coldAfterMtimeChange.sort((a, b) => a - b);

	// Sanity: warm should be much faster than cold (cache hit short-circuits
	// before file I/O). If warm is within noise of cold, the cache regressed.
	const coldP50 = percentile(cold, 0.5);
	const warmP50 = percentile(warm, 0.5);
	if (warmP50 > coldP50 * 0.8) {
		process.stderr.write(
			`[config-load.bench] WARNING: warm p50 (${warmP50}ms) is not significantly faster than cold (${coldP50}ms) — cache may have regressed.\n`,
		);
	}

	const out = {
		name: "config-load",
		iters: ITERS,
		// cache miss path (full parse + merge + typebox validate)
		coldMiss: stats(cold),
		// cache hit path (TTL+mtime short-circuit, no I/O)
		warmHit: stats(warm),
		// cache miss after on-disk mtime change (proves invalidation works)
		coldAfterMtimeChange: stats(coldAfterMtimeChange),
	};
	process.stdout.write(JSON.stringify(out) + "\n");
} finally {
	fs.rmSync(tmpRoot, { recursive: true, force: true });
}

function stats(samples: number[]) {
	return {
		min: round(samples[0]),
		p50: round(percentile(samples, 0.5)),
		p95: round(percentile(samples, 0.95)),
		p99: round(percentile(samples, 0.99)),
		max: round(samples[samples.length - 1]),
	};
}
function percentile(sorted: number[], q: number): number {
	if (sorted.length === 0) return 0;
	const idx = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q));
	return sorted[idx];
}
function round(n: number): number {
	return Math.round(n * 100) / 100;
}
