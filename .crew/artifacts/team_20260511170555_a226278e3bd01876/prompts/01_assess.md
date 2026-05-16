# pi-crew Worker Runtime Context
Run ID: team_20260511170555_a226278e3bd01876
Team: implementation
Workflow: implementation
State root: /home/bom/source/my_pi/pi-crew/.crew/state/runs/team_20260511170555_a226278e3bd01876
Artifacts root: /home/bom/source/my_pi/pi-crew/.crew/artifacts/team_20260511170555_a226278e3bd01876
Events path: /home/bom/source/my_pi/pi-crew/.crew/state/runs/team_20260511170555_a226278e3bd01876/events.jsonl
Task ID: 01_assess
Task cwd: /home/bom/source/my_pi/pi-crew/.crew/worktrees/team_20260511170555_a226278e3bd01876/01_assess
Workspace mode: worktree
Protocol:
- Stay within the task scope unless the prompt explicitly says otherwise.
- Report blockers and verification evidence in the final result.
- Do not claim completion without evidence.
- Follow the Task Packet contract below; escalate if any contract field is impossible to satisfy.
# READ-ONLY ROLE CONTRACT
You are running in READ-ONLY mode for this task.
- Do not create, modify, delete, move, or copy files.
- Do not use shell redirects, heredocs, in-place edits, package installs, git commit/merge/rebase/reset/checkout, or other state-mutating commands.
- If implementation changes are needed, report exact recommendations instead of applying them.
- Prefer read/grep/find/listing tools and read-only git inspection commands.
# Crew Coordination Channel
Mailbox target for this task: 01_assess
Use the run mailbox contract for coordination with the leader/orchestrator:
- If blocked or uncertain, report the blocker in your final result and, when mailbox tools/API are available, send an inbox/outbox message addressed to the leader.
- Ask the leader before editing when scope is ambiguous, requirements conflict, destructive action is needed, or you discover likely overlap with another task.
- Before making non-trivial edits, state intended changed files in your notes/result; if another worker may touch the same file/symbol, pause and request sequencing/ownership guidance.
- Do not resolve cross-worker conflicts silently. Escalate via mailbox/result with: file/symbol, conflicting task if known, proposed owner, and safest next step.
- If nudged, answer with current status, blocker, or smallest next step.
- Treat inherited/dependency context as reference-only; do not continue the parent conversation directly.
- Completion handoff should include: DONE/FAILED, summary, changed/read files, verification evidence, and remaining risks.
# Workspace Structure
.
  - workflows/
    - fast-fix.workflow.md  507B  just now
    - implementation.workflow.md  1.8KB  just now
    - parallel-research.workflow.md  1.6KB  just now
    - research.workflow.md  345B  just now
    - review.workflow.md  801B  just now
    - default.workflow.md  608B  just now
  - tsconfig.json  383B  just now
  - test/
    - unit/
      - team-runner-merge.test.ts  4.3KB  just now
      - team-tool-dispatch.test.ts  9.0KB  just now
      - team-tool-metrics.test.ts  1.8KB  just now
      - team-tool-schema.test.ts  1.6KB  just now
      - theme-adapter.test.ts  2.3KB  just now
      - timings.test.ts  322B  just now
      - transcript-entries.test.ts  4.8KB  just now
      - transcript-viewer.test.ts  6.0KB  just now
      - validate-resources.test.ts  1.2KB  just now
      - validation-severity.test.ts  4.0KB  just now
      - visual.test.ts  1.4KB  just now
      - … 235 more
      - active-run-registry.test.ts  5.7KB  just now
    - integration/
      - mock-child-json-run.test.ts  1.5KB  just now
      - mock-child-run.test.ts  1.5KB  just now
      - operator-experience.test.ts  5.4KB  just now
      - phase3-runtime.test.ts  8.1KB  just now
      - phase4-runtime.test.ts  8.0KB  just now
      - phase5-observability.test.ts  3.6KB  just now
      - phase6-control.test.ts  3.6KB  just now
      - phase6-runtime-hardening.test.ts  2.9KB  just now
      - phase6-smoke.test.ts  2.1KB  just now
      - phase8-smoke.test.ts  7.6KB  just now
      - resume-checkpoint.test.ts  3.9KB  just now
      - … 2 more
      - async-restart-recovery.test.ts  2.2KB  just now
    - fixtures/
      - tool-result-helpers.ts  555B  just now
      - pi-json-output.jsonl  235B  just now
  - teams/
    - fast-fix.team.md  267B  just now
    - implementation.team.md  795B  just now
    - parallel-research.team.md  473B  just now
    - research.team.md  278B  just now
    - review.team.md  372B  just now
    - default.team.md  320B  just now
  - src/
    - worktree/
      - cleanup.ts  2.7KB  just now
      - worktree-manager.ts  6.4KB  just now
      - branch-freshness.ts  2.2KB  just now
    - workflows/
      - validate-workflow.ts  1.4KB  just now
      - workflow-config.ts  618B  just now
      - workflow-serializer.ts  1.5KB  just now
      - discover-workflows.ts  5.6KB  just now
    - utils/
      - file-coalescer.ts  2.3KB  just now
      - frontmatter.ts  2.1KB  just now
      - fs-watch.ts  623B  just now
      - git.ts  6.3KB  just now
      - ids.ts  646B  just now
      - incremental-reader.ts  2.5KB  just now
      - internal-error.ts  384B  just now
      - names.ts  1.1KB  just now
      - paths.ts  2.2KB  just now
      - redaction.ts  2.0KB  just now
      - safe-paths.ts  2.1KB  just now
      - … 6 more
      - completion-dedupe.ts  2.0KB  just now
    - ui/
      - transcript-viewer.ts  13.2KB  just now
      - overlays/
      - pi-ui-compat.ts  2.2KB  just now
      - powerbar-publisher.ts  8.5KB  just now
      - render-coalescer.ts  1.3KB  just now
      - render-diff.ts  3.6KB  just now
    - teams/
    - types/
    - subagents/
    - state/
    - skills/
    - schema/
    - runtime/
    - … 7 more
    - adapters/
  - skills/
    - safe-bash/
    - secure-agent-orchestration-review/
    - state-mutation-locking/
    - systematic-debugging/
    - task-packet/
    - ui-render-performance/
    - verification-before-done/
    - verify-evidence/
    - worktree-isolation/
    - async-worker-recovery/
    - context-artifact-hygiene/
    - … 12 more
    - runtime-state-reader/
  - package-lock.json  139.0KB  just now
  - package.json  2.5KB  just now
  - schema.json  10.7KB  just now
  - scripts/
    - release-smoke.mjs  2.4KB  just now
  - docs/
    - architecture.md  9.3KB  just now
    - commands-reference.md  10.1KB  just now
    - live-mailbox-runtime.md  1.7KB  just now
    - next-upgrade-roadmap.md  28.4KB  just now
    - publishing.md  927B  just now
    - resource-formats.md  3.5KB  just now
    - runtime-flow.md  6.8KB  just now
    - usage.md  5.2KB  just now
    - actions-reference.md  10.7KB  just now
  - … 7 more
  - README.md  9.5KB  just now
