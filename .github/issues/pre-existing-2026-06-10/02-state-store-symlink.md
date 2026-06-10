# Issue 02: state-store fails on symlinked workspaces

**Status**: pre-existing (verified at origin/main `b11b960` with `git show origin/main:test/unit/state-store.test.ts`)
**Severity**: Medium
**Component**: `src/state/state-store.ts` + `src/utils/paths.ts`
**Test count**: 5 failing

## Summary

Tests that create a symlinked cwd and expect to read manifests back via the symlink path fail because `projectCrewRoot(cwd)` calls `findRepoRoot(cwd)` which calls `fs.realpathSync(cwd)` (symlink-resolving). The manifest is stored under the realpath but the test reads via the symlink path.

## Failing tests

| Test | File | Line |
|---|---|---|
| `loadRunManifestById rejects symlinked artifact roots outside artifact parent` | `test/unit/state-store.test.ts` | :3 |
| `loadRunManifestById revalidates cached artifact root containment` | `test/unit/state-store.test.ts` | :2 |
| `loadRunManifestById preserves lexical paths for symlinked workspaces` | `test/unit/state-store.test.ts` | :6 |
| `createRunPaths` | `test/unit/state-store-cov.test.ts` | :1214 |
| `saveRunManifest + loadRunManifestById` | `test/unit/state-store-cov.test.ts` | :3880 |

## Root cause

`src/utils/paths.ts:99-101`:

```ts
export function findRepoRoot(cwd: string): string | undefined {
  // Resolve symlinks before walking to prevent malicious symlinks from bypassing
  // home/temp boundary checks.
  const startKey = fs.realpathSync(cwd);
  ...
}
```

This is intentional for security (preventing symlink-based bypass of containment checks), but it means a symlink-wrapped cwd produces a different `stateRoot` than the test expects.

## Suggested fix

Two options:

**Option A** (preserve current behavior, fix tests):
- Update tests to use the realpath'd cwd when reading back the manifest.
- Add test helper `getRealpathOrCwd(cwd)` that returns realpath if path exists, else original.

**Option B** (preserve lexical paths, weaken security):
- Add an opt-in flag `findRepoRoot(cwd, { resolveSymlinks: false })`.
- The flag would be set by `loadRunManifestById` to allow lexical lookup.
- Risk: weakens containment guarantees if not used carefully.

**Recommended**: Option A — the security posture is correct, tests should adapt.

## Related

- `src/utils/paths.ts:99` (realpathSync call)
- `src/utils/safe-paths.ts:resolveRealContainedPath` (the canonical path resolver)
- `test/unit/state-store.test.ts`
- `test/unit/state-store-cov.test.ts`

## History

Flagged in prior review `pi-crew/reports/REVIEW_unpushed_27_commits_2026-06-08.md` as a pre-existing issue.
