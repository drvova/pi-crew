# Issue 06: security-hardening trust boundary tests

**Status**: pre-existing
**Severity**: High (security tests should pass)
**Component**: config trust boundary (`src/config/`, `src/utils/`)
**Test count**: 3 failing

## Summary

Tests verify that project-level config cannot override sensitive user trust-boundary settings (e.g., `otlp.endpoint`, `NPM_TOKEN`, `NODE_ENV`). These are critical security guarantees that should not regress silently.

## Failing tests

| Test | File | Line |
|---|---|---|
| `project config cannot override sensitive user trust-boundary settings` | `test/unit/security-hardening.test.ts` | :1597 |
| `project config cannot override otlp.endpoint` | `test/unit/security-hardening.test.ts` | :4690 |
| `child Pi does not leak NPM_TOKEN or NODE_ENV through wildcards` | `test/unit/security-hardening.test.ts` | :8713 |

## Possible root cause

One of:
- The `env-filter.ts` glob rejection of `PI_*` (issue #01) means the tests that try to override via glob patterns get blocked at the env-filter level, not at the config-merging level.
- The config-merging logic in `src/config/` may not be applying the "user trumps project" precedence rule correctly for the new fields (`otlp.endpoint`, `NPM_TOKEN`, `NODE_ENV`).
- The `child-pi.ts` env-var allowlist may not include the wildcards, causing `NPM_TOKEN` to be stripped (which the test detects as "doesn't leak through wildcards" — but the assertion may be inverted).

## Suggested fix

1. Verify the env-filter behavior (issue #01 cascades here).
2. Check the config merging precedence in `src/config/merge.ts` or similar.
3. Run the tests in isolation:
   ```bash
   cd /home/bom/source/my_pi/pi-crew
   node --test --test-timeout=15000 test/unit/security-hardening.test.ts
   ```
4. Identify which specific field/setting the tests are failing on, then trace the code path.

## Related

- `test/unit/security-hardening.test.ts`
- `src/config/` (project config loading)
- `src/utils/env-filter.ts` (env var allowlist)
- `src/runtime/child-pi.ts` (child process spawning)

## Priority

**HIGH** — security tests failing is a release blocker from a security governance perspective, even if not from a code-correctness perspective.
