# Issue 14: event-log-buffered flush

**Status**: pre-existing
**Severity**: Low
**Component**: `src/state/event-log.ts` (buffered variant)
**Test count**: 1 failing

## Summary

Single test verifying that `flushEventLogBuffer` flushes pending events synchronously.

## Failing test

| Test | File | Line |
|---|---|---|
| `flushEventLogBuffer flushes pending events synchronously (2.2)` | `test/unit/event-log-buffered.test.ts` | :1097 |

## Possible root cause

- The `event-log.ts` buffered variant may have a regression where synchronous flush returns before events are actually on disk.
- May be related to `safe-paths.ts` or `atomic-write.ts` changes (the new `AtomicWriter v2` is not used in `event-log.ts`).

## Suggested fix

1. Run in isolation:
   ```bash
   cd /home/bom/source/my_pi/pi-crew
   node --test --test-timeout=10000 test/unit/event-log-buffered.test.ts
   ```
2. Check `event-log.ts` flush implementation against test expectations.

## Related

- `src/state/event-log.ts`
- `src/state/atomic-write.ts` (the v1 file)
- `src/state/atomic-write-v2.ts` (the v2 file added in 56 commits, NOT used here)

## Priority

**Low** — single test, likely a flush race or assertion mismatch.