… (66 lines elided)

Goal:
Implement đầy đủ 9 extensions: pi-smart, pi-memory, pi-pipeline, pi-lsp, pi-review, pi-visual, pi-web-research, pi-ci, pi-debug

Step: assess
Role: planner

# Applicable Skills
The following skills were selected for this worker. Follow them when they match the current task. If a selected skill conflicts with the explicit task packet, project AGENTS.md, or user request, follow the stricter/higher-priority instruction and report the conflict.

## delegation-patterns
Description: Subagent/team delegation workflow. Use when splitting work across pi-crew teams, direct agents, async background workers, chains, or parallel research/review tasks.
Source: project:skills/delegation-patterns

# delegation-patterns

Use this skill when deciding how to delegate work.

## Source patterns distilled

- pi-subagents: foreground/background/parallel/chain execution, fork/fresh context, worktree isolation, result watcher
- pi-crew: `src/extension/team-tool/run.ts`, `src/runtime/team-runner.ts`, `src/runtime/task-graph-scheduler.ts`, builtin `teams/*.team.md`, `workflows/*.workflow.md`
- Existing pi-crew skill: `task-packet`

## Rules

- Delegate when tasks span multiple files/subsystems, need planning/review/verification, or can be independently researched.
- Do not parallelize edits to the same file, symbol, migration path, manifest/lockfile, or generated schema unless explicitly sequenced.
- Use read-only explorer/reviewer roles for source audit; implementation workers should receive narrow task packets.
- For async/background work, provide concrete objective, scope, constraints, outputs, and verification. Do not spin in wait loops; retrieve results when notified or when needed.
- For chain-style work, pass dependency outputs forward explicitly and require downstream workers to read upstream artifacts first.
- Use worktree isolation for risky parallel code-changing tasks when repository cleanliness and merge plan allow it.
- Require workers to report blockers and smallest recoverable next action rather than making broad assumptions.

