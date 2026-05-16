Selected skills: state-mutation-locking, safe-bash, verification-before-done
Skill paths passed to child Pi: 3

# Applicable Skills
The following skills were selected for this worker. Follow them when they match the current task. If a selected skill conflicts with the explicit task packet, project AGENTS.md, or user request, follow the stricter/higher-priority instruction and report the conflict.

## state-mutation-locking
Description: Durable state mutation and locking workflow. Use when changing manifests, tasks, mailbox, claims, events, stale reconciliation, recovery, cancel/respond/resume, or retry logic.
Source: project:skills/state-mutation-locking

# state-mutation-locking

Use this skill before modifying pi-crew run state.

## Source patterns distilled

- `src/state/locks.ts` — run-level sync/async locks
- `src/state/state-store.ts` — manifest/tasks persistence
- `src/state/contracts.ts` — allowed status transitions
- `src/state/mailbox.ts`, `src/state/task-claims.ts`, `src/state/atomic-write.ts`
- `src/runtime/crash-recovery.ts`, `src/runtime/stale-reconciler.ts`, `src/runtime/team-runner.ts`

## Rules

- Mutations to a run's `manifest.json`, `tasks.json`, mailbox delivery state, claims, or recovery status must be protected by a run lock when concurrent actions are possible.
- Re-read manifest/tasks inside the lock before making a decision; pre-lock reads are only for locating the run.
- Persist with atomic write helpers (`atomicWriteJson`, async variants, or state-store helpers). Do not partially write JSON files.
- Respect status contracts. Do not transition terminal tasks/runs unless the action explicitly supports force semantics.
- Separate analysis from persistence: pure reconcilers should return intended repaired state; locked callers should persist it.
- In retry/resume paths, reload fresh task status immediately before execution and skip if the task is no longer retryable/runnable.
- Include event-log entries for externally visible state changes.

## Anti-patterns

- Reading state, waiting/doing async work, then writing the old copy.
- Updating `tasks.json` from a reconc

[skill instructions truncated]

---

## safe-bash
Description: Safe shell-command workflow. Use whenever a task may execute shell commands, especially to prefer read-only commands and avoid destructive actions without confirmation.
Source: project:skills/safe-bash

# safe-bash

Use this skill whenever a task may execute shell commands.

## Rules

- Prefer read-only commands first: `pwd`, `ls`, `find`, `rg`, `git status`, package-manager dry runs.
- Before mutating commands, explain the target path and expected effect.
- Never run destructive cleanup (`rm -rf`, `git clean`, force delete, prune, reset hard) without explicit confirmation.
- Avoid shell-specific assumptions when a cross-platform Node/Pi API exists.
- On Windows, prefer argv-based process execution and avoid `cmd /c start` or `/bin/bash` unless explicitly required.
- Capture verification output and summarize exit status.

## Reporting

Mention commands run and whether they were read-only or mutating.

---

## verification-before-done
Description: Use when about to claim work is complete, fixed, passing, reviewed, committed, or ready to hand off.
Source: project:skills/verification-before-done

# verification-before-done

Core principle: evidence before claims. A worker report, green-looking log, or previous run is not fresh verification.

Distilled from detailed reads of agent-skill patterns for verification-before-completion, TDD, review reception, and QA workflows.

## Gate Function

Before any completion claim:

1. Identify the command or inspection that proves the claim.
2. Run the full command fresh, or explicitly state why a command cannot be run.
3. Read the output, including exit code and failure counts.
4. Compare the output to the claim.
5. Report the claim only with the evidence.

## Claim-to-Evidence Table

| Claim | Requires | Not sufficient |
|---|---|---|
| Tests pass | Fresh test output with zero failures | Prior run, “should pass” |
| Typecheck passes | Typecheck command exit 0 | Lint or targeted tests only |
| Bug fixed | Original symptom/regression test passes | Code changed |
| Requirements met | Checklist against request/plan | Generic test success |
| Agent completed | Worker output plus artifact/diff/state inspection | Worker says DONE |
| Safe to commit | Relevant checks pass and status reviewed | Partial local confidence |

## Verification Ladder

Choose the smallest reliable gate, then escalate when risk requires it:

1. Read-only inspection for plans/reviews.
2. Targeted unit test for touched behavior.
3. Typecheck for TypeScript/schema/API changes.
4. Integration test for runtime, subprocess, state

[skill instructions truncated]
