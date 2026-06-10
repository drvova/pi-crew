# Issue 01: env-filter rejects `PI_*` glob allowlist

**Status**: pre-existing (not a regression from 56 unpushed commits)
**Severity**: Medium
**Component**: `src/utils/env-filter.ts` + tests
**Test count**: 5 failing

## Summary

`isDangerousGlob("PI_*")` returns `true` because the prefix `PI_` + secret suffix `api` produces `PI_api` which `isSecretKey` matches. The function then throws `Allowlist pattern "PI_*" could match secret env vars`. This is the **correct security posture**, but the test suite expects `PI_*` to work.

## Failing tests

| Test | File | Line |
|---|---|---|
| `allow-list only passes through matched keys` | `test/unit/env-filter.test.ts` | :20 |
| `allow-list glob PI_* does not match PIPELINE` | `test/unit/env-filter.test.ts` | :36 |
| `sanitizeEnvSecrets (allow-list mode)` | `test/unit/env-filter-cov.test.ts` | (cov test) |
| `allow-list only passes through matched keys` | `test/unit/env-filter-cov.test.ts` | (cov test) |
| `sanitizeEnvSecrets supports glob patterns in allowList` | `test/unit/env-filter-cov.test.ts` | (cov test) |

## Root cause

`src/utils/env-filter.ts:24-32`:

```ts
function isDangerousGlob(pattern: string): boolean {
  if (!pattern.endsWith("*")) return false;
  const prefix = pattern.slice(0, -1);
  if (prefix === "") return true;
  for (const suffix of SECRET_SUFFIXES) {  // ["token", "api", "key", "password", ...]
    if (isSecretKey(prefix + suffix)) {
      return true;  // PI_api matches, so PI_* rejected
    }
  }
  return false;
}
```

`SECRET_SUFFIXES = ["token", "api", "key", "password", "passwd", "secret", "credential", "authorization", "private"]`. With prefix `PI_`, suffix `api` → `isSecretKey("PI_api")` → true (linear scan finds `_api` keyword).

## Suggested fix

Update tests to use a more specific allowlist. The pattern `PI_*` is intentionally dangerous because it could match a future `PI_PASSWORD` or `PI_API_KEY`. Tests should use `PI_CREW_*` (the actual convention used in the codebase, e.g. `PI_CREW_PARENT_PID`).

```ts
// In test/unit/env-filter.test.ts:20
// before:
{ allowList: ["PATH", "HOME", "PI_*"] }
// after:
{ allowList: ["PATH", "HOME", "PI_CREW_*"] }
```

## Related

- `test/unit/env-filter.test.ts`
- `test/unit/env-filter-cov.test.ts`
- `src/utils/env-filter.ts:24-32` (the implementation is correct)
- `src/utils/redaction.ts:isSecretKey` (the keyword matcher)

## History

Flagged in prior review `pi-crew/reports/REVIEW_unpushed_27_commits_2026-06-08.md` as M1.
