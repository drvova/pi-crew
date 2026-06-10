# Issue 10: adaptive implementation workflow

**Status**: pre-existing
**Severity**: Medium
**Component**: `src/runtime/adaptive-implementation.ts` + workflow engine
**Test count**: 4 failing

## Summary

Tests for the "adaptive implementation" workflow — a feature that allows the team-runner to dynamically re-plan tasks mid-execution when failures occur, with optional `PI_CREW_ADAPTIVE_REPAIR` env knob.

## Failing tests

| Test | File | Line |
|---|---|---|
| `implementation workflow produces runnable result with mock child-pi` | (unknown source) | :19 |
| `implementation workflow with PI_CREW_ADAPTIVE_REPAIR=0 behaves consistently` | `test/unit/adaptive-implementation.test.ts` | :20 (line 579) |
| `requirePlanApproval blocks mutating adaptive tasks until approved` | `test/unit/adaptive-implementation.test.ts` | :22 (line 1586) |
| `adaptive workflow steps reconstruct from persisted tasks on resume` | `test/unit/adaptive-implementation.test.ts` | :24 (line 3882) |
| `implementation run injects planner-selected multi-agent ready batches` | (unknown source) | :1119 |

## Possible root cause

- The adaptive workflow depends on `src/state/locks.ts` and `src/state/state-store.ts`. Both have had changes (issue #02, #04) that could affect workflow execution.
- The mock `child-pi` may not be providing the expected interface.
- The `requirePlanApproval` flag may be wired to a different field name.

## Suggested fix

1. Run in isolation:
   ```bash
   cd /home/bom/source/my_pi/pi-crew
   node --test --test-timeout=30000 test/unit/adaptive-implementation.test.ts
   ```
2. Check the workflow definition for `adaptive` step type.
3. Verify the env var name matches `PI_CREW_ADAPTIVE_REPAIR`.

## Related

- `src/runtime/adaptive-implementation.ts` (likely file)
- `src/workflow/` (workflow definitions)
- `src/state/state-store.ts` (state persistence)
- `src/state/locks.ts` (concurrent access)

## Priority

**Medium** — affects a "power user" feature, not core team-runner.