## Task packet checklist

- objective
- scope/paths
- allowed edits vs read-only areas
- constraint

[skill instructions truncated]

---

## requirements-to-task-packet
Description: Use when a goal, issue, roadmap item, review finding, or user request must become actionable worker tasks.
Source: project:skills/requirements-to-task-packet

# requirements-to-task-packet

Core principle: workers need explicit task packets, not inherited ambiguity. Ask only when ambiguity changes architecture, safety, public behavior, or data loss risk; otherwise record assumptions.

Distilled from detailed reads of clarification, spec-to-implementation, subagent-driven development, and skill-authoring patterns.

## Clarify or Proceed

Ask before implementation when ambiguity affects:

- security boundary, permissions, ownership, or secret handling;
- destructive operations, migrations, publishing, or public API behavior;
- architecture or data model;
- acceptance criteria or rollback expectations.

Proceed with explicit assumptions when ambiguity is local, reversible, and testable.

## Task Packet Template

```text
Objective:
Scope/paths:
Allowed edits:
Forbidden edits/non-goals:
Inputs/dependencies:
Relevant context/artifacts:
Assumptions:
Risks:
Acceptance criteria:
Verification commands:
Expected output artifacts:
Escalation conditions:
```

## Subagent Context Rules

- Give each worker fresh, curated context; do not rely on hidden parent history.
- Include exact upstream artifact paths and summaries when needed.
- Keep implementation tasks independent or explicitly sequenced.
- Require workers to report one of: DONE, DONE_WITH_CONCERNS, NEEDS_CONTEXT, BLOCKED.
- For BLOCKED/NEEDS_CONTEXT, change context/model/scope before retrying.

## Acceptance Criteria

Use observable checks:

- comm

[skill instructions truncated]

# Task Packet

