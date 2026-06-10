# Issue 11: resolveCrewMaxDepth env parsing

**Status**: pre-existing
**Severity**: Low (config validation)
**Component**: `src/config/` (resolveCrewMaxDepth function)
**Test count**: 2 failing

## Summary

`resolveCrewMaxDepth` reads an env var (likely `PI_CREW_MAX_DEPTH` or similar) and parses it as a number 1-10. The tests verify the basic parse + the bound enforcement.

## Failing tests

| Test | File | Line |
|---|---|---|
| `resolveCrewMaxDepth` | (unknown source) | :1601 |
| `resolveCrewMaxDepth: ignores env values outside 1-10` | (unknown source) | :1622 |

## Possible root cause

- The function may have been refactored to use the new `env-filter.ts` logic, which rejects `PI_*` globs (issue #01).
- The bound check may have been tightened or loosened.
- The function may have been moved to a new file and tests not updated.

## Suggested fix

1. Find the function:
   ```bash
   cd /home/bom/source/my_pi/pi-crew
   grep -rn 'resolveCrewMaxDepth' src/ test/ | head
   ```
2. Run the test that owns it:
   ```bash
   grep -rln 'resolveCrewMaxDepth' test/
   ```
3. Check the actual implementation against the test expectations.

## Related

- `src/config/` (env parsing)
- `src/utils/env-filter.ts` (related to issue #01)

## Priority

**Low** — affects config validation, defaults are likely still applied.
