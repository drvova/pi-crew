# Review: 26 unpushed commits of pi-crew (origin/main..HEAD = f15ee98)

**Date**: 2026-06-08
**Reviewer**: direct review (model `MiniMax-M3`, no team-tool delegation)
**Diff range**: `origin/main..HEAD` (26 commits, 79 files, +3567 / -712 LOC)
**HEAD**: `f15ee98` (includes 2 new state-store race fixes not in the 24-commit handoff)

---

## Executive Summary

**Verdict: APPROVE WITH MINOR FIXES** (READY-WITH-FIXES)

The 26 unpushed commits are **high-quality defensive engineering** — extensive race-condition handling, TOCTOU re-checks, PID + start-time verification, explicit env allowlists (no wildcards for secrets), and comprehensive symlink guards. The security posture is significantly improved over origin/main.

The only **release-blocking** issues are:
1. **CHANGELOG.md is out of date** (documents 16 commits as "v0.6.2"; 23 unpushed commits are undocumented)
2. **package.json version is 0.6.2** — needs a decision: keep 0.6.2 with full changelog update, or bump to 0.6.3

Other findings are MEDIUM/LOW and can be addressed in a follow-up release.

---

## Findings by Severity

### 🔴 BLOCKER (must fix before publish)

#### B1. CHANGELOG.md is stale — 23 of 26 commits undocumented

**File**: `CHANGELOG.md` (entire `## [0.6.2]` section, lines 1-46)

The `## [0.6.2]` section documents only the 16 commits from the original 0.6.2 release (`6429fa8` etc.). It does NOT document any of these 23 unpushed commits:

```
0aed8b5 fix(resource-cleanup): unref async-notifier timer
152ac80 restore: re-apply 814831b + c1d895d fixes
ee0ddb4 revert: revert timer.unref fixes
81b9608 restore: re-apply 814831b + c1d895d fixes
5edcb18 fix(cleanup): track temp dirs globally
8ba270d fix(temp-dirs): use pi's config dir
ceb1cb1 fix(cleanup): add Layer 4 periodic cleanup
a76932d fix(cleanup): harden orphan temp-dir cleanup
c9eb430 fix(cleanup): kill orphan background workers
a192509 fix(cleanup): 4 critical hardening fixes
992231d test(cleanup): add 24 unit tests
dbf7a48 fix(ui): replace console.log cleanup messages
e1f7dfe fix(security): restore PI_CREW_PARENT_PID
1bf67eb fix(2): auto-fix from deep review
2b8f27a fix(3): auto-fix from deep review
de3f550 fix(4): auto-fix from deep review
e1ea7d4 fix(4): auto-fix from deep review
5819b18 fix(manual): blob-store metadata race
cd7ef89 fix(manual): remaining 3 unverified issues
b782424 fix(5): auto-fix from deep review
a0c2ba3 fix(manual): remaining verified=false issues
098c8a9 fix(manual): 3 more issues from deep review
ba0ce54 fix(safe-paths): allow creating new files
aa457a5 fix(safe-paths): allow resolveRealContainedPath for non-existent
04fe0be fix(state-store): return undefined instead of throwing
f15ee98 fix(state-store): remove false positive manifest/tasks mtime check
```

**Fix**: Add a new `## [0.6.3]` section (or extend `## [0.6.2]`) with a `### Added / ### Fixed / ### Security` breakdown covering all 23 commits. The cleanup hardening, security fix, and state-store race fix are user-visible and MUST be documented.

#### B2. Version bump decision needed

**File**: `package.json:2` — `"version": "0.6.2"`

If publishing all 26 commits as one release, document them under `## [0.6.2]` (still version 0.6.2) and add a prominent `### Post-release hotfixes` note. If treating the 23 additional commits as a new release, bump to `0.6.3` and document them as `## [0.6.3]`.

The state-store race fix (which previously caused 4812s hangs) is significant enough to warrant a version bump.