```json
{
  "objective": "Assess this task and decide how many subagents are actually needed for: Implement đầy đủ 9 extensions: pi-smart, pi-memory, pi-pipeline, pi-lsp, pi-review, pi-visual, pi-web-research, pi-ci, pi-debug\n\nYou are the orchestration planner. Inspect the repository enough to choose an efficient crew; do not use a fixed template. Small/simple tasks may need one executor plus one verifier. Risky or broad tasks may need parallel explorers, specialists, implementers, reviewers, security reviewers, or test engineers.\n\nReturn a concise rationale, then include exactly one JSON block between these markers:\n\nADAPTIVE_PLAN_JSON_START\n{\n  \"phases\": [\n    {\n      \"name\": \"short-phase-name\",\n      \"tasks\": [\n        {\n          \"role\": \"explorer|analyst|planner|critic|executor|reviewer|security-reviewer|test-engineer|verifier|writer\",\n          \"title\": \"short task title\",\n          \"task\": \"specific autonomous task prompt for this subagent\"\n        }\n      ]\n    }\n  ]\n}\nADAPTIVE_PLAN_JSON_END\n\nRules:\n- **MAXIMIZE PARALLELISM**: Put independent tasks in the SAME phase so they run concurrently.\n  For example, if a task needs exploration + implementation + review, use 3 phases:\n  Phase 1: explorers (2-3 in parallel), Phase 2: executors (2-3 in parallel), Phase 3: reviewers (2 in parallel).\n  NEVER create sequential phases when tasks are independent.\n- Choose the smallest effective number of subagents per phase.\n- Tasks within the same phase run in parallel; phases run sequentially.\n- Include verification/review tasks when implementation is requested.\n- Do not include more than 12 total subagents; split or summarize oversized plans instead.\n- A good plan for a complex task has 2-4 phases with 2-4 parallel tasks each.\n- A simple task may have just 1-2 phases with 1-2 tasks.",
  "scope": "workspace",
  "repo": "pi-crew",
  "worktree": "/home/bom/source/my_pi/pi-crew/.crew/worktrees/team_20260511170555_a226278e3bd01876/01_assess",
  "branchPolicy": "Use the assigned task worktree and avoid modifying the leader checkout.",
  "acceptanceTests": [],
  "commitPolicy": "Do not commit unless explicitly requested by the user or workflow.",
  "reportingContract": "Report intended/changed files, verification evidence, blockers, conflict risks, and next recommended action.",
  "escalationPolicy": "Stop and report if scope is ambiguous, destructive action is needed, permissions are missing, verification cannot be completed, or edits may overlap with another worker/task.",
  "constraints": [
    "Stay within the assigned task scope.",
    "Do not claim completion without verification evidence.",
    "Use mailbox/API state for coordination when available.",
    "Do not make overlapping edits to the same file/symbol without explicit leader sequencing or ownership guidance."
  ],
  "expectedArtifacts": [
    "prompt",
    "result",
    "verification"
  ],
  "verification": {
    "requiredGreenLevel": "none",
    "commands": [],
    "allowManualEvidence": true
  }
}
```





Task:
Assess this task and decide how many subagents are actually needed for: Implement đầy đủ 9 extensions: pi-smart, pi-memory, pi-pipeline, pi-lsp, pi-review, pi-visual, pi-web-research, pi-ci, pi-debug

You are the orchestration planner. Inspect the repository enough to choose an efficient crew; do not use a fixed template. Small/simple tasks may need one executor plus one verifier. Risky or broad tasks may need parallel explorers, specialists, implementers, reviewers, security reviewers, or test engineers.

Return a concise rationale, then include exactly one JSON block between these markers:

ADAPTIVE_PLAN_JSON_START
{
  "phases": [
    {
      "name": "short-phase-name",
      "tasks": [
        {
          "role": "explorer|analyst|planner|critic|executor|reviewer|security-reviewer|test-engineer|verifier|writer",
          "title": "short task title",
          "task": "specific autonomous task prompt for this subagent"
        }
      ]
    }
  ]
}
ADAPTIVE_PLAN_JSON_END

Rules:
- **MAXIMIZE PARALLELISM**: Put independent tasks in the SAME phase so they run concurrently.
  For example, if a task needs exploration + implementation + review, use 3 phases:
  Phase 1: explorers (2-3 in parallel), Phase 2: executors (2-3 in parallel), Phase 3: reviewers (2 in parallel).
  NEVER create sequential phases when tasks are independent.
- Choose the smallest effective number of subagents per phase.
- Tasks within the same phase run in parallel; phases run sequentially.
- Include verification/review tasks when implementation is requested.
- Do not include more than 12 total subagents; split or summarize oversized plans instead.
- A good plan for a complex task has 2-4 phases with 2-4 parallel tasks each.
- A simple task may have just 1-2 phases with 1-2 tasks.
