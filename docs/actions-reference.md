# pi-crew — Tool Actions Reference

The `team` tool is the primary tool that pi-crew registers with Pi. All operations go through `action`.

## Quick Reference

| Action | Purpose | When to use |
|--------|---------|-------------|
| `recommend` | Suggest a suitable team/workflow | Starting point when unsure what to pick |
| `run` | Create a run and execute a workflow | Main operation |
| `plan` | Preview a workflow without running tasks | Dry-run planning |
| `orchestrate` | Execute from a plan document | Automate a plan |
| `schedule` | Schedule recurring runs | Periodic automation |
| `scheduled` | List scheduled jobs | View schedules |
| `status` | Read run status | Track progress |
| `summary` | Read/write run summary artifact | Summarize |
| `cancel` | Cancel queued/running work | Stop a run |
| `resume` | Re-queue failed/cancelled tasks | Resume a run |
| `list` | List teams, agents, workflows, runs | Explore resources |
| `get` | Inspect agent/team/workflow | View details |
| `search` | BM25-ranked agent/team discovery | Smart search |
| `events` | Read the event log | Debug/audit |
| `artifacts` | List run artifacts | View outputs |
| `worktrees` | List run worktree metadata | Inspect worktrees |
| `graph` | Load/save/list run graphs | Visualization |
| `cleanup` | Delete run worktrees | Cleanup |
| `forget` | Delete run state/artifacts | Remove entirely (requires `confirm`) |
| `prune` | Delete multiple old finished runs | Bulk cleanup |
| `export` | Export a portable run bundle | Share/backup |
| `import` | Import a run bundle | Receive a run from elsewhere |
| `imports` | List imported bundles | View imports |
| `create` | Create an agent/team/workflow | Extend resources |
| `update` | Update an agent/team/workflow | Edit resources |
| `delete` | Delete an agent/team/workflow | Remove resources (requires `confirm`) |
| `validate` | Validate resources | Health check |
| `doctor` | Check readiness | Diagnose environment |
| `config` | Show/update config | Configuration |
| `init` | Initialize project layout | Initial setup |
| `autonomy` | Manage delegation settings | Adjust automation |
| `api` | Safe interop for state operations | Advanced integration |
| **`goal`** | **v0.9.0** Autonomous goal loop (worker → LLM judge → feedback → iterate) | Autonomous multi-turn |
| **`workflow-create`** | **v0.9.0** Create a `.dwf.ts` (requires `confirm:true`, ACE-gated) | Author dynamic workflow |
| **`workflow-get`** | **v0.9.0** View source + metadata of a dynamic workflow | Inspect `.dwf.ts` |
| **`workflow-list`** | **v0.9.0** List static + dynamic workflows | Discover workflows |
| **`workflow-save`** | **v0.9.0** Overwrite `.dwf.ts` source (requires `confirm:true`) | Update dynamic workflow |
| **`workflow-delete`** | **v0.9.0** Delete a `.dwf.ts` (requires `confirm:true`) | Remove dynamic workflow |
| `help` | Display help text | Help |

---

## Action Details

### `recommend` — Guided suggestions

When you are unsure which team/workflow to use, call `recommend` to get analysis and suggestions:

```json
{
  "action": "recommend",
  "goal": "Refactor auth flow and add tests"
}
```

The response includes:
- The suggested team/workflow
- Fanout hints (how many subagents)
- Whether to use async or worktree mode
- The rationale for the choice

---

### `run` — Execute a workflow

This is the main action. It creates a run manifest, a task graph, and executes it.

#### Basic syntax

```json
{
  "action": "run",
  "team": "default",
  "goal": "Investigate failing tests and propose a fix"
}
```

#### Choose a team

| Team | Purpose |
|------|---------|
| `default` | Balanced, 4 steps: explore → plan → execute → verify |
| `fast-fix` | Small bug fixes: explore → execute → verify |
| `implementation` | Adaptive planner decides fanout on its own |
| `review` | Code review + security review |
| `research` | Research and documentation writing |

#### Run asynchronously (async)

```json
{
  "action": "run",
  "team": "implementation",
  "goal": "Implement user settings screen",
  "async": true
}
```

The run is detached from the session and survives session switches/reloads. pi-crew automatically notifies you when the run completes.

#### Worktree isolation

```json
{
  "action": "run",
  "team": "implementation",
  "goal": "Add API endpoint and tests",
  "workspaceMode": "worktree"
}
```

Each task runs in its own git worktree — safe for the main codebase. Requires a clean repo.