---

### 🟠 HIGH (should fix before publish)

#### H1. PI_CREW_PARENT_PID is now in child env allowlist — confirm threat model is documented

**File**: `src/runtime/child-pi.ts` (line in `buildChildPiSpawnOptions` allowlist)

```typescript
// PI_CREW_PARENT_PID is needed by child-pi's parent-guard (uses
// process.kill(pid, 0) liveness check). The PID is not a secret.
"PI_CREW_PARENT_PID",
```

This is correct (PIDs are not secrets), but the threat model isn't documented. Add a comment in `parent-guard.ts` explaining:
- Why passing the parent PID is safe (not a secret)
- The residual risk if a child lies about its parent PID (it can fake `process.env.PI_CREW_PARENT_PID` before starting parent-guard)
- Why this is acceptable (the parent-guard is a self-termination signal, not a security boundary)

**Fix**: Add 3-4 line JSDoc to `parent-guard.ts` documenting the trust model.

#### H2. `parent-guard.ts` removed `.unref()` from the interval — confirm this doesn't reintroduce the original pi hang

**File**: `src/runtime/parent-guard.ts:90-95`

The commit series `b11b960 → 0aed8b5 → 152ac80 → ee0ddb4 → 81b9608` does revert→restore dance around `unref()` on the parent-guard interval. The current state (per `parent-guard.ts`) is:

```typescript
// NOTE: Intentionally NOT calling guardInterval.unref() here.
// The watchdog timer must keep the event loop alive to ensure the worker
// doesn't exit while the parent is alive. If other work (child processes,
// timers, I/O) keeps the loop alive, that's fine — the guard runs as a
// side effect. If no other work exists, the guard is the only thing
// keeping the process alive, and that's by design.
```

The revert+restore "to test if they cause pi hang" was never conclusively resolved. If a worker is spawned with no other pending work, the guard interval keeps it alive indefinitely until the parent dies. This may be the original "pi hang" the user was trying to fix.

**Recommendation**: 
1. Add a metric/log when a worker is kept alive solely by the guard (no other event-loop work)
2. Add a max-worker-lifetime (e.g., 24h) as a safety net
3. Document the current intent in CHANGELOG

#### H3. `safe-paths.ts:resolveRealContainedPath` has asymmetric handling of non-existent ancestors

**File**: `src/utils/safe-paths.ts:25-30` (base dir ancestor) vs `:46-51` (target ancestor)

```typescript
// base dir ancestor:
} catch (e) {
    if (e instanceof Error && e.message.includes("symlink")) throw e;
    // Component doesn't exist — cannot validate ancestor chain safely
    throw new Error(`Cannot validate path safety: ancestor does not exist: ${accumulated}`);
}

// target ancestor:
} catch (e) {
    if (e instanceof Error && e.message.includes("symlink")) throw e;
    // Component doesn't exist — skip validation for this component.
    continue;
}
```

The base dir REQUIRES all ancestors to exist (throws), but the target allows non-existent ancestors (continue). This is intentional (allow creating new files) but should be documented in the function JSDoc. Asymmetric security policies are a common source of bugs when callers modify the code later.

**Fix**: Add JSDoc explaining the asymmetry: "Base dir must exist (we need to confirm it's a real, non-symlinked directory). Target may not exist (for new file creation)."

---

### 🟡 MEDIUM (nice to fix)

#### M1. `parent-guard.ts` has unused `firstTick` variable

**File**: `src/runtime/parent-guard.ts:71-78`

```typescript
let firstTick = true;
guardInterval = setInterval(() => {
    if (!isPidAlive(parentPid)) {
        if (guardInterval) clearInterval(guardInterval);
        selfTerminate(parentPid);
    }
    firstTick = false;  // ← never read
}, POLL_INTERVAL_MS);
```

`firstTick` is set to `false` but never read. Dead code. Either remove or use it (e.g., as documentation that the first check is synchronous-ish).

