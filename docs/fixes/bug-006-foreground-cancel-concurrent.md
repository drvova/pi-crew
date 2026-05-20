# Bug #6: Foreground fast-fix team cancelled after explore — ROOT CAUSE CONFIRMED

| Field | Value |
|---|---|
| **Severity** | 🔴 HIGH |
| **Status** | Root cause confirmed, 100% reproducible |
| **Affected** | Foreground team runs when concurrent tool calls happen |
| **Symptom** | Explore completes with zero output, run immediately cancelled |

## Reproduce (100%)

1. Start a foreground fast-fix team run
2. While it's running, call ANY other team action (get, plan, settings, etc.)
3. Result: Explore "completes" with `outputLength=0, jsonEvents=0, toolUses=0` → run cancelled

## Without concurrent calls

Same fast-fix run with NO other tool calls → **completes successfully** with `jsonEvents=120`, full output.

## Root Cause

When multiple tool calls happen concurrently with a foreground live-session run:

1. Foreground run starts, spawns live-session agent for explore
2. User calls `team get`, `team plan`, `team settings`, etc.
3. Pi processes these tool calls in the same session
4. Pi may trigger **auto-compaction** (context grows from tool outputs)
5. Compaction or context operation **interrupts the live-session agent**
6. Live-session agent's prompt returns with **zero output** (`outputLength:0`)
7. team-runner marks task as "completed" (exit code 0, but no output)
8. Next phase transition fails — run gets `"caller_cancelled"` abort

### Evidence chain

```
Successful run (no concurrent calls):
  live-session.prompt_done: elapsedMs=30888, jsonEvents=30, outputLength=20894
  → All 3 tasks complete

Failed run (with concurrent tool calls):
  live-session.prompt_done: elapsedMs=32304, jsonEvents=0, outputLength=0
  → Explore "completes" with nothing, run immediately cancelled
```

The `"outputLength":0` is the smoking gun — the live-session agent's prompt completed
without producing any output because Pi was busy processing other tool calls.

### Key difference in status.json

| Field | Successful | Failed |
|---|---|---|
| jsonEvents | 120 | 0 |
| toolUses | many | 0 |
| output | full context | empty |

## Fix suggestions

### Option A: Queue concurrent tool calls during foreground run
When a foreground run is active, queue other team tool calls instead of processing immediately.

### Option B: Protect live-session prompt from interruption
In `live-session-runtime.ts`, add a guard that prevents context operations during `session.prompt()`.

### Option C: Detect zero-output completion as failure
In `team-runner.ts`, when a live-session task completes with `outputLength=0` and `toolUses=0`, treat it as a failure and retry instead of proceeding.

### Option D: Warn user
When foreground run is active and user calls another team action, return a warning:
"Foreground run is active. Concurrent operations may interrupt the running agent."

## Files

```
pi-crew/src/extension/register.ts          — startForegroundRun(), concurrent tool handling
pi-crew/src/runtime/live-session-runtime.ts — promptWithTimeout(), output capture
pi-crew/src/runtime/team-runner.ts          — task completion handling
pi-crew/src/extension/registration/compaction-guard.ts — auto-compaction during runs
```
