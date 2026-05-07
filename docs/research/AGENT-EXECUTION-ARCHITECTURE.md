# pi-crew vs oh-my-pi: Agent Execution Architecture Comparison

> **Ngày**: 2026-05-07
> **Mục đích**: Tài liệu nghiên cứu để quyết định hybrid execution model

---

## 1. Kiến trúc execution hiện tại

### oh-my-pi: In-process

```
User → TaskTool.execute()
  → mapWithConcurrencyLimit(tasks, maxConcurrency, runSubprocess)
    → Worker 1: createAgentSession() → session.prompt(task)
    → Worker 2: createAgentSession() → session.prompt(task)
    → Worker 3: createAgentSession() → session.prompt(task)
  → Collect results via EventBus subscription
```

**Key files:**
- `Source/oh-my-pi/packages/coding-agent/src/task/executor.ts` (1291 dòng) — `runSubprocess()`
- `Source/oh-my-pi/packages/coding-agent/src/task/parallel.ts` — `mapWithConcurrencyLimit()` + `Semaphore`
- `Source/oh-my-pi/packages/coding-agent/src/sdk.ts` — `createAgentSession()` factory

**Flow chi tiết:**
1. `createAgentSession({ cwd, model, tools, systemPrompt, ... })` — tạo AgentSession mới
2. `session.prompt(task)` — gửi task text, agent loop chạy trong process
3. EventBus subscription lắng nghe events (tool_execution_start/end, message, yield)
4. Worker **phải** gọi `yield` tool đúng 1 lần → result extraction
5. Nếu không yield → gửi reminder prompt (tối đa 3 lần)
6. `session.waitForIdle()` → collect final result

### pi-crew: Child-process (default) + Live-session (in-process)

```
User → team tool → handleRun()
  → executeTeamRun()
    → mapConcurrent(batchTasks, concurrency, runTeamTask)
      → Task 1: runChildPi() → spawn("pi", [...args]) → parse stdout JSONL
      → Task 2: runChildPi() → spawn("pi", [...args]) → parse stdout JSONL
      → Task 3: runLiveSession() → createAgentSession() → session.prompt()
```

**Key files:**
- `src/runtime/child-pi.ts` (458 dòng) — child process spawn + stdout capture
- `src/runtime/live-session-runtime.ts` (245 dòng) — in-process execution via Pi SDK
- `src/runtime/parallel-utils.ts` — `mapConcurrent()` worker pool
- `src/runtime/runtime-resolver.ts` — chọn child-process vs live-session

**2 execution modes:**
| Mode | Khi nào dùng | File |
|------|-------------|------|
| `child-process` | Default, production | `child-pi.ts` |
| `live-session` | Khi Pi host expose SDK | `live-session-runtime.ts` |

---

## 2. So sánh chi tiết

### 2.1 Performance & Overhead

| Metric | oh-my-pi (in-process) | pi-crew (child-process) | pi-crew (live-session) |
|--------|----------------------|------------------------|----------------------|
| Worker startup | ~50ms (createAgentSession) | ~2-5s (spawn pi CLI) | ~50ms (createAgentSession) |
| IPC overhead | Zero (function calls) | JSON parse mỗi line | Zero (function calls) |
| MCP connections | Share parent's | Mỗi worker tự discover | Share parent's |
| Memory per worker | ~10-50MB (AgentSession) | ~100-200MB (full pi process) | ~10-50MB |
| Model registry | Shared | Separate | Shared |

### 2.2 Fault Isolation

| Scenario | oh-my-pi | pi-crew (child-process) | pi-crew (live-session) |
|----------|----------|------------------------|----------------------|
| Worker throws unhandled | ❌ Crash toàn process | ✅ Chỉ worker chết | ❌ Crash toàn process |
| Worker infinite loop | ❌ Block event loop | ✅ Timeout + kill | ❌ Block event loop |
| Worker memory leak | ❌ Accumulate | ✅ OS cleanup khi exit | ❌ Accumulate |
| Worker segfault | ❌ Process die | ✅ Isolated | ❌ Process die |

### 2.3 Result Collection

