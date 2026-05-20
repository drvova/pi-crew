# Bug #10: Child-Process Silent Timeout — MINIMAX_API_KEY Filtered Out

**Date:** 2026-05-19
**Severity:** HIGH
**Type:** Bug (not design issue)
**Status:** OPEN — Fix applied, pending verification

## Summary

Background child-process workers silently time out after 300 seconds with zero output
because `MINIMAX_API_KEY` is filtered out by `sanitizeEnvSecrets()` before the child
process is spawned. The child Pi has no API credentials to call the model.

## Root Cause

In `src/runtime/child-pi.ts` line 159-161:

```typescript
function buildChildPiSpawnOptions(cwd: string, env: NodeJS.ProcessEnv): SpawnOptions {
  const filteredEnv = sanitizeEnvSecrets(env);  // ← STRIPS ALL *API_KEY* VARS
  return {
    cwd,
    env: { ...filteredEnv, PI_CREW_PARENT_PID: String(process.pid) },
    ...
  };
}
```

The `sanitizeEnvSecrets()` function (in `src/utils/env-filter.ts`) uses a deny-list
pattern to filter out keys matching secret patterns:

```typescript
SECRET_KEY_PATTERN = /(?:^|[_.-])(token|api[-_]?key|password|passwd|secret|credential|authorization|private[-_]?key)(?:$|[_.-])/i;
```

`MINIMAX_API_KEY` matches this pattern because `_API_KEY` contains `api_key` as a
substring, which matches the `api[-_]?key` part of the regex.

### Why foreground (live-session) works fine

The live-session runtime in `live-session-runtime.ts` uses the SAME parent Pi session
that already has the API key loaded. There's no separate child process — the live
session inherits the parent's environment directly. No `sanitizeEnvSecrets()` call.

### Why background (child-process) fails

1. `team action='run'` with async=true → `background-runner.ts` → `child-pi.ts`
2. Child Pi is spawned via `spawn()` with `buildChildPiSpawnOptions()`
3. `buildChildPiSpawnOptions` calls `sanitizeEnvSecrets()` which strips `MINIMAX_API_KEY`
4. Child Pi starts with no API key → cannot authenticate with MiniMax → hangs silently
5. After 300s of no output, `response_timeout` fires and kills the process

## Evidence

All 7+ failed background workers show the same pattern:
- `worker.spawned` — PID confirmed, process is alive
- `task.attention` — 223+ seconds of idle (no stdout, no stderr, no jsonEvents)
- `worker.response_timeout` — "No output for 300000ms"
- `worker.exit` — `exitCode=null` (SIGTERM kill)

No error output because the child Pi can't even report an auth failure — it simply
silently waits for a model response that never comes.

## Fix

**File:** `src/runtime/child-pi.ts`

In `buildChildPiSpawnOptions()`, change the `sanitizeEnvSecrets()` call to preserve
model provider API keys:

```typescript
function buildChildPiSpawnOptions(cwd: string, env: NodeJS.ProcessEnv): SpawnOptions {
  // Preserve model provider API keys (MINIMAX_API_KEY, OPENAI_API_KEY, etc.)
  // These are needed by the child Pi to call the configured model provider.
  const filteredEnv = sanitizeEnvSecrets(env, {
    allowList: ["MINIMAX_*", "OPENAI_*", "ANTHROPIC_*", "GOOGLE_*", "AZURE_*", "AWS_*", "ZEU_*", "ZERODEV_*", "*_API_KEY", "*_TOKEN", "*_SECRET"],
  });
  return {
    cwd,
    env: { ...filteredEnv, PI_CREW_PARENT_PID: String(process.pid) },
    stdio: ["pipe", "pipe", "pipe"],
    detached: process.platform !== "win32",
    windowsHide: true,
  };
}
```

This uses the allow-list mode of `sanitizeEnvSecrets()` which only preserves keys
matching the globs. All other secret-like keys (passwords, credentials, etc.) are still
stripped. Only model API keys needed for the child process to call the LLM are
preserved.

## Why this is safe

- Model API keys are not sensitive in the same way as passwords — they're designed
  to be passed to API endpoints
- The allow-list is specific to known provider prefixes — it doesn't blanket-allow
  all env vars
- Other secrets (DB passwords, internal credentials) are still filtered out
- The `PI_CREW_PARENT_PID` is added after filtering so it won't conflict

## Verification Plan

1. Apply the fix to `src/runtime/child-pi.ts`
2. Restart Pi to reload the extension
3. Run a background team (e.g., `team action='run', team='research', async=true`)
4. Verify the child process produces output within the first 30 seconds
5. Compare env of child process (add temporary debug logging) to confirm
   `MINIMAX_API_KEY` is present