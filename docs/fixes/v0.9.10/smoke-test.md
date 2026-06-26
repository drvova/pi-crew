# Smoke Test — v0.9.10 File-Level Test Hang Fixes

3 commits resolved BG2 (`verify-full2`) file-level test hangs/timeouts. All verified under a 60s timeout bound (per the 3863s lesson); `tsc --noEmit` clean.

- **cadb5b7** — `Fix CountdownTimer drift and redactSecretString ReDoS regression`
  Correctness/perf fixes surfaced by the P1f ReDoS regression test (300KB no-dot input) and BG2 sweep; not attributed to a specific hanging test. `CountdownTimer` switched from `setInterval` to recursive `setTimeout` so a busy event loop no longer skips a second value (`src/ui/loaders.ts:109` class; `scheduleNextTick` at `:143`; `.unref()` defense-in-depth at `:157`; test `test/unit/loaders.test.ts`). `redactSecretString` (`src/utils/redaction.ts:177`) inner loop now advances past non-secret alphanumeric runs (O(n²)→O(n); FIX comment `:207-220`) and `isKeyChar` uses `charCodeAt` (`:223-232`) in place of `/[a-zA-Z0-9_-]/.test` — ~5× faster, no regex allocation.

- **5876c38** — `Fix HandoffManager setInterval leak: prevent test file-level hangs`
  Resolves `chain-runner.test.ts` file-level hang. `HandoffManager.startCleanupTimer` (`src/runtime/handoff-manager.ts:202-213`) now calls `.unref()` on the cleanup `setInterval` at `:212-213`. Without `.unref()`, every `new HandoffManager()` in a mock helper leaked a handle that kept Node alive past test completion.

- **7085d8d** — `Add re-entrance guard to withFileLockSync (Round 29 follow-up)`
  Resolves `orphan-worker-registry.test.ts` + `cleanup-full-flow.test.ts` hangs. Added `fileLockHeldByUs: Map<string,string>` re-entrance guard to `withFileLockSync` (`src/state/locks.ts:295` FIX comment; `:302` existingToken short-circuit; `:336` Map.set; `:341` finally delete; `:371` Map declaration) mirroring the existing `runLockHeldByUs` pattern. Without the guard, nested same-path acquisition read its own freshly-written lock file and retried for the full `staleMs` window. Regression test: `test/unit/round29-file-lock-reentrance.test.ts` (5/5 pass, 547ms; orphan-worker-registry 15/15 496ms was hanging at 30s; cleanup-full-flow 4/4 1377ms was hanging at 30s).
