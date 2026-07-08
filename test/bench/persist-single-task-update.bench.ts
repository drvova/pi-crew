/**
 * Bench: per-task state update write cost (F2 / F4 baseline).
 *
 * `persistSingleTaskUpdate` is called ~5× per task as it transitions through
 * queued → running → checkpointed → completed. Internally it:
 *   - acquires the run lock
 *   - re-reads tasks.json
 *   - runs a 100-iteration mtime-CAS retry loop (3 statSync per attempt)
 *   - writes a merged tasks.json via `saveRunTasksCoalesced`
 *
 * To isolate the **write cost** from the lock acquisition + read cost, we
 * benchmark the underlying primitive `atomicWriteJsonCoalesced` (which is
 * exactly what the post-mutation call dispatches) against the durable
 * `atomicWriteJson` baseline. After F4 ships, write-time fsync cost on
 * non-terminal writes will collapse; this bench proves it numerically.
 *
 * Scenarios:
 *   - tasks.json-equivalent payload (20 tasks, ~6 KB), durable path
 *   - same payload, coalesced path (the F4 default once durability-param
 *     wiring is in)
 *   - throughput burst that exercises the coalescing window (10 rapid calls
 *     to one path) — after coalesced write this collapses to 1 disk write
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
import { atomicWriteJson, atomicWriteJsonCoalesced, flushPendingAtomicWrites } from "../../src/state/atomic-write.ts";

const ITERS = Number(process.env.BENCH_ITERS ?? 200);

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-bench-ptu-"));
try {
	fs.writeFileSync(path.join(tmpRoot, "package.json"), "{}\n", "utf-8");
	fs.mkdirSync(path.join(tmpRoot, ".git"), { recursive: true });

	// Realistic tasks.json-shaped payload (one full run, 20 tasks).
	const T0 = new Date().toISOString();
	const taskTemplate = (i: number) => ({
		id: `task-${i}`,
		runId: "bench",
		role: "executor",
		agent: "executor",
		title: `bench task ${i}`,
		status: i < 4 ? ("completed" as const) : i < 6 ? ("running" as const) : ("queued" as const),
		dependsOn: i === 0 ? [] : [`task-${i - 1}`],
		cwd: tmpRoot,
		startedAt: i < 6 ? T0 : undefined,
		finishedAt: i < 4 ? T0 : undefined,
		attempts: i < 4 ? [{ attempt: 1, startedAt: T0, finishedAt: T0 }] : [],
		usage: { input: 100, output: 50, turns: 1 },
		verification:
			i < 4
				? {
						requiredGreenLevel: "workspace" as const,
						observedGreenLevel: "workspace" as const,
						satisfied: true,
						commands: [],
					}
				: undefined,
	});
	const payload = () => Array.from({ length: 20 }, (_v, i) => taskTemplate(i));

	const durable = path.join(tmpRoot, "tasks.durable.json");
	const coalesced = path.join(tmpRoot, "tasks.coalesced.json");

	// Scenario 1: durable write (atomicWriteJson, fsync data + parent dir).
	const durableSamples: number[] = [];
	for (let i = 0; i < ITERS; i++) {
		const t0 = performance.now();
		atomicWriteJson(durable, payload());
		durableSamples.push(performance.now() - t0);
	}
	durableSamples.sort((a, b) => a - b);

	// Scenario 2: coalesced write (atomicWriteJsonCoalesced, 50 ms debounce).
	// We must `flushPendingAtomicWrites` before the next iteration to measure
	// the synchronous write cost in isolation (otherwise the coalescer buffers
	// and the measured number becomes the return-from-buffer cost).
	const coalescedSamples: number[] = [];
	for (let i = 0; i < ITERS; i++) {
		const t0 = performance.now();
		atomicWriteJsonCoalesced(coalesced, payload());
		flushPendingAtomicWrites();
		coalescedSamples.push(performance.now() - t0);
	}
	coalescedSamples.sort((a, b) => a - b);

	// Scenario 3: 10-write burst to a single path. Measures how the coalescer
	// amortizes the fsync cost: should be ~1 disk write total, not 10.
	const burstSamples: number[] = [];
	const BURST = 10;
	for (let i = 0; i < ITERS / BURST; i++) {
		const t0 = performance.now();
		for (let j = 0; j < BURST; j++) {
			atomicWriteJsonCoalesced(coalesced, payload());
		}
		flushPendingAtomicWrites();
		burstSamples.push(performance.now() - t0);
	}
	burstSamples.sort((a, b) => a - b);

	// Sanity: coalesced file is valid JSON and matches last payload's shape.
	const finalTasks = JSON.parse(fs.readFileSync(coalesced, "utf-8"));
	if (!Array.isArray(finalTasks) || finalTasks.length !== 20) {
		throw new Error("coalesced-bench invariant: final file is not a 20-element task array");
	}

	const out = {
		name: "persist-single-task-update",
		iters: ITERS,
		burstSize: BURST,
		// durable: atomicWriteJson (atomic + fsync + dir fsync)
		durableWrite: stats(durableSamples),
		// coalesced+flush: atomicWriteJsonCoalesced and immediate flush (effectively bypasses coalesce — useful as a control to compare to the burst)
		coalescedFlush: stats(coalescedSamples),
		// real-world: 10 coalesced writes inside one flush window
		burst10: stats(burstSamples),
		perWriteInBurst: stats(burstSamples.map((s) => s / BURST)),
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
