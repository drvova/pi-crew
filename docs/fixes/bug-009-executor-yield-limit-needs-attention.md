# Bug #9 Fix: Executor Yield Limit — New `needs_attention` Status

**Date**: 2026-05-19  
**Root Cause**: Executor agent completes work but doesn't call `submit_result` → yield enforcement sends 3 reminders → task marked `completed` with `exitCode: 0` → artifact missing/incomplete  
**Status**: ✅ Fixed

## Problem

When an executor agent (or any live-session worker) completes its task but doesn't call the `submit_result` tool:

1. The live-session runtime's yield enforcement loop runs (max 3 reminders × 500ms = 1.5s window)
2. After 3 reminders with no `submit_result`, a `task.attention` event fires with `reason: "no_yield"`
3. But the task is still marked `status: "completed"` with `exitCode: 0`
4. The `resultArtifact` contains `liveResult.stdout || "(no output)"` — which may be empty
5. The executor's actual file write was completed but never captured in the result artifact

This means tasks that didn't properly submit their result appear "completed" in the UI, misleading users into thinking the work was done.

## Fix

Added a new `needs_attention` task status that is set when a worker completes without calling `submit_result`.

### New Status: `needs_attention`

- **Type**: Terminal status (like `completed`, `failed`, `cancelled`, `skipped`)
- **Meaning**: Worker finished executing but didn't submit a result — work may or may not be complete
- **Transitions**: `running → needs_attention`, `needs_attention → queued` (retry), `needs_attention → running` (re-run)
- **Icon**: ⚠ (warning sign) in UI

### Changes

| File | Change |
|---|---|
| `src/state/contracts.ts` | Added `"needs_attention"` to `TEAM_TASK_STATUSES`, `TEAM_TERMINAL_TASK_STATUSES`, `TEAM_TASK_STATUS_TRANSITIONS`, `TEAM_EVENT_TYPES` |
| `src/runtime/task-runner.ts` | Added `noYield` flag; when no yield detected → set `status: "needs_attention"` instead of `"completed"`, emit `"task.needs_attention"` event |
| `src/runtime/crew-agent-runtime.ts` | Added `"needs_attention"` to `CrewAgentStatus` type; updated `taskStatusToAgentStatus()` |
| `src/runtime/team-runner.ts` | Added `"needs_attention"` to `terminalStatuses` set for workflow phase advancement |
| `src/runtime/stale-reconciler.ts` | Added `"needs_attention"` to `allTerminal` check |
| `src/runtime/crash-recovery.ts` | Added `"needs_attention"` to `isTerminalTask()` |
| `src/runtime/phase-progress.ts` | Added `"needs_attention"` to `TERMINAL_STATUSES` |
| `src/runtime/task-display.ts` | Added ⚠ icon for `"needs_attention"` status |
| `src/ui/snapshot-types.ts` | Added `needsAttention?: number` to `RunUiProgress` |
| `src/ui/run-snapshot-cache.ts` | Track `"needs_attention"` tasks in progress calculation |
| `src/ui/crew-widget.ts` | Added `"needs_attention"` to `ERROR_STATUSES`; added ⚠ icon |
| `src/ui/run-event-bus.ts` | Added `"task.needs_attention"` to `WORKER_LIFECYCLE_TYPES` |
| `src/config/defaults.ts` | Added `"task.needs_attention"` to `terminalEventTypes` |
| `src/state/event-reconstructor.ts` | Added `"task.needs_attention"` event → `"needs_attention"` status mapping |
| `src/observability/event-to-metric.ts` | Added `"crew.task.needs_attention"` metric |

## Status Transition Graph (Updated)

```
queued → running → completed ✓
                 → failed ✗
                 → cancelled ■
                 → needs_attention ⚠ (NEW)

needs_attention → queued (retry)
                → running (re-run)
```

## Verification

```bash
cd /home/bom/source/my_pi/pi-crew
npx tsc --noEmit  # No errors
npx vitest run test/unit/stale-reconciler.test.ts  # All 8 tests pass
```

## User Impact

- Tasks that previously showed as "completed" (✓) with missing artifacts now show as "⚠ needs_attention"
- Users can clearly see which tasks need manual review
- Downstream tasks (verifier, etc.) will see the task as "needs_attention" instead of "completed" and can adjust behavior accordingly
- Workflow phase advancement correctly treats `needs_attention` as a terminal status
