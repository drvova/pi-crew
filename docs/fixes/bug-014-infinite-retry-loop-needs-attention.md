# Bug #14 Fix: Infinite Retry Loop — needs_attention Task Re-scheduled

**Date**: 2026-05-20  
**Root Cause**: `needs_attention` task status had `queue: "blocked"` instead of `queue: "done"` in task graph  
**Status**: ✅ Fixed

## Problem

When a task ended with `needs_attention` status (worker completed without calling `submit_result`), the team-runner kept re-scheduling the task in an infinite loop.

### Symptoms
- 942 `task.started` events for `01_explore`
- 1882 `task.needs_attention` events
- Task `01_explore` had `status: "running"` but `finishedAt: "2026-05-20T01:57:46.097Z"` (finished but status was "running")
- `queue: "blocked"` in task graph for `needs_attention` tasks
- No `task.completed` events

### Run Data (from `team_20260520015649_42079220e6ef2860`)
```
Task 01_explore:
  status: running
  stepId: explore
  graph.queue: blocked
  dependsOn: []
  finishedAt: 2026-05-20T01:57:46.114Z
```

## Root Cause

In `src/runtime/task-graph-scheduler.ts`, the `withQueue()` function assigned `queue: "done"` only for `"completed"` and `"skipped"` statuses, but NOT for `"needs_attention"`:

```typescript
// BEFORE (bug):
if (task.status === "completed" || task.status === "skipped") {
    return { ...task, graph: { ...task.graph, queue: "done" } };
}
return { ...task, graph: { ...task.graph, queue: "blocked" } };
```

This meant `needs_attention` tasks got `queue: "blocked"`, making them appear in `taskGraphSnapshot(tasks).ready` as "ready" even though they were terminal.

The team-runner's main loop:
1. Computed `effectiveReady` from `taskGraphSnapshot(tasks).ready`
2. `effectiveReady` included tasks with `queue: "blocked"` (because they had `needs_attention` status)
3. These tasks were added to `readyBatch` and re-spawned

## Fix

Added `needs_attention` to the terminal status check in `withQueue()`:

```typescript
// AFTER (fix):
if (task.status === "completed" || task.status === "skipped" || task.status === "needs_attention") {
    return { ...task, graph: { ...task.graph, queue: "done" } };
}
```

## File Changed

| File | Change |
|---|---|
| `src/runtime/task-graph-scheduler.ts` | Added `needs_attention` to terminal queue assignment |

## Verification

```bash
cd /home/bom/source/my_pi/pi-crew
npx tsc --noEmit  # No errors
```

After fix, `needs_attention` tasks have `queue: "done"` in task graph, so they won't be re-scheduled.

## Related Behavior

- `needs_attention` already correctly blocks phase advancement in `team-runner.ts` (`terminalStatuses` includes `needs_attention`)
- `needs_attention` correctly does NOT satisfy DAG dependencies (only `completed` does)
- Phase advancement checks `terminalStatuses.has(task.status)` which includes `needs_attention`

This ensures:
1. `needs_attention` tasks are treated as terminal (don't block phases)
2. `needs_attention` tasks have `queue: "done"` (don't get re-scheduled)
3. Downstream tasks with `dependsOn` on a `needs_attention` task correctly stay blocked