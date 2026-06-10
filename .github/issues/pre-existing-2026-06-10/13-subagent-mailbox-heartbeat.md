# Issue 13: subagent / mailbox / heartbeat / direct-agent

**Status**: pre-existing
**Severity**: Medium
**Component**: `src/runtime/subagent-manager.ts` + `src/runtime/mailbox.ts` + `src/runtime/task-runner-heartbeat.ts` + `src/runtime/direct-agent-run.ts`
**Test count**: 8 failing

## Summary

Tests for the subagent lifecycle, mailbox message replay, task-runner heartbeats, and direct-agent invocation. These are inter-related features (subagent runs trigger heartbeats, send mailbox messages, can be run directly).

## Failing tests

| Test | File | Line |
|---|---|---|
| `child-process runs maintain per-agent status, events, and output files` | `test/unit/agent-runtime-files.test.ts` | :344 |
| `invalidateAgentDiscoveryCache with specific cwd only clears that entry` | `test/unit/agent-discovery-cache.test.ts` | :1316 |
| `direct agent run creates a single task for requested agent` | (unknown source) | :725 |
| `direct agent runs can resume from generated team/workflow metadata` | `test/unit/direct-agent-run.test.ts` | :685 |
| `resume emits mailbox replay event before rerunning queued work` | `test/unit/mailbox-replay.test.ts` | :1927 |
| `registered Agent tool can run a background subagent and join its result` | (unknown source) | :2235 |
| `background subagent completion wakes the parent agent to join results` | (unknown source) | :2236 |
| `runTeamTask refreshes worker heartbeat while child JSON events stream` | (unknown source) | :2370 |

## Possible root cause

- Agent discovery cache invalidation logic may be incorrect (the test expects per-cwd cache entries but the implementation may be using a global cache).
- Direct-agent run resume logic may not generate the expected metadata.
- Mailbox replay ordering may have changed (event order assertion fails).
- Subagent completion → parent wake-up race condition (possibly related to the `orphan-worker-registry` issue #04 hang).

## Suggested fix

1. Run each file in isolation:
   ```bash
   cd /home/bom/source/my_pi/pi-crew
   for f in agent-discovery-cache agent-runtime-files direct-agent-run mailbox-replay; do
     echo "=== $f ==="
     node --test --test-timeout=15000 test/unit/${f}.test.ts 2>&1 | grep -E '^not ok|error:' | head -5
   done
   ```
2. Check for shared dependency on `orphan-worker-registry.ts` or `state-store.ts` (both have related issues).

## Related

- `src/runtime/subagent-manager.ts`
- `src/runtime/mailbox.ts`
- `src/runtime/task-runner-heartbeat.ts`
- `src/runtime/direct-agent-run.ts`
- `src/runtime/agent-discovery-cache.ts`

## Priority

**Medium** — affects direct-agent invocation, a primary user entry point.
