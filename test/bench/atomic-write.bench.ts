/**
 * Bench: atomicWriteJson throughput (HB-003 perf baseline).
 *
 * Measures the cost of `atomicWriteJson` (the durable state-write path used by
 * manifest/task/event persistence) under serial load. The temp-file → fsync →
 * rename dance is on the hot path of every run transition, so a regression
 * here directly slows down every multi-task run.
 *
 * Scenarios:
 *   - cold: first write to a fresh path (temp file creation + fsync)
 *   - warm: overwrite an existing file (fsync only, no create)
 *   - burst10Coalesced: control approximating the post-F4 "best-effort" path
 *     via the existing coalesced-write primitive. Once F4 adds a
 *     `durability: "best-effort"` option to atomicWriteJson, swap this for
 *     that and re-bench.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
import { atomicWriteJson, atomicWriteJsonCoalesced, flushPendingAtomicWrites } from "../../src/state/atomic-write.ts";

const ITERS = Number(process.env.BENCH_ITERS ?? 200);
const PAYLOAD = {
	runId: "bench",
	status: "running",
	tasks: Array.from({ length: 20 }, (_v, i) => ({ id: `t-${i}` })),
	updatedAt: "2026-06-24T00:00:00.000Z",
};

async function benchBestEffortControl(root: string): Promise<ReturnType<typeof stats>> {
	const dir = fs.mkdtempSync(path.join(root, "dur-"));
	const target = path.join(dir, "warm.json");
	fs.writeFileSync(target, JSON.stringify(PAYLOAD));
	const samples: number[] = [];
	for (let i = 0; i < ITERS; i++) {
		flushPendingAtomicWrites();
		const t0 = performance.now();
		atomicWriteJsonCoalesced(target, { ...PAYLOAD, i });
		flushPendingAtomicWrites();
		samples.push(performance.now() - t0);
	}
	samples.sort((a, b) => a - b);
	fs.rmSync(dir, { recursive: true, force: true });
	return stats(samples);
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-bench-aw-"));
try {
	const targetCold = path.join(tmpRoot, "cold.json");
	const targetWarm = path.join(tmpRoot, "warm.json");
	// Pre-create the warm target so the first measured write is an overwrite.
	atomicWriteJson(targetWarm, PAYLOAD);

	const cold: number[] = [];
	const warm: number[] = [];
	for (let i = 0; i < ITERS; i++) {
		const t0 = performance.now();
		atomicWriteJson(targetCold, { ...PAYLOAD, i });
		cold.push(performance.now() - t0);

		const t1 = performance.now();
		atomicWriteJson(targetWarm, { ...PAYLOAD, i });
		warm.push(performance.now() - t1);
	}
	cold.sort((a, b) => a - b);
	warm.sort((a, b) => a - b);

	const bestEffortStats = await benchBestEffortControl(tmpRoot);

	const out = {
		name: "atomic-write-json",
		iters: ITERS,
		payloadBytes: JSON.stringify(PAYLOAD).length,
		cold: stats(cold),
		warm: stats(warm),
		// Pre-F4 control: coalesced+flush approximates the fsync-less path.
		// Post-F4 swap to atomicWriteJson(warm, payload, { durability: "best-effort" }).
		bestEffortControl: bestEffortStats,
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
