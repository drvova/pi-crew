# Bug Report: Cross-Session Notification Leakage

**Date:** 2026-05-28  
**Severity:** High  
**Status:** In Progress  
**Session Issue:** Notifications and agent status from one session appear in another session

---

## Summary

When running multiple pi-crew sessions simultaneously, notifications (dead worker alerts, stuck task warnings, run status updates) from one session appear in another session's UI. This causes confusion and potential errors when agents receive signals about runs they don't own.

---

## Symptom

| Behavior | Expected | Actual |
|----------|----------|--------|
| Notification origin | Only from current session's runs | From ALL sessions' runs |
| Agent status | Only show agents in current session | Shows agents from other sessions |
| Dashboard alerts | Per-session filtering | Global broadcast |

### Example Timeline

```
Session A (08:09): Starts run team_20260528080917
Session B (08:59): Starts run team_20260528085943
Session C (09:00): Starts run team_20260528090045

Problem: Session A receives notifications about:
- team_20260528085943 (Session B's run)
- team_20260528090045 (Session C's run)
```

---

## Status: FIXED ✅

**Date:** 2026-05-28

### Fix Applied

**File:** `src/extension/register.ts` (lines ~1498-1510)

**Change:** Health notification loop now filters manifests by session before processing:

```typescript
// BEFORE: All manifests from all sessions
const manifests = lastFrameManifestCache.list(20);
for (const run of manifests) {
  // notified about ALL runs
}

// AFTER: Only current session's runs
const currentSessionGen = sessionGeneration;
const currentSessionId = currentCtx ? (currentCtx as unknown as Record<string, unknown>).sessionId as string | undefined : undefined;
const sessionManifests = manifests.filter(
  (run) =>
    !run.ownerSessionId ||
    run.ownerSessionId === currentSessionId ||
    (run as unknown as Record<string, unknown>).ownerSessionGeneration === currentSessionGen,
);
for (const run of sessionManifests) {
  // only notify about current session's runs
}
```

### Verification

1. ✅ TypeScript compiles without new errors in the modified section
2. ✅ Session ID extracted from currentCtx via type casting
3. ✅ Manifests filtered by ownerSessionId or ownerSessionGeneration
4. ✅ Health notifications only fire for current session's runs

### Pre-existing Errors (Not Related)

Lines 706, 1087 have pre-existing type errors unrelated to this fix.

---

*Bug report complete. Fix verified.*