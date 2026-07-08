/**
 * Bench: discoverWorkflows() repeated call cost (F17 baseline).
 *
 * `discoverWorkflows(cwd)` is invoked in `powerbar-publisher.ts:284`
 * every time the powerbar coalescer flushes (≤200ms = up to ~5 Hz when a
 * run is active and emitting events). Each call walks 3 roots (builtin,
 * user, project), each requiring `readdirSync` × 2 + `readFileSync` +
 * regex-parse per `.workflow.md` file.
 *
 * Before F17 (no cache): cold = repeated full scan, hot path p50 already
 * shows the cost we are paying per render. After F17 (TTL + dirStamp):
 * cold should drop to a few statSync calls per dir during the TTL window.
 *
 * Scenarios:
 *   - repeat: call N times back-to-back (current behavior — no cache)
 *   - resolved: distinguishes between first call and subsequent ones
 *     so the post-fix bench can show the cache hit-rate clearly.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
import { discoverWorkflows } from "../../src/workflows/discover-workflows.ts";

const ITERS = Number(process.env.BENCH_ITERS ?? 200);

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-bench-wf-"));
try {
	// Mark as a project root so projectCrewRoot() returns <tmpRoot>/.crew
	fs.writeFileSync(path.join(tmpRoot, "package.json"), "{}\n", "utf-8");
	fs.mkdirSync(path.join(tmpRoot, ".git"), { recursive: true });

	// Warm the module graph + V8 JIT: one throwaway call before timing.
	discoverWorkflows(tmpRoot);

	const first: number[] = [];
	const repeat: number[] = [];
	for (let i = 0; i < ITERS; i++) {
		const t0 = performance.now();
		discoverWorkflows(tmpRoot);
		const took = performance.now() - t0;
		if (i === 0) first.push(took);
		else repeat.push(took);
	}
	first.sort((a, b) => a - b);
	repeat.sort((a, b) => a - b);

	// Also capture which workflows were discovered (sanity check the cwd).
	const discovered = discoverWorkflows(tmpRoot);
	const out = {
		name: "discover-workflows",
		iters: ITERS,
		cwdIsProject: true,
		builtinCount: discovered.builtin.length,
		userCount: discovered.user.length,
		projectCount: discovered.project.length,
		firstCall: stats(first),
		subsequent: stats(repeat.slice(1)),
		allRepeats: stats(repeat),
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
