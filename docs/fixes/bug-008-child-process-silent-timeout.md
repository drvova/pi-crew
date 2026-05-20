# Bug #8: Background child-process 300s timeout — Silent hang

| Field | Value |
|---|---|
| **Severity** | 🟠 MEDIUM |
| **Status** | Root cause identified, fix partially applied |
| **Affected** | All async/background team runs (child-process runtime) |

## Symptom

```
worker.spawned: pid=177677 ✅ (real process spawned)
worker.response_timeout: No output for 300000ms
crew.task.heartbeat_dead: elapsedMs=300774
worker.exit: exitCode=null (killed)
Result: jsonEvents=0, toolUses=0, output.log=DOES NOT EXIST, stderr=EMPTY
```

## Root Cause

Child Pi process:
1. Spawned successfully (real OS process with valid PID)
2. Ran completely SILENT — zero stdout, zero stderr for 5 minutes
3. Timed out after 300s with no output
4. Killed by SIGTERM

**The process was alive but produced no output at all.** This is NOT:
- ❌ Crash (would have stderr)
- ❌ 429 rate limit (Round 1 fix handles this)
- ❌ Model error (would have error output)

**Possible causes:**
1. MiniMax provider silently hangs in child-process context
2. Child Pi startup error but stderr channel not capturing it
3. Model called but produces empty response → child waits forever
4. IPC communication failure between parent and child

## Evidence

```
Event timeline (team_20260519090953_e6ddc7b21b0048fa):
09:09:54.511Z  worker.spawned pid=177677
09:13:38.075Z  task.attention: 223s idle (no observed activity)
09:14:54.516Z  worker.response_timeout: No output for 300000ms
              → stderr: NOT IN EVENT (timeoutStderr was empty/undefined)
09:14:57.535Z  worker.exit exitCode=null (killed)
```

```
Agent files: only status.json exists
output.log: DOES NOT EXIST
stderr.log: DOES NOT EXIST
result: "(no output)" (11 bytes)
```

## Partial Fix Applied

`timeoutStderr` is now captured and included in `response_timeout` events. However, in this case the stderr was empty — meaning the child process ran but produced nothing to stderr.

## Files Involved

```
pi-crew/src/runtime/child-pi.ts    — spawn, timeout, stderr capture
pi-crew/src/runtime/background-runner.ts — async run management
pi-crew/src/runtime/task-runner.ts      — worker lifecycle
```

## Fix Suggestions

### Fix A: Add stderr capture at spawn moment
Capture any startup errors from child Pi's stderr pipe immediately after spawn.

```typescript
// In child-pi.ts, after child spawn:
child.stderr?.on("data", (chunk) => {
  stderr += chunk.toString();
  // Also log to parent for debugging
  console.error("[pi-crew:child-stderr]", chunk.toString());
});
```

### Fix B: Reduce timeout for background workers
For background/async runs, use shorter timeout (60s) since output should stream quickly.

### Fix C: Detect silent spawn (no output within 30s = warning)
If a worker spawns but produces zero output within 30s, emit a warning event.

### Fix D: Add process startup verification
Send a ping to the child Pi and expect a response within 10s. If no response, consider it a spawn failure.

## Comparison: Live-session vs Child-process

| Aspect | Live-session | Child-process |
|---|---|---|
| Startup | Immediate | Delayed (~1s) |
| Model output | Streaming JSON | Silent hang |
| Error visibility | Direct | Hidden (no stderr) |
| Timeout | Works correctly | Silent 300s hang |

This suggests the issue is specific to **child-process runtime with MiniMax model** — the model provider silently fails in the background subprocess context.