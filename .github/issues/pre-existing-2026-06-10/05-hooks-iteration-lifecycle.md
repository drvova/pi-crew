# Issue 05: hooks / lifecycle / iteration tests

**Status**: pre-existing
**Severity**: High (largest group: 11 failures across 4 files)
**Component**: `src/runtime/hooks.ts` + `src/runtime/lifecycle-hooks.ts` + `src/runtime/iteration-hooks.ts` + `src/runtime/intercom-bridge.ts`
**Test count**: 11 failing

## Summary

The hooks subsystem has the largest concentration of pre-existing test failures. Tests cover:
- Blocking vs. non-blocking hook execution
- Hook chain ordering
- Hook error handling (block vs. record diagnostic)
- Modify hook context updates
- Intercom-bridge singleton management
- Iteration, lifecycle, recovery hook entry points

The fact that 11/11 fail suggests a systemic issue (perhaps a shared dependency or test infrastructure change broke all of them), not 11 independent bugs.

## Failing tests

| Test | File | Line |
|---|---|---|
| `executeHook` | `test/unit/hooks.test.ts` | :569 |
| `blocking hook can block execution` | `test/unit/hooks-registry.test.ts` | :1632 |
| `non-blocking hook error records diagnostic and does not crash` | `test/unit/hooks.test.ts` | :931 |
| `blocking hook error blocks the run` | `test/unit/hooks.test.ts` | :1352 |
| `modify hook updates context` | `test/unit/hooks.test.ts` | :1733 |
| `blocking hook in chain stops subsequent hooks` | `test/unit/hooks.test.ts` | :2705 |
| `intercom-bridge: IntercomQueue` | `test/unit/intercom-bridge.test.ts` | :2807 |
| `intercom-bridge: getIntercomQueue singleton` | `test/unit/intercom-bridge.test.ts` | :3295 |
| `intercom-bridge: cleanupIntercomQueue` | `test/unit/intercom-bridge.test.ts` | :3883 |
| `runIterationHook` | `test/unit/iteration-hooks.test.ts` | :3504 |
| `before_cancel hook` | `test/unit/lifecycle-hooks.test.ts` | :2164 |
| `before_forget hook` | `test/unit/lifecycle-hooks.test.ts` | :3503 |
| `before_cleanup hook` | `test/unit/lifecycle-hooks.test.ts` | :4659 |
| `runPostCheck` | `test/unit/post-checks.test.ts` | :2142 |
| `run_recovery hook` | `test/unit/recovery-hooks.test.ts` | :2014 |

## Suggested investigation

1. **Run all 4 files in one go** to see if they share an error pattern:
   ```bash
   cd /home/bom/source/my_pi/pi-crew
   node --test --test-timeout=15000 \
     test/unit/hooks.test.ts \
     test/unit/hooks-registry.test.ts \
     test/unit/iteration-hooks.test.ts \
     test/unit/lifecycle-hooks.test.ts \
     test/unit/post-checks.test.ts \
     test/unit/recovery-hooks.test.ts \
     test/unit/intercom-bridge.test.ts
   ```

2. **Check shared imports**: all of these likely import from `src/runtime/hooks.ts`. If that file has a load-time error (similar to the enum bug in `errors.ts`), all dependent tests would fail.

3. **Look for a common "import" or "module load" error** in the test output:
   ```bash
   grep -E 'SyntaxError|TypeError|ReferenceError|Cannot find' /tmp/test-full.log | head
   ```

## Related

- `src/runtime/hooks.ts`
- `src/runtime/hooks-registry.ts`
- `src/runtime/lifecycle-hooks.ts`
- `src/runtime/iteration-hooks.ts`
- `src/runtime/intercom-bridge.ts`
- `src/runtime/post-checks.ts`
- `src/runtime/recovery-hooks.ts`

## Likely root cause hypothesis

A change to `src/runtime/hooks.ts` (or its dependencies like `src/state/locks.ts` or `src/utils/env-filter.ts`) broke a contract that the tests rely on. The cascade pattern is similar to the `errors.ts` enum crash that hid behind import chains.

## Priority

**HIGH** — 11 failures is the largest single group. A single root-cause fix could resolve all of them.
