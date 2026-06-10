# Issue 12: worktree seed-paths normalization

**Status**: pre-existing (also has NEW regressions in worktree-manager-cov, see issue [04](./04-orphan-worker-registry-tests.md))
**Severity**: Low
**Component**: `src/worktree/worktree-manager.ts` + `src/utils/safe-paths.ts`
**Test count**: 2 failing (pre-existing portion)

## Summary

Tests verify that worktree seed paths are normalized to safe forms. The `normalizeSeedPaths` function in `worktree-manager.ts` may have changed behavior.

## Failing tests (pre-existing portion)

| Test | File | Line |
|---|---|---|
| `normalizeSeedPaths` | `test/unit/worktree-manager-cov.test.ts` | :1781 |
| `prepareTaskWorkspace reuses existing valid worktree` | (unknown source) | :2660 |

> Note: there are also 4 NEW regressions in `worktree-manager-cov.test.ts` (related to the git init fallback added in the 56 commits). See issue 04 for those.

## Possible root cause

- `normalizeSeedPaths` may have started rejecting paths it previously accepted.
- The worktree reuse logic may have changed.
- The `safe-paths.ts` asymmetric ancestor handling (recently added) may be rejecting inputs it previously passed.

## Suggested fix

1. Run in isolation:
   ```bash
   cd /home/bom/source/my_pi/pi-crew
   node --test --test-timeout=15000 test/unit/worktree-manager-cov.test.ts
   ```
2. Compare `worktree-manager.ts` history:
   ```bash
   git log --oneline -- src/worktree/worktree-manager.ts | head
   ```

## Related

- `src/worktree/worktree-manager.ts`
- `src/utils/safe-paths.ts:resolveRealContainedPath`
- `test/unit/worktree-manager-cov.test.ts`

## Priority

**Low** — worktree edge cases; common paths likely still work.
