# Issue 04: orphan-worker-registry test design issues

**Status**: PARTIALLY pre-existing. Some failures pre-date 56 unpushed commits; the test file itself was ADDED in commit `992231d`.
**Severity**: Medium
**Component**: `test/unit/orphan-worker-registry.test.ts` + `src/runtime/orphan-worker-registry.ts`
**Test count**: 4 failing + 1 hang

## Summary

Multiple tests in `orphan-worker-registry.test.ts` fail because the test fixtures omit the `startTime` field on registry entries. The production code's `readRegistry` (in `src/runtime/orphan-worker-registry.ts:174`) requires `startTime` for PID-recycling safety, so entries without `startTime` are filtered out, leading to `result.scanned === 0` when tests expect 1.

## Failing tests (verified at HEAD `08df7ce`)

| Test | File | Line | Pre-existing at origin/main? |
|---|---|---|---|
| `unregisterWorker removes the entry` | `test/unit/orphan-worker-registry.test.ts` | :2 | N/A — file is new |
| `cleanupOrphanWorkers uses SIGKILL (not SIGTERM) on stale workers` | `test/unit/orphan-worker-registry.test.ts` | :1 | N/A — file is new |
| `cleanupOrphanWorkers keeps workers with alive parentPid (concurrent session protection)` | `test/unit/orphan-worker-registry.test.ts` | :1 | N/A — file is new |
| `cleanupOrphanWorkers prunes registry entries that no longer match the schema` | `test/unit/orphan-worker-registry.test.ts` | :2 | N/A — file is new |
| `cleanupOrphanWorkers prunes (not kills) when startTime mismatches (PID recycling detection)` | `test/unit/orphan-worker-registry.test.ts` | :2 | N/A — file is new |

> Note: the orphan-worker-registry test file was ADDED in commit `992231d` ("test(cleanup): add 24 unit tests for orphan temp-dir + worker cleanup"). The file did not exist at origin/main. So strictly speaking these are NEW test failures (from added tests), not regressions of previously-passing tests. They're categorized as "test design issues in new tests" rather than "pre-existing".

## Root cause

`src/runtime/orphan-worker-registry.ts:171-183`:

```ts
return parsed.filter(
  (e): e is OrphanWorkerEntry =>
    typeof e === "object" &&
    e !== null &&
    typeof e.pid === "number" &&
    typeof e.sessionId === "string" &&
    typeof e.runId === "string" &&
    typeof e.registeredAt === "number" &&
    typeof (e as OrphanWorkerEntry).parentPid === "number" &&
    typeof (e as OrphanWorkerEntry).parentPidStartTime === "number" &&  // ← required
    typeof (e as OrphanWorkerEntry).startTime === "number",               // ← required
);
```

The filter is correct (PID-recycling protection). But test fixtures write entries like:

```ts
{
  pid: livePid,
  sessionId: "session-OLD",
  runId: "run-1",
  parentPid: 999_998,
  registeredAt: past,
  // ← missing startTime and parentPidStartTime
}
```

→ filtered out → `result.scanned === 0` (expected 1) → fail.

## Suggested fix (test side)

Add `startTime` and `parentPidStartTime` to all test fixtures:

```ts
// In test fixtures:
{
  pid: livePid,
  sessionId: "session-OLD",
  runId: "run-1",
  parentPid: 999_998,
  parentPidStartTime: 12345,  // ← add
  registeredAt: past,
  startTime: 67890,            // ← add
}
```

## Secondary issue: test file hangs

When running all tests in `orphan-worker-registry.test.ts` together (e.g., `node --test test/unit/orphan-worker-registry.test.ts`), the test runner times out at 30s. **Root cause** (from `strace`):

```
[pid X] openat(...orphan-workers.json.lock, O_EXCL) = -1 EEXIST
[pid X] openat(...orphan-workers.json.lock, O_RDONLY) = 21
[pid X] read(21, "{\"kind\":\"file\",\"pid\":X,...}", 8192) = 115
[pid X] read(21, "", 8192) = 0
... (loops forever)
```

`withFileLockSync` (`src/state/locks.ts:303`) self-deadlocks when the test process re-acquires a lock it just released:
1. Lock acquired with PID X
2. Lock released (file removed)
3. Re-acquire: `isLockStale` returns false (file gone), `isLockHolderAlive` reads token from... what?

The strace shows the lock file IS present when re-acquiring. This suggests the `releaseLock` rmSync didn't complete before the second `acquireLockWithRetry` began, or there is another mechanism creating the lock file.

**Suggested fix** (production code):
- In `withFileLockSync`, after `releaseLock`, ensure the file is gone before allowing re-entry from the same process.
- Or: use a per-process lock counter to allow nested re-entry.

**Workaround** (test side): run individual tests with `--test-name-pattern` instead of the whole file.

## Related

- `test/unit/orphan-worker-registry.test.ts`
- `src/runtime/orphan-worker-registry.ts:171-183` (filter)
- `src/state/locks.ts:303` (withFileLockSync)
- `src/state/locks.ts:acquireLockWithRetry` (line 167)
- Commit `992231d` (added the test file)
- Commit `5819b18 fix(manual): blob-store metadata race condition` (related work)
- Commit `2b8f27a fix(3): auto-fix from deep review`

## History

- File added in `992231d` (2026-06-09).
- Flagged in prior review `pi-crew/reports/REVIEW_unpushed_27_commits_2026-06-08.md` as 3 design issues (was actually 3-4 then, now 4-5 due to more tests added).