**Fix**: Remove `firstTick` and the `firstTick = false` line.

#### M2. `state-store.ts` removed error message for mtime mismatch — silent corruption possible

**File**: `src/state/state-store.ts:432-441` (after f15ee98 removed the throw)

The fix `f15ee98` removed the throw entirely. If `loadRunManifestById` returns `undefined` due to a real corruption (not just a benign race), the caller gets a generic "manifest not found" error. There's no signal to distinguish "legitimately missing" from "silently corrupted".

**Fix**: Add a `lastError` log when the loader returns undefined after retries, so debugging is possible.

#### M3. `orphan-worker-registry.ts` CLK_TCK hardcoded to 100

**File**: `src/runtime/orphan-worker-registry.ts` (in `getProcessStartTime`)

```typescript
return Math.floor(startTimeClockTicks * 100);
```

CLK_TCK is typically 100 on Linux but can be 1000 on some systems. The function's docstring says "We use a conservative estimate; the absolute value matters less than the uniqueness per PID lifecycle." — this is correct, but for documentation:
- If `startTime` is a fingerprint (not absolute ms), the field name is misleading
- Consider renaming `startTime` to `startTimeFingerprint` for clarity

#### M4. `event-log.ts:appendEvent` is still sync despite deprecation warning

**File**: `src/state/event-log.ts` (JSDoc says "Prefer appendEventAsync")

The function is marked deprecated but still used by `flushOneEventLogBuffer` and `state/mailbox.ts`. The warning is good, but the migration is incomplete. Either:
1. Migrate the remaining callers
2. Remove the deprecation warning and keep the sync version

---

### 🟢 LOW (informational)

#### L1. Test files use `__test_*` export convention — this is the right pattern

The new test files (`orphan-worker-registry.test.ts`, `cleanup-orphan-temp.test.ts`, `cleanup-full-flow.test.ts`) use `__test_setRegistryPath`, `__test_resetTrackedTempDirs`, `__test_getTrackedTempDirs` for test isolation. This is good practice and matches the existing convention (see `crew-init.ts __test__internals`).

#### L2. `locks.ts` has comprehensive TOCTOU handling

The O_EXCL verify-and-remove pattern, token-based release, staleness + PID liveness checks are all correct. The async version mirrors the sync version's behavior. Excellent work.

#### L3. `blob-store.ts:writeBlob` writes blob first, then metadata

Order changed from "metadata first, then blob" to "blob first, then metadata". The new order eliminates orphan metadata on blob write failure. Combined with the per-hash lock, this is correct.

#### L4. `atomic-write.ts:isSymlinkSafePath` walks the full ancestor chain

This prevents attacks where an intermediate ancestor is a symlink. Combined with `O_NOFOLLOW` on file open, this is a strong defense.

---

## Things That Look GOOD (call out for repetition)

1. **Explicit allowlist for child env (no wildcards)** — `child-pi.ts` allowlist explicitly names each API key, with security comments explaining the trade-off. This is much better than the previous wildcard approach.

2. **Honest about residual races** — `orphan-worker-registry.ts` has a 10-line comment explaining the "KNOWN RESIDUAL RACE" between pre-kill start time check and the actual SIGKILL syscall. This is the kind of documentation that helps future maintainers.

3. **Multi-layer defense in cleanup** — `cleanupOrphanTempDirs` + `cleanupLegacyOrphanTempDirs` + `cleanupAllTrackedTempDirs` + the `createdTempDirs` Set tracking. Multiple layers, each with bounded work to avoid main-thread stalls.

4. **Re-check before destructive operations** — `pi-args.ts:cleanupOrphanTempDirs` does TWO `lstatSync` checks immediately before `rmSync` to close the TOCTOU window. Excellent.

5. **Mock mode security model** — `PI_TEAMS_MOCK_CHILD_PI` is in the allowlist (passed to children) but `PI_CREW_ALLOW_MOCK` is NOT (only checked in parent scope). The 5-line comment explains the asymmetric trust model. This is the right design.

