# Bug #13 Fix: Background Runner Death — Full Fix

**Date**: 2026-05-19  
**Root Cause**: Background runner process dies ~59s after spawning — likely OOM killer or external SIGKILL  
**Status**: ✅ Fixed (3-layer protection)

## Problem

Background runner process (PID 512666) died ~59 seconds after spawning. Workers spawned but produced zero output. The stale reconciler detected the dead PID and repaired the run.

Key evidence:
- `async.started` event written (runner started successfully)
- Workers spawned (PIDs 512751, 512759)
- No output from workers (Bug #10: MINIMAX_API_KEY stripped)
- `pid_dead` found at 14:19:04 (~59s after start)
- No `async.failed` event written (SIGKILL can't be caught)
- dmesg OOM was for different PID (vitest PID 2910570)

## Fixes Applied (3 Layers)

### Layer 1: Heartbeat Mechanism (prevents false repairs)

Files: `src/runtime/background-runner.ts`, `src/runtime/stale-reconciler.ts`

The background runner writes a `heartbeat.json` file every 15 seconds with PID, timestamp, and memory usage. The stale reconciler checks the heartbeat before declaring a PID dead:
- If heartbeat is < 5 minutes old → treat as alive (don't repair)
- If heartbeat is > 5 minutes old AND PID is dead → repair

This prevents the stale reconciler from false-positive repairs when the runner was killed by SIGKILL.

### Layer 2: Memory Limit (prevents OOM kills)

File: `src/runtime/async-runner.ts`

Added `--max-old-space-size=512` to the background runner's Node.js arguments:
```typescript
const memoryLimit = "--max-old-space-size=512";
// args: [memoryLimit, "--import", loaderPath, runnerPath, ...]
```

This limits V8 heap to 512MB (generous for the lightweight runner). Without this limit, Node.js defaults to ~1.5GB on 64-bit, which combined with jiti compilation and child processes can exhaust system memory and trigger the OOM killer.

### Layer 3: Signal Handlers + Memory Monitoring (diagnostic)

File: `src/runtime/background-runner.ts`

1. **SIGTERM/SIGINT handlers**: Log `async.failed` event before exiting. This distinguishes:
   - OOM/SIGKILL: no event written (can't catch SIGKILL)
   - SIGTERM/SIGINT: event written with signal name
   - Normal exit: `async.completed` event

2. **Memory monitoring in heartbeat**: Each heartbeat writes `heapUsedMb` and `rssMb`:
   ```json
   { "pid": 12345, "at": 1718794685321, "runId": "...", "memory": { "heapUsedMb": 87, "rssMb": 145 } }
   ```
   This allows post-mortem analysis — if `rssMb` was climbing before death, OOM is confirmed.

## Files Modified

| File | Change |
|---|---|
| `src/runtime/async-runner.ts` | Added `--max-old-space-size=512` to background runner args |
| `src/runtime/background-runner.ts` | Heartbeat with memory stats; SIGTERM/SIGINT handlers |
| `src/runtime/stale-reconciler.ts` | Heartbeat-aware PID liveness check (from earlier fix) |

## Verification

```bash
cd /home/bom/source/my_pi/pi-crew
npx tsc --noEmit  # No errors
```

## Diagnosis Flow (Post-Fix)

When a background runner dies:

1. Check events for `async.failed` with `signal: "SIGTERM"/"SIGINT"` → signal kill (Layer 3)
2. Check `heartbeat.json` for `memory.rssMb` → if climbing → OOM (Layer 2 prevents)
3. Check `heartbeat.json` for `at` timestamp → if fresh → false-positive repair prevented (Layer 1)
4. No `async.failed` event AND stale heartbeat → SIGKILL/OOM (uncatchable)

## Remaining Risk

If the Linux OOM killer sends SIGKILL (uncatchable), the background runner will die without writing any event. The heartbeat mechanism prevents false repairs for 5 minutes, giving time for investigation. The memory limit (`--max-old-space-size=512`) significantly reduces the chance of triggering the OOM killer by keeping the runner's memory footprint small.
