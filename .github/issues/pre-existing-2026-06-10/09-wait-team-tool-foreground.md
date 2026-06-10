# Issue 09: wait / team-tool-inspect / foreground

**Status**: pre-existing
**Severity**: Medium
**Component**: `src/runtime/wait-action.ts` + `src/runtime/team-tool-inspect.ts` + `src/runtime/foreground-nonblocking.ts`
**Test count**: 9 failing

## Summary

Tests for run-locator functionality (`wait` action), team-tool inspection UI, and foreground non-blocking run execution. 9 failures across 3 files suggest either shared dependency breakage or coincidental individual issues.

## Failing tests

| Test | File | Line |
|---|---|---|
| `foreground run with scheduler waits for completion and returns results` | `test/unit/foreground-nonblocking.test.ts` | :1 |
| `wait finds run in child directory when ctx.cwd is parent` | `test/unit/wait-action.test.ts` | :2189 |
| `wait returns completed for child-process mock run` | `test/unit/wait-action.test.ts` | :5197 |
| `e2e wait from parent directory for live-session run in child` | `test/integration/*` (likely) | |
| `handleEvents` | `test/unit/team-tool-inspect.test.ts` | :1030 |
| `handleArtifacts` | `test/unit/team-tool-inspect.test.ts` | :1679 |
| `handleSummary` | `test/unit/team-tool-inspect.test.ts` | :2331 |
| (additional) | `test/unit/team-tool-inspect.test.ts` | :1848 |
| (additional) | `test/unit/team-tool-inspect.test.ts` | :2331 |
| `resume emits mailbox replay event before rerunning queued work` | `test/unit/mailbox-replay.test.ts` | :1927 |
| `cancel marks run cancelled and resume can complete it` | `test/unit/resume-cancel.test.ts` | :1 |

## Possible root cause

- `src/runtime/wait-action.ts` may have lost the `findRepoRoot` symlink-resolution behavior (related to issue #02).
- `src/runtime/team-tool-inspect.ts` (handleEvents/handleArtifacts/handleSummary) failures may cascade from a shared handler dependency.
- `src/runtime/foreground-nonblocking.ts` may have scheduler integration issues.

## Suggested fix

1. Run each file in isolation to capture the actual error messages:
   ```bash
   cd /home/bom/source/my_pi/pi-crew
   for f in wait-action team-tool-inspect foreground-nonblocking mailbox-replay resume-cancel; do
     echo "=== $f ==="
     node --test --test-timeout=15000 test/unit/${f}.test.ts 2>&1 | grep -E '^not ok|error:' | head -5
   done
   ```
2. Check shared dependencies in `src/state/locks.ts` (issue #04 hang), `src/utils/paths.ts` (issue #02), `src/runtime/hooks.ts` (issue #05).

## Related

- `src/runtime/wait-action.ts`
- `src/runtime/team-tool-inspect.ts`
- `src/runtime/foreground-nonblocking.ts`
- `src/runtime/mailbox-replay.ts`
- `src/runtime/resume-cancel.ts`

## Priority

**Medium** — affects user-visible "wait" and "inspect" features, but not security.