6. **Test isolation** — All new tests use bounded baseDir / temp paths, `__test_setRegistryPath` for override, and `mkdtemp` for filesystem isolation. No test touches real user state.

---

## Revert/Restore Audit (commits 0aed8b5, 152ac80, ee0ddb4, 81b9608)

The series does revert→restore twice around `timer.unref()` and `parent-guard.ts`. End state:

| File | End state | Notes |
|---|---|---|
| `parent-guard.ts` | NO `unref()` on guard interval | Comment: "by design" — keeps worker alive until parent dies |
| `async-notifier.ts` | `unref()` on async-notifier interval | `0aed8b5` change, not reverted |
| `loaders.ts` CountdownTimer | `unref()` on countdown timer | `0aed8b5` change, not reverted |
| `intercom-bridge.ts` | `unref()` on bridge timer | `0aed8b5` change, not reverted |
| `manifest-cache.ts` | `unref()` on cache timer | `0aed8b5` change, not reverted |
| `test-runner.mjs` | `force-exit` after tests | `814831b` change, not reverted |

**Verdict**: The end state is consistent and intentional. The `parent-guard` is the one anomaly (intentionally not unref'd). This is documented in the code but should be in CHANGELOG too (see H2).

The "revert to test if they cause pi hang" → "restore" sequence suggests the hang was never root-caused. Recommend adding a follow-up issue to:
1. Add a metric for "worker kept alive only by parent-guard"
2. Add a max-worker-lifetime safety net
3. Document the user-facing behavior change

---

## Pre-Push Checklist (before publishing v0.6.2 / v0.6.3)

```bash
# 1. Version decision
[ ] Choose: keep 0.6.2 (with full changelog) OR bump to 0.6.3

# 2. Update CHANGELOG.md
[ ] Add a "Post-release hardening" section (if 0.6.2) or full v0.6.3 section
[ ] Document: cleanup hardening, PI_CREW_PARENT_PID restore, safe-paths, blob-store race, state-store race
[ ] Document the parent-guard unref removal as a behavior change

# 3. Code quality
[ ] Fix M1 (unused firstTick)
[ ] Fix M4 (complete event-log migration or remove warning)

# 4. Run full test suite
cd /home/bom/source/my_pi/pi-crew
npm run test:unit
npm run test:integration
npm run check:lazy-imports

# 5. Smoke test the new code paths
# - spawn a worker, verify it starts
# - kill parent (SIGKILL), verify worker self-terminates within 1s
# - run cleanup, verify orphan temp dirs removed
# - test safe-paths with non-existent target file
# - test env-filter allows PI_CREW_PARENT_PID

# 6. Publish
[ ] npm version patch  (or 0.6.2 if keeping)
[ ] git push --follow-tags
[ ] npm publish
```

---

## Top 5 Must-Fix Before Push

1. **B1**: Update CHANGELOG.md with all 23 new commits
2. **B2**: Decide version (0.6.2 with extended changelog OR 0.6.3)
3. **H1**: Document PI_CREW_PARENT_PID threat model in `parent-guard.ts`
4. **H2**: Document parent-guard unref removal in CHANGELOG
5. **H3**: Document the safe-paths asymmetry in JSDoc

---

## Summary Statistics

| Metric | Value |
|---|---|
| Total commits | 26 |
| Files changed | 79 |
| Lines added | 3567 |
| Lines removed | 712 |
| New source files | 2 (orphan-worker-registry.ts, pi-args.ts heavily expanded) |
| New test files | 3 (orphan-worker-registry, cleanup-orphan-temp, cleanup-full-flow) |
| Security findings | 0 critical, 0 high, 2 medium |
| Correctness findings | 0 critical, 1 high, 1 medium |
| Test quality | Good — proper isolation, specific failure mode tests |
| Release readiness | After CHANGELOG update + version decision |