| Aspect | oh-my-pi | pi-crew (child-process) | pi-crew (live-session) |
|--------|----------|------------------------|----------------------|
| Contract | Yield tool (mandatory, 1 lần) | Parse stdout JSONL (ad-hoc) | TBD (chưa enforce) |
| Validation | JTD/JSON Schema on yield | Không có | TBD |
| Reminder | 3 reminders nếu quên yield | Không có | Không có |
| Extraction | SubprocessToolRegistry (extensible) | SubprocessToolRegistry (mới thêm) | SubprocessToolRegistry |

### 2.4 Communication

| Channel | oh-my-pi | pi-crew |
|---------|----------|---------|
| Parent → Worker | `session.abort()`, AbortSignal | `child.kill()`, AbortSignal, stdin |
| Worker → Parent | EventBus (in-process, typed channels) | stdout JSONL + RunEventBus (5 channels) |
| Inter-agent | IRC tool (DM/broadcast) | Mailbox (task-scoped) |
| Mid-turn steering | ✅ `session.abort()` + continue | ✅ Live-session: steer; Child: cancel only |
| Progress | EventBus typed channels | RunEventBus typed channels |

### 2.5 Parallel Execution

| Aspect | oh-my-pi | pi-crew |
|--------|----------|---------|
| Pool primitive | `Semaphore` (explicit acquire/release) | `mapConcurrent` (implicit worker pool) |
| Fail-fast | `Promise.race([all, firstError])` | Worker loop + signal check |
| Max concurrency | Config `task.maxConcurrency` | `MAX_PARALLEL_CONCURRENCY = 4` |
| Cancellation | AbortSignal per worker | AbortSignal + cancel events |
| Host dispatch | 1 call → N workers (in-process) | 1 call → N child processes hoặc `parallel` action |

---

## 3. pi-crew đã có gì từ oh-my-pi

| Feature | oh-my-pi | pi-crew status |
|---------|----------|---------------|
| In-process execution | ✅ Core design | ✅ `live-session-runtime.ts` (đã có) |
| Yield-based completion | ✅ Mandatory | ✅ `yield-handler.ts` (mới thêm, chưa enforce) |
| SubprocessToolRegistry | ✅ Extensible | ✅ `subprocess-tool-registry.ts` (mới thêm) |
| Typed event channels | ✅ 3 channels | ✅ 5 channels (mới thêm) |
| Semaphore concurrency | ✅ Explicit | ✅ Via `mapConcurrent` |
| MCP proxy tools | ✅ Share parent MCP | ❌ Mỗi worker tự discover |
| IRC inter-agent | ✅ DM/broadcast | ❌ Chỉ mailbox |
| Human-readable names | ✅ AdjectiveNoun | ✅ `task-name-generator.ts` |
| Handlebars templates | ✅ | ❌ String concatenation |
| FUSE/ProjFS isolation | ✅ 3 backends | ❌ Chỉ worktree |

## 4. pi-crew features mà oh-my-pi KHÔNG có

| Feature | Detail |
|---------|--------|
| Process isolation | Child-process mode → fault boundary |
| Crash recovery | Manifest + event sourcing → resume sau crash |
| Adaptive planning | Planner agent quyết định fanout dynamically |
| Policy engine | Configurable rules cho effectiveness, concurrency, etc. |
| Deadletter tracking | Permanently failed task tracking |
| Event log rotation | Auto-compact over 5MB/50k events |
| Blob artifact store | SHA-256 content-addressed storage |
| Hook lifecycle | 8/9 typed hooks with blocking support |
| Incremental reader | Seek-based JSONL reading |
| Parallel dispatch action | `team action='parallel'` for multi-task fanout |

---

## 5. Nghiên cứu tiếp theo

### 5.1 Hybrid model: Best of both worlds

**Ý tưởng**: Chọn execution mode tự động per-task thay vì global config.

```
executeTeamRun()
  → resolveCrewRuntime() → check live-session available
  → for each task:
      if (lightweight, trusted agent) → live-session (in-process, fast)
      if (heavy, untrusted, risky) → child-process (isolated, safe)
```

**Implementation plan:**
1. Extend `runtime-resolver.ts` → per-task runtime selection
2. Add `agent.trustLevel` field → "trusted" (in-process) / "untrusted" (child-process)
3. Wire `live-session-runtime.ts` into `task-runner.ts` as alternative to `child-pi.ts`
4. Add fallback: if live-session crashes → retry with child-process

### 5.2 MCP proxy cho child-process mode

Hiện mỗi child process tự discover MCP connections → chậm.

**Ý tưởng**: Parent discover MCP → serialize config → pass cho child via env/args.

