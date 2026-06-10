# Issue 15: reconcileOrphanedTempWorkspaces

**Status**: pre-existing (file was modified in 56 commits but the test was already failing before — see NEW regression in `stale-reconciler.test.ts`)
**Severity**: Medium
**Component**: `src/state/stale-reconciler.ts`
**Test count**: 1 failing (pre-existing portion)

## Summary

Test verifies that `reconcileOrphanedTempWorkspaces` correctly identifies and cleans up orphaned temp workspaces. The test added a `beforeEach` cleanup in the 56 commits (commit unclear, but the diff shows +24 lines) to remove `pi-crew-*` dirs in `/tmp`. The test was still failing before that change too — suggesting the test logic has a deeper issue.

## Failing test

| Test | File | Line |
|---|---|---|
| `reconcileOrphanedTempWorkspaces` | `test/unit/stale-reconciler.test.ts` | :8828 |

> Note: there are also 3 NEW regressions in `stale-reconciler.test.ts` (related to the `beforeEach` cleanup added in the 56 commits). These are categorized separately.

## Possible root cause

- The `ORPHAN_TEMP_SCAN_BATCH_SIZE=50` limit (referenced in the test's `beforeEach` cleanup comment) may be too small for the test environment, which has accumulated hundreds of `pi-crew-*` dirs from prior test runs.
- The `stale-reconciler` may have a different scanning strategy than the test expects.
- The test setup may create workspaces that the reconciler doesn't consider "orphaned" by the current heuristic.

## Suggested fix

1. Run in isolation:
   ```bash
   cd /home/bom/source/my_pi/pi-crew
   node --test --test-timeout=15000 test/unit/stale-reconciler.test.ts
   ```
2. Clean up `/tmp/pi-crew-*` dirs manually:
   ```bash
   rm -rf /tmp/pi-crew-*
   ```
3. Re-run to see if it's a stale-state issue.

## Related

- `src/state/stale-reconciler.ts`
- `src/runtime/cleanup.ts` (the new orphan temp cleanup added in 56 commits)
- `src/runtime/orphan-worker-registry.ts` (related)

## Priority

**Medium** — affects background cleanup, may accumulate cruft over time.
