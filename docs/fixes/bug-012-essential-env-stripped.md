# Bug #12: Child-process crash "Failed to run npm root -g" — essential env vars stripped

**Date:** 2026-05-19
**Severity:** 🔴 HIGH
**Type:** Bug (regression from Bug #10 fix)
**Status:** ✅ Fixed — added essential env vars to allow-list

## Summary

Child Pi workers crash immediately after spawning with:
```
Error: Failed to run npm root -g: undefined
    at DefaultPackageManager.runNpmCommandSync (...)
    at DefaultPackageManager.getGlobalNpmRoot (...)
```

The child Pi starts but can't find `npm` because `PATH` was stripped from its environment.

## Root Cause

**Bug #10's fix introduced Bug #12.** The `sanitizeEnvSecrets()` function in allow-list mode ONLY preserves keys matching the allow-list. All other keys are stripped. The Bug #10 fix used an allow-list that only included model provider API keys, but stripped ALL other env vars including essential ones like `PATH`, `HOME`, `USER`, etc.

```typescript
// Bug #10 fix (BROKEN):
const filteredEnv = sanitizeEnvSecrets(env, {
  allowList: [
    "MINIMAX_*", "OPENAI_*", "*_API_KEY", "*_TOKEN", "*_SECRET",
    // Missing: PATH, HOME, USER, etc.
  ],
});
// Result: child process gets ONLY model API keys, nothing else
// → Child can't find npm/node/PATH → crashes immediately
```

**The `sanitizeEnvSecrets` allow-list mode works like this:**
- With allow-list: preserve ONLY keys matching the list, strip everything else
- Without allow-list: strip only keys matching SECRET_KEY_PATTERN, preserve everything else

So the Bug #10 fix preserved `MINIMAX_API_KEY` but stripped `PATH`, making it impossible for the child Pi to find `npm`.

## Why It Looked Like "spawn pi ENOENT" Before (Bug #11)

In the previous session, background workers failed with `spawn pi ENOENT` immediately because:
1. `getPiSpawnCommand()` returned bare `"pi"` without path resolution (Bug #11)
2. The detached background runner had minimal PATH
3. Fix: added `resolvePiCliScript()` for non-Windows (Bug #11 fix)

After Bug #11 fix + Pi restart, workers spawn OK but crash with `npm root -g` error because:
1. `getPiSpawnCommand()` now resolves full path
2. Child process starts but has no `PATH` → can't find `npm`
3. Pi's package manager calls `npm root -g` → fails with ENOENT

## Fix Applied

**File:** `src/runtime/child-pi.ts` — `buildChildPiSpawnOptions()`

Added essential non-secret env vars to the allow-list:

```typescript
const filteredEnv = sanitizeEnvSecrets(env, {
  allowList: [
    // Model provider API keys (Bug #10)
    "MINIMAX_*", "OPENAI_*", "ANTHROPIC_*", "GOOGLE_*",
    "AZURE_*", "AWS_*", "ZEU_*", "ZERODEV_*",
    "*_API_KEY", "*_TOKEN", "*_SECRET",
    // Essential non-secret vars (Bug #12 fix)
    "PATH", "HOME", "USER", "SHELL", "TERM", "LANG", "LC_*", "XDG_*",
    "NVM_*", "NODE_*", "npm_*", "PI_*", "PI_CREW_*", "PI_TEAMS_*",
  ],
});
```

This preserves both:
1. Model provider API keys (Bug #10 fix)
2. Essential environment variables so child process can function (Bug #12 fix)

## Why Not Use Deny-List Mode?

In deny-list mode (no allow-list), `SECRET_KEY_PATTERN` strips any key matching secret patterns including `MINIMAX_API_KEY` (because `_API_KEY` matches the pattern). This was the original Bug #10 root cause.

The allow-list approach is correct — we just need to include both model API keys AND essential env vars.

## Verification

After this fix, background workers should:
1. Spawn successfully (Bug #11 verified)
2. Find `npm` and `node` via PATH (Bug #12 verified)
3. Authenticate with MiniMax via `MINIMAX_API_KEY` (Bug #10 verified)
4. Produce output within 60 seconds (not 300s timeout)