#### Override model

```json
{
  "action": "run",
  "team": "default",
  "goal": "Quick exploration",
  "model": "gpt-4o-mini"
}
```

#### Override config for a run

```json
{
  "action": "run",
  "team": "implementation",
  "goal": "Refactor auth",
  "config": {
    "runtime": { "requirePlanApproval": true },
    "limits": { "maxConcurrentWorkers": 4 }
  }
}
```

#### Plan approval gate

Requires explicit approval after the planner creates the plan, before the executor runs:

```json
{
  "action": "run",
  "team": "implementation",
  "goal": "Major refactor",
  "config": {
    "runtime": { "requirePlanApproval": true }
  }
}
```

Approve:

```json
{
  "action": "api",
  "runId": "team_...",
  "config": { "operation": "approve-plan" }
}
```

Cancel plan:

```json
{
  "action": "api",
  "runId": "team_...",
  "config": { "operation": "cancel-plan" }
}
```

---

### `plan` — Preview a workflow

Like `run` but **does not spawn workers**. Previews the task graph that would be created:

```json
{
  "action": "plan",
  "team": "implementation",
  "goal": "Add authentication module"
}
```

---

### `orchestrate` — Execute from a plan document

Executes a workflow from a plan document that contains tagged sections:

```markdown
# Design Phase
<!-- tag: design -->
Design the authentication system...

# Implementation
<!-- tag: impl -->
Implement the JWT auth...
```

```json
{
  "action": "orchestrate",
  "planPath": "./plan.md"
}
```

TAG→chain mapping:
- `design` → planner, architect
- `impl` → tdd-guide, lang-reviewer
- `security` → security-reviewer, lang-reviewer
- `build` → build-error-resolver
- `test` → test-engineer, verifier
- `review` → reviewer

---

### `schedule` — Schedule recurring runs

Creates a scheduled job using cron, interval, or once:

```json
{
  "action": "schedule",
  "team": "review",
  "goal": "Weekly security review",
  "cron": "0 9 * * MON"
}
```

Params: `cron`, `interval` (ms), `once` (ISO timestamp)

---

### `scheduled` — List scheduled jobs

```json
{
  "action": "scheduled"
}
```

---

### `graph` — Load/save/list run graphs

```json
{
  "action": "graph",
  "runId": "team_..."
}
```

---

### `search` — BM25-ranked discovery

Search agents/teams/workflows with BM25 ranking:

```json
{
  "action": "search",
  "goal": "security audit"
}
```

---

### `status` — Run status

```json
{
  "action": "status",
  "runId": "team_..."
}
```

Output includes: manifest, tasks, agents, timing, usage totals.

---

### `summary` — Run summary

Read summary:

```json
{
  "action": "summary",
  "runId": "team_..."
}
```

Write summary:

```json
{
  "action": "summary",
  "runId": "team_...",
  "message": "Implemented auth with tests. All passing."
}
```

---

### `cancel` — Cancel a run

```json
{
  "action": "cancel",
  "runId": "team_..."
}
```

Cancels all queued/running tasks. Running child processes receive SIGTERM.

---

### `resume` — Resume a run

```json
{
  "action": "resume",
  "runId": "team_..."
}
```

Re-queues failed/cancelled/skipped tasks. Already-completed tasks are unaffected.

---

### `list` — List resources

```json
{
  "action": "list"
}
```

Displays: discovered teams, agents, workflows, and recent runs.

---

### `get` — Inspect resource details

```json
{
  "action": "get",
  "resource": "agent",
  "agent": "executor"
}
```

---

### `events` — Event log

```json
{
  "action": "events",
  "runId": "team_..."
}
```

Append-only JSONL events: task.started, task.completed, run.blocked, etc.

---

### `artifacts` — Run outputs

```json
{
  "action": "artifacts",
  "runId": "team_..."
}
```

---

### `worktrees` — Worktree metadata

```json
{
  "action": "worktrees",
  "runId": "team_..."
}
```

---

### `cleanup` — Delete worktrees

```json
{
  "action": "cleanup",
  "runId": "team_..."
}
```

Dirty worktrees are kept unless `force: true`.

---

### `forget` — Delete a run entirely

```json
{
  "action": "forget",
  "runId": "team_...",
  "confirm": true
}
```

Deletes state + artifacts + worktrees. Requires `confirm: true`.

---

### `prune` — Delete old runs

```json
{
  "action": "prune",
  "confirm": true,
  "keep": 10
}
```

Keeps the `keep` most recent runs and deletes the rest.

---

### `export` / `import` — Share runs

Export:

```json
{
  "action": "export",
  "runId": "team_..."
}
```

Import:

```json
{
  "action": "import",
  "path": "/path/to/run-export.json"
}
```

User-global import:

```json
{
  "action": "import",
  "path": "/path/to/run-export.json",
  "scope": "user"
}
```

List imports:

```json
{
  "action": "imports"
}
```

---

### `create` — Create resources

Create an agent:

```json
{
  "action": "create",
  "resource": "agent",
  "config": {
    "scope": "project",
    "name": "api-reviewer",
    "description": "Reviews backend API changes",
    "systemPrompt": "You review backend API changes for correctness and compatibility.",
    "triggers": ["api", "endpoint", "contract"],
    "useWhen": ["backend API change", "OpenAPI contract update"],
    "avoidWhen": ["documentation-only edits"],
    "cost": "cheap",
    "category": "backend"
  }
}
```

Create a team:

```json
{
  "action": "create",
  "resource": "team",
  "config": {
    "name": "backend-team",
    "description": "Backend implementation team",
    "scope": "project",
    "defaultWorkflow": "default",
    "roles": [
      { "name": "explorer", "agent": "explorer" },
      { "name": "executor", "agent": "executor" },
      { "name": "verifier", "agent": "verifier" }
    ]
  }
}
```

Create a workflow:

```json
{
  "action": "create",
  "resource": "workflow",
  "config": {
    "name": "quick-review",
    "scope": "user",
    "steps": [
      { "id": "review", "role": "reviewer", "prompt": "Review: {goal}" },
      { "id": "verify", "role": "verifier", "dependsOn": "review", "verify": true, "prompt": "Verify the review findings." }
    ]
  }
}
```

---

### `update` — Update resources

```json
{
  "action": "update",
  "resource": "agent",
  "agent": "worker",
  "scope": "project",
  "updateReferences": true,
  "config": { "name": "better-worker", "description": "Improved worker agent" }
}
```

`updateReferences: true` automatically updates all team references pointing to the old name.

---

### `delete` — Delete resources

```json
{
  "action": "delete",
  "resource": "team",
  "team": "backend-team",
  "scope": "project",
  "confirm": true
}
```

Creates a backup automatically before deleting.

---

### `validate` — Validate resources

```json
{
  "action": "validate"
}
```

Checks: agents, teams, workflows, references, model hints.

---

### `doctor` — Diagnose environment

```json
{
  "action": "doctor"
}
```

Checks: cwd, platform, Node.js, Pi version, git, state paths, config, resources, model/provider.

Smoke test child Pi (explicit):

```json
{
  "action": "doctor",
  "config": { "smokeChildPi": true }
}
```

---

### `api` — Advanced state interop

Safe API for run/task/event/heartbeat/claim/mailbox operations:

```text
/team-api <runId> <operation> [key=value]
```

Operations:

| Operation | Description |
|-----------|-------------|
| `read-manifest` | Read the manifest |
| `list-tasks` | List tasks |
| `read-task` | Read a task (requires `taskId=`) |
| `read-events` | Read the event log |
| `read-heartbeat` | Read a heartbeat (requires `taskId=`) |
| `write-heartbeat` | Write a heartbeat (requires `taskId=`, `alive=`) |
| `claim-task` | Claim a task (requires `taskId=`, `owner=`) |
| `release-task-claim` | Release a claim |
| `transition-task-status` | Transition task status |
| `send-message` | Send a mailbox message |
| `read-mailbox` | Read the mailbox |
| `ack-message` | Acknowledge a message |
| `read-delivery` | Read delivery state |
| `validate-mailbox` | Validate/repair mailbox |
| `approve-plan` | Approve a plan (when requirePlanApproval) |
| `cancel-plan` | Cancel a plan |

---

### `config` — Configuration

View current config:

```json
{ "action": "config" }
```

Update user config:

```json
{
  "action": "config",
  "config": { "asyncByDefault": true }
}
```

Unset:

```json
{
  "action": "config",
  "config": { "autonomous.preferAsyncForLongTasks": "unset" }
}
```

---

### `init` — Initialize project

```json
{ "action": "init" }
```

Copy builtins:

```json
{ "action": "init", "config": { "copyBuiltins": true, "overwrite": true } }
```

---

### `autonomy` — Delegation settings

```json
{ "action": "autonomy" }
```

Profiles: `manual`, `suggested`, `assisted`, `aggressive`.
