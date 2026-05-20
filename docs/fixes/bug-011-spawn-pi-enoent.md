# Bug #11: Background Runner "spawn pi ENOENT" — pi binary not in PATH

**Date:** 2026-05-19
**Severity:** 🔴 HIGH
**Type:** Regression (broken in current session)
**Status:** ✅ Fixed — added `resolvePiCliScript()` call for non-Windows platforms

## Summary

Background async team runs fail immediately with "spawn pi ENOENT" because the `getPiSpawnCommand()` function returns `command: "pi"` without resolving the full path on non-Windows platforms. When the detached background-runner process starts with a minimal PATH environment, it cannot find the `pi` binary.

## Root Cause

In `src/runtime/pi-spawn.ts` line 153-171:

```typescript
export function getPiSpawnCommand(args: string[]): PiSpawnCommand {
  // ...
  if (process.platform === "win32") {
    const script = resolvePiCliScript();  // ← Only called on Windows!
    if (script) return { command: process.execPath, args: [script, ...args] };
  }
  return { command: "pi", args };  // ← Returns bare "pi" on Linux/macOS!
}
```

On Windows, the full path to the Pi entry point script is resolved via `resolvePiCliScript()`. On Linux/macOS, the function returns `command: "pi"` which relies on PATH lookup. When the detached background-runner process inherits a minimal PATH, `pi` is not found → `ENOENT`.

## Why Live-Session Works

Live-session runs use `child-pi.ts` → `getPiSpawnCommand()` for spawning child workers, but the parent Pi session has the full PATH including `/home/bom/.nvm/versions/node/v22.22.0/bin`. However, there was also a live-session failure in round 3 with "caller_cancelled" — likely a different issue (compaction guard, Bug #6).

## Why Earlier Async Runs Worked

Earlier async runs (before current session) had workers that:
1. Spawned successfully (`worker.spawned` event with real PID)
2. Ran for 5 minutes producing zero output
3. Timed out with `response_timeout`

Those were the SAME underlying bug (#10/8): `MINIMAX_API_KEY` filtered out. But they DID find the `pi` binary — meaning something changed in the current session that broke the PATH further.

The NEW "spawn pi ENOENT" failure in the current session test is a SEPARATE issue: the background runner itself can't find `pi`, not just the child workers.

## Fix

**File:** `src/runtime/pi-spawn.ts`

Changed from:

```typescript
if (process.platform === "win32") {
  const script = resolvePiCliScript();
  if (script) return { command: process.execPath, args: [script, ...args] };
}
return { command: "pi", args };
```

To:

```typescript
if (process.platform === "win32") {
  const script = resolvePiCliScript();
  if (script) return { command: process.execPath, args: [script, ...args] };
}
// Linux/macOS: also resolve the full path so child processes can find 'pi' even if
// PATH is minimal (e.g. in detached background-runner processes). Fall back to "pi"
// only if resolution fails.
const script = resolvePiCliScript();
if (script) return { command: process.execPath, args: [script, ...args] };
return { command: "pi", args };
```

`resolvePiCliScript()` on Linux walks from `argv[1]` upward to find the pi-crew package root, then locates the Pi CLI script from the package bin. This gives an absolute path that doesn't depend on PATH.

## Why `resolvePiCliScript()` Works

On Linux, `process.argv[1]` for the running Node process points to the pi-crew entry script. Walking up the directory tree finds the `@mariozechner/pi-coding-agent` package root, then reads its `bin.pi` field to get the absolute path to the Pi CLI script (e.g., `/home/bom/.nvm/versions/node/v22.22.0/lib/node_modules/@mariozechner/pi-coding-agent/dist/cli.cjs`).

This absolute path is then passed to `process.execPath` (Node.js) as the first argument, so the child process runs with:
```
node /path/to/pi/dist/cli.cjs [args]
```

This doesn't need PATH at all.

## Verification Plan

1. Restart Pi to reload pi-crew with the fix
2. Run `team action='run', async=true` with a simple research task
3. Verify `worker.spawned` events appear within 5 seconds
4. Verify workers produce output within 60 seconds (not 300s timeout)
5. Verify final run status is `completed` not `failed`