# Batch A: H1 + H2 Fixes

Date: 2026-05-18

## H1: Event-log silent loss when exceeding MAX_EVENTS_BYTES (50MB)

### File
`src/state/event-log.ts`

### Problem
When the event log file exceeds 50MB, events are dropped immediately (including terminal events) but `appendCounter` is not incremented → compaction is never triggered.

### Fix applied
In `appendEventInsideLock`:

1. **Prioritize terminal events**: check `isTerminal = TERMINAL_EVENT_TYPES.has(fullEvent.type)` first
2. **Non-terminal events exceeding the limit** → call `compactEventLog()` immediately (don't wait for counter % 100)
3. **If still over the limit after compaction** → call `rotateEventLog()`
4. **Only drop the event** when a non-terminal event is still over the limit after compaction + rotation
5. **Terminal events are always persisted** regardless of size

```ts
const isTerminal = TERMINAL_EVENT_TYPES.has(fullEvent.type);
let skippedDueToSize = false;
if (!isTerminal && fs.existsSync(eventsPath)) {
    const stat = fs.statSync(eventsPath);
    if (stat.size > MAX_EVENTS_BYTES) {
        try {
            compactEventLog(eventsPath);
        } catch (error) {
            logInternalError("event-log.immediate-compact", error, `eventsPath=${eventsPath}`);
        }
        if (fs.existsSync(eventsPath)) {
            const afterCompact = fs.statSync(eventsPath);
            if (afterCompact.size > MAX_EVENTS_BYTES) {
                rotateEventLog(eventsPath);
            }
        }
    }
}
```

### Verification
```bash
npm run typecheck  # PASSED
```

---

## H2: Mailbox appendFileSync has no cross-process lock

### File
`src/state/mailbox.ts`

### Problem
`appendMailboxMessage` uses `fs.appendFileSync`, which is not atomic on Windows.

### Fix applied
Import and wrap the append in `withEventLogLockSync`:

```ts
import { withEventLogLockSync } from "./event-log.ts";

// In appendMailboxMessage:
withEventLogLockSync(mailboxFile(manifest, complete.direction, complete.taskId), () => {
    fs.appendFileSync(mailboxFile(manifest, complete.direction, complete.taskId), `${JSON.stringify(redactSecrets(complete))}\n`, "utf-8");
});
```

### Verification
```bash
npm run typecheck  # PASSED
```

---

## Changed Files
- `src/state/event-log.ts`
- `src/state/mailbox.ts`

## Verification Evidence
```
> npm run typecheck
> tsc --noEmit && node --experimental-strip-types -e "await import('./index.ts'); console.log('strip-types import ok')"
strip-types import ok
```
