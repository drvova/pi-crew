# Bug #7: Async notifier "stale ctx detected; stopping notifier" — does not restart

| Field | Value |
|---|---|
| **Severity** | 🔴 HIGH |
| **Status** | Root cause confirmed, fix pending |
| **Affected** | All pi-crew users after a Pi session restarts/compacts |
| **Symptom** | After restart/compact, the notifier stops completely — run-completion notifications are no longer received |

## Description

After Pi restarts (or /clear, /compact, session switch), the following error appears:
```
[pi-crew] async notifier stale ctx detected; stopping notifier.
```

After that, pi-crew **no longer delivers notifications** for run completions. Background runs finish, but the user is never notified.

## Root cause

### Normal flow (expected):

```
Pi session_start event
  → sessionGeneration++
  → currentCtx = newCtx
  → cleanupRuntime() (stop old notifier)
  → startAsyncRunNotifier(newCtx, ...)
  → New notifier runs with newCtx ✅
```

### Buggy flow:

```
1. Old notifier interval tick fires
2. isCurrent(generation) check → true (generation hasn't incremented yet)
3. ctx.ui.notify() called
4. Pi has already invalidated the old ctx → throws Error("This extension ctx is stale...")
5. Catch block: message.includes("stale") → true
6. stopAsyncRunNotifier(state) → clearInterval(interval)
7. console.error("stale ctx detected; stopping notifier.")
8. ❌ Notifier stopped permanently
```

The problem: the **session_start handler** hasn't had a chance to run yet to start the new notifier.

### Why hasn't session_start run yet?

When Pi invalidates ctx, the old notifier interval **is still running** (clearInterval hasn't been called yet). The interval tick occurs **before** `cleanupRuntime()` or the `session_start` handler runs. This is a **race condition** between:
- The old notifier's setInterval tick
- Pi's session shutdown/start event sequence

### Code location

**`/home/bom/source/my_pi/pi-crew/src/extension/async-notifier.ts`**, line 103-112:
```typescript
} catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("stale") || message.includes("session replacement") || message.includes("old ctx")) {
        console.error(`[pi-crew] async notifier stale ctx detected; stopping notifier.`);
        try { stopAsyncRunNotifier(state); } catch { /* ignore */ }
        return;  // ❌ Stops the interval, never restarts
    }
}
```

### Why it matters

- User restarts Pi → notifier dies → background runs complete silently
- The user has to manually check `team status` to learn that runs finished
- Severe UX impact: pi-crew goes "silent" after a restart

## Fix

### Option A: Silently swallow stale errors (recommended)

Instead of stopping the notifier, just **skip this notification** and let session_start restart the notifier with the new ctx:

```typescript
} catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("stale") || message.includes("session replacement") || message.includes("old ctx")) {
        // Don't stop — session_start will create a new notifier with the new ctx.
        // This old notifier's isCurrent guard will return false on the next tick,
        // making it effectively dormant until cleaned up.
        return;
    }
    console.error(`[pi-crew] async notifier error: ${message}`);
}
```

Rationale: the `isCurrent` guard will return false once `sessionGeneration++` runs → the old notifier interval keeps running but does nothing (silent). The new notifier from `session_start` will work normally.

### Option B: Add an explicit restart mechanism

Add a `restartAsyncRunNotifier()` function and call it from the `session_start` handler. But Option A is simpler and sufficient.

## Key files

```
pi-crew/src/extension/async-notifier.ts  — startAsyncRunNotifier(), stopAsyncRunNotifier()
pi-crew/src/extension/register.ts         — session_start handler, isCurrent guard
```

## Pi SDK reference

Pi's `ExtensionRunner.invalidate()` sets `staleMessage` → `assertActive()` throws:
```
"This extension ctx is stale after session replacement or reload. 
Do not use a captured pi or command ctx after ctx.newSession(), 
ctx.fork(), ctx.switchSession(), or ctx.reload()."
```
