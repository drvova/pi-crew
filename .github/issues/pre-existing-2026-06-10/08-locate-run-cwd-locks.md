# Issue 08: locate-run-cwd + locks recovery

**Status**: pre-existing
**Severity**: Medium
**Component**: `src/utils/locate-run-cwd.ts` + `src/state/locks.ts`
**Test count**: 3 failing

## Summary

Tests verify that `locateRunCwd` (or similar) can find runs in child directories, returns undefined for sibling directories, and that `withRunLockSync` recovers from a stale lock.

## Failing tests

| Test | File | Line |
|---|---|---|
| `finds run in child directory CWD` | `test/unit/locate-run-cwd.test.ts` | :899 |
| `returns undefined when run is in sibling directory` | `test/unit/locate-run-cwd.test.ts` | :1210 |
| `withRunLockSync and withRunLock both recover from a stale lock` | `test/unit/locate-run-cwd.test.ts` | :1802 |

## Possible root cause

- `src/utils/locate-run-cwd.ts` walks up the directory tree looking for `.crew/state/...` manifests. If the implementation changed (e.g., to use `findRepoRoot` which resolves symlinks, see issue #02), tests that rely on lexical paths would fail.
- `withRunLockSync` stale-lock recovery may have been tightened (e.g., now requires both staleness AND holder death) and tests are using stale-but-alive scenarios.

## Suggested fix

1. Run in isolation:
   ```bash
   cd /home/bom/source/my_pi/pi-crew
   node --test --test-timeout=15000 test/unit/locate-run-cwd.test.ts
   ```
2. Check the actual error messages — likely `expected X, got Y` assertions.
3. If related to issue #02, fix both together.

## Related

- `src/utils/locate-run-cwd.ts`
- `src/state/locks.ts:withRunLockSync` (line 356)
- `src/state/locks.ts:acquireLockWithRetry` (line 167)
- `src/utils/paths.ts:findRepoRoot` (related to issue #02)

## Priority

**Medium** — affects CWD-based run lookup, not security.
