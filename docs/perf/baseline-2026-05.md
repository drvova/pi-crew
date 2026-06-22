# pi-crew Performance Baseline — 2026-05

Date captured: 2026-05-14
Branch: `perf/baseline-bench`
Environment:
- OS: Windows (`win32`)
- Node: v24.10.0
- npm: 11.6.1
- Pi: installed at `C:\Users\baphu\AppData\Roaming\npm\pi.ps1`

## How to capture

```powershell
cd pi-crew
npm install                         # if node_modules missing
npm run typecheck
npm run bench:capture               # writes test/bench/baseline.json
npm run profile:startup             # writes .profile/summary.json
```

## How to verify against baseline (CI gate)

```powershell
npm run bench
npm run bench:check                 # fails if any p95 regresses > 15%
```

Override threshold or baseline path:

```powershell
$env:THRESHOLD_PCT = 10              # tighter
$env:BASELINE = "test/bench/baseline-2026-05.json"
```

## Bench results (commit 2026-05-14, end of Sprint 1)

> Sprint 0 captured the original baseline; Sprint 1 re-captured at the
> end of the sprint. Subsequent sprint:check gates compare against this
> table (the JSON in `test/bench/baseline.json`).

### register-startup (cold load via child process, 20 iters)

| Metric | min | p50 | p95 | p99 | max |
|---|---|---|---|---|---|
| import (ms) | 513.76 | 528.15 | 542.49 | 542.49 | 566.58 |
| register (ms) | 23.32 | 24.27 | 25.49 | 25.49 | 26.45 |

### render-flush (200 events / iter, 100 iters)

| Metric | min | p50 | p95 | p99 | max |
|---|---|---|---|---|---|
| ms | 0.07 | 0.10 | 0.25 | 1.02 | 1.12 |

### snapshot-cache (10 tasks, 200 events, 50 iters)

| Metric | min | p50 | p95 | p99 | max |
|---|---|---|---|---|---|
| cold (ms) | 2.14 | 2.42 | 2.82 | 2.92 | 3.01 |
| warm (ms) | 2.16 | 2.41 | 2.70 | 2.75 | 3.99 |

### Delta vs Sprint-0 baseline

| Metric | Sprint 0 | Sprint 1 | Delta |
|---|---|---|---|
| register-startup.import.p95 | 655.39 | 542.49 | **−17.2 %** |
| register-startup.register.p95 | 27.51 | 25.49 | **−7.3 %** |
| render-flush.p95 | 0.36 | 0.25 | **−30.6 %** |
| snapshot-cache.cold.p95 | 3.06 | 2.82 | **−7.8 %** |
| snapshot-cache.warm.p95 | 3.06 | 2.70 | **−11.8 %** |

## Profile-startup (5 iters)

| Metric | Value |
|---|---|
| importMs | 609.48 |
| registerMs.p50 | 6.40 |
| registerMs.p95 | 9.02 |
| registerMs.max | 30.98 |

CPU profile: `.profile/startup-2026-05-14T14-38-20-180Z.cpuprofile` (open in Chrome DevTools → Performance → Load profile).

> `registerMs` is lower than the register-startup bench because the profile runs 5 iters in the same process (the module cache is warm after iter 1). The `register-startup` bench is what reflects the actual cold start.

## Sprint targets (vs. the baseline above)

| Metric | Baseline | Target after completing the full plan | Expected sprint |
|---|---|---|---|
| register-startup.import.p95 | 655 ms | ≤ 400 ms (lazy) / ≤ 200 ms (bundled) | 2 / 5 |
| register-startup.register.p95 | 27.5 ms | ≤ 25 ms (keep as-is) | — |
| render-flush.p95 | 0.36 ms | ≤ 0.5 ms (keep as-is) | — |
| snapshot-cache.cold.p95 | 3.06 ms | ≤ 2.1 ms (-30%) | 1, 2 |
| snapshot-cache.warm.p95 | 3.06 ms | ≤ 1.5 ms (-50%) | 1, 2 |
| dashboard FPS while a run is active | n/a | +50% | 3 |
| events.jsonl tail 32 KB parse p95 | n/a | < 5 ms | 2 |
| cancel round-trip | n/a | < 200 ms | 4 |

## Files committed for the gate

- `scripts/profile-startup.mjs` — CPU profile harness.
- `scripts/run-bench.mjs` — run all benches, collect to `results.json`.
- `scripts/bench-check.mjs` — gate; fails on > 15 % regression.
- `test/bench/register-startup.bench.ts`
- `test/bench/render-flush.bench.ts`
- `test/bench/snapshot-cache.bench.ts`
- `test/bench/baseline.json` — committed.
- `package.json` scripts: `bench`, `bench:check`, `bench:capture`, `profile:startup`.
- `.gitignore`: `.profile/`, `test/bench/results.json`, `*.cpuprofile`.

## Caveats

- The baseline was recorded on a single Windows machine. Other machines with different CPU/disk will produce different numbers. When you need to re-baseline (Node major bump, OS upgrade, different CI machine), copy `results.json → baseline.json` and write a new file `baseline-<date>.md`.
- The `register-startup` bench takes ~13 s (20 iters × 600 ms); keep it in CI. Locally you can set `BENCH_ITERS=5` for fast debugging.
- The bench does not run as part of `npm test` to keep the test suite fast; trigger it separately via `npm run bench` or a dedicated CI step.
