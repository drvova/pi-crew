# Issue 07: sandbox constructor escape protection

**Status**: pre-existing
**Severity**: High (security test)
**Component**: `src/runtime/sandbox.ts` + `src/runtime/child-pi.ts`
**Test count**: 2 failing

## Summary

The `Sandbox` class is supposed to prevent constructor chain escape attacks (CWE-1321: Prototype Pollution, CWE-749: Exposed Dangerous Method). The two failing tests verify:
1. The constructor chain itself doesn't allow escape
2. The sandbox env allowlist correctly forwards whitelisted vars

## Failing tests

| Test | File | Line |
|---|---|---|
| `C1: Sandbox constructor chain escape protection` | `test/unit/sandbox-constructor-escape.test.ts` | :1975 |
| `C1: sandbox env allows whitelisted vars through` | `test/unit/sandbox-constructor-escape.test.ts` | :160 |

Also relevant:
- `test/unit/sandbox-security.test.ts:5:115` — `sandbox allows whitelisted vars through` (likely also failing)

## Possible root cause

- The `env-filter.ts` glob rejection (issue #01) may be blocking the test's allowlist patterns.
- The sandbox constructor chain test may be using a technique (e.g., `Object.create`, `__proto__`) that the new sandbox no longer protects against.
- The sandbox may have been refactored and the test fixtures are stale.

## Suggested fix

1. Run the tests in isolation:
   ```bash
   cd /home/bom/source/my_pi/pi-crew
   node --test --test-timeout=15000 \
     test/unit/sandbox-constructor-escape.test.ts \
     test/unit/sandbox-security.test.ts
   ```
2. Check if the test fixtures use `PI_*` globs (would fail per issue #01).
3. Verify the sandbox implementation in `src/runtime/sandbox.ts` against the test expectations.

## Related

- `src/runtime/sandbox.ts`
- `src/runtime/child-pi.ts` (env passing)
- `test/unit/sandbox-constructor-escape.test.ts`
- `test/unit/sandbox-security.test.ts`
- `test/unit/security-hardening.test.ts` (related)

## Priority

**HIGH** — sandbox security is critical.