```
Parent:
  mcpManager = discoverMCPConnections()
  mcpConfig = mcpManager.serialize()
  child = spawn("pi", [...args, `--mcp-config=${base64(mcpConfig)}`])
```

### 5.3 Yield enforcement cho live-session

Live-session đã dùng `session.prompt()` nhưng chưa enforce yield.

**Ý tưởng**: 
1. Register `submit_result` as required tool khi tạo live-session
2. Sau `session.prompt()` + `waitForIdle()`, check yieldCalled
3. Nếu chưa yield → gửi reminder (giống oh-my-pi)

### 5.4 Semaphore thay mapConcurrent

`mapConcurrent` hiện tại là simple worker pool. `Semaphore` explicit hơn cho:
- Dynamic acquire/release
- Rate limiting across multiple scheduling points
- Priority queue (future)

### 5.5 Handlebars templates cho prompts

Hiện `prompt-builder.ts` dùng string concatenation. Template engine sẽ dễ maintain:
```
{{#if hasSkills}}
## Available Skills
{{#each skills}}
- {{name}}: {{description}}
{{/each}}
{{/if}}
```

### 5.6 IRC-style inter-agent messaging

Hiện chỉ có mailbox (task-scoped). Cần thêm:
- Broadcast: agent gửi message cho tất cả agents trong run
- DM: agent gửi cho agent cụ thể
- Pub/sub channel: subscribe theo topic

---

## 6. Decision matrix: Khi nào dùng mode nào

| Criteria | child-process | live-session (in-process) |
|----------|--------------|--------------------------|
| Production safety | ✅ Preferred | ⚠️ Chỉ khi trust agents |
| Speed critical tasks | ❌ Slow startup | ✅ Preferred |
| Many parallel workers | ⚠️ Memory heavy | ✅ Lightweight |
| Untrusted/third-party agents | ✅ Isolated | ❌ Never |
| Debugging | ⚠️ Hard (separate process) | ✅ Easy (same process) |
| Crash recovery | ✅ Manifest-based | ❌ State lost on crash |
| MCP sharing | ❌ Separate discovery | ✅ Share parent's |
| Steering mid-turn | ❌ Cancel only | ✅ Full control |

**Recommended default**: child-process (safe) với opt-in live-session cho trusted agents.

---

## 7. Key source files cho reference

### oh-my-pi (Source/oh-my-pi/packages/coding-agent/src/)
| File | Lines | Purpose |
|------|-------|---------|
| `task/executor.ts` | 1291 | In-process subagent execution |
| `task/parallel.ts` | 100 | Semaphore + mapWithConcurrencyLimit |
| `task/index.ts` | 1275 | Task tool entry point, parallel orchestration |
| `task/subprocess-tool-registry.ts` | 80 | Extensible tool event handlers |
| `task/types.ts` | 230 | Core types, event channel constants |
| `sdk.ts` | 1900 | AgentSession factory |
| `session/agent-session.ts` | 7500 | Core agent session (GOD OBJECT) |
| `tools/yield.ts` | 170 | Submit result tool with schema validation |
| `tools/irc.ts` | 250 | Inter-agent messaging |
| `config/settings-schema.ts` | 2700 | Single source of truth cho all settings |

### pi-crew (pi-crew/src/)
| File | Lines | Purpose |
|------|-------|---------|
| `runtime/child-pi.ts` | 458 | Child process execution |
| `runtime/live-session-runtime.ts` | 245 | In-process execution via Pi SDK |
| `runtime/runtime-resolver.ts` | 100 | Mode selection |
| `runtime/parallel-utils.ts` | 100 | mapConcurrent worker pool |
| `runtime/team-runner.ts` | 800 | Workflow scheduler |
| `runtime/task-runner.ts` | 430 | Per-task execution |
| `runtime/yield-handler.ts` | 100 | Yield-based completion |
| `runtime/subprocess-tool-registry.ts` | 55 | Tool event handlers |
| `ui/run-event-bus.ts` | 207 | Typed event channels |
| `extension/team-tool/parallel-dispatch.ts` | 120 | Parallel action dispatcher |
| `state/event-log-rotation.ts` | 115 | Event log compaction |
| `utils/incremental-reader.ts` | 93 | Seek-based file reading |
| `utils/task-name-generator.ts` | 224 | Human-readable task names |
