=== Task 1: 01_explore (explorer) ===
Status: COMPLETED
Role: explorer
Result artifact: /home/bom/source/my_pi/pi-crew/.crew/artifacts/team_20260512051657_634dc0758d279549/results/01_explore.txt
Log artifact: /home/bom/source/my_pi/pi-crew/.crew/artifacts/team_20260512051657_634dc0758d279549/logs/01_explore.log
Transcript: /home/bom/source/my_pi/pi-crew/.crew/artifacts/team_20260512051657_634dc0758d279549/transcripts/01_explore.jsonl
Usage: {"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"cost":0,"turns":0}
(no output)

=== Task 2: 02_plan (planner) ===
Status: COMPLETED
Role: planner
Result artifact: /home/bom/source/my_pi/pi-crew/.crew/artifacts/team_20260512051657_634dc0758d279549/results/02_plan.txt
Log artifact: /home/bom/source/my_pi/pi-crew/.crew/artifacts/team_20260512051657_634dc0758d279549/logs/02_plan.log
Transcript: /home/bom/source/my_pi/pi-crew/.crew/artifacts/team_20260512051657_634dc0758d279549/transcripts/02_plan.jsonl
Usage: {"input":31133,"output":3765,"cacheRead":143680,"cacheWrite":0,"cost":0,"turns":0}
Now I have a thorough understanding of the spec and the pi-crew patterns. Let me produce the plan.

---

# Implementation Plan: pi-ci Extension

## Summary

Create `/home/bom/source/my_pi/pi-ci/` as a standalone Pi extension implementing headless CI mode with structured exit codes, answer injection, idle timeout detection, JSONL event streaming, CI pipeline automation (PR creation, test result parsing), and a `/ci status` command. Include comprehensive unit tests.

---

## File Layout

```
pi-ci/
├── index.ts                          # Extension entry point (default export)
├── package.json                      # npm manifest, peerDeps on pi packages
├── tsconfig.json                     # Same ES2022/NodeNext config as pi-crew
├── AGENTS.md                         # Dev notes
├── test/
│   └── unit/
│       ├── exit-codes.test.ts
│       ├── answer-injector.test.ts
│       ├── idle-detector.test.ts
│       ├── jsonl-stream.test.ts
│       ├── orchestrator.test.ts
│       ├── pipeline.test.ts
│       ├── pr-creator.test.ts
│       ├── test-runner.test.ts
│       ├── report.test.ts
│       └── ci-status.test.ts
└── src/
    ├── config.ts                     # PiCiConfig type, load/merge/validate
    ├── types.ts                      # Shared types: CIEvent union, exit codes, answer schema
    ├── headless/
    │   ├── exit-codes.ts             # EXIT_CODES constant + resolveExitCode()
    │   ├── answer-injector.ts        # AnswerFile type, loadAnswers(), matchAnswer()
    │   ├── idle-detector.ts          # IdleDetector class (timer-based, configurable timeout)
    │   ├── orchestrator.ts           # HeadlessOrchestrator — ties exit codes, idle, answers, JSONL
    │   └── jsonl-stream.ts           # writeCIEvent(), CIEventEmitter, event type guards
    ├── ci/
    │   ├── pipeline.ts               # CIPipeline — single/plan/review modes, auto-restart
    │   ├── pr-creator.ts             # createPR() — gh CLI wrapper with error handling
    │   ├── test-runner.ts            # parseTestResults() — tap/jest/vitest output parsing
    │   └── report.ts                 # generateReport() — JSONL/summary generation
    └── tools/
        └── ci_status.ts              # /ci status command handler
```

---

## Implementation Order (Sequenced Steps)

### Step 1: Foundation — Types & Exit Codes
**Files:** `src/types.ts`, `src/headless/exit-codes.ts`, `test/unit/exit-codes.test.ts`
**Dependencies:** None (pure data types)

Create:
- `EXIT_CODES` const: `{ SUCCESS: 0, ERROR: 1, TIMEOUT: 1, BLOCKED: 10, CANCELLED: 11, NEEDS_INPUT: 12 }`
- `CIEvent` discriminated union type (ci_start, ci_progress, ci_edit, ci_test, ci_cost, ci_end)
- `ExitCode` type alias
- `resolveExitCode(status: string): ExitCode` helper
- `AnswerFile` and `AnswerEntry` types

**Tests:**
- EXIT_CODES values are correct
- resolveExitCode maps known statuses correctly
- resolveExitCode defaults to ERROR for unknown statuses

### Step 2: Answer Injector
**Files:** `src/headless/answer-injector.ts`, `test/unit/answer-injector.test.ts`
**Dependencies:** Step 1 (types)

Create:
- `loadAnswers(filePath: string): AnswerEntry[]` — reads JSON, validates schema
- `matchAnswer(entries: AnswerEntry[], prompt: string): string | undefined` — substring matching
- Input validation: reject non-array, entries without match/answer fields

**Tests:**
- Valid answer file loads correctly
- Missing file returns empty array (or throws explicitly)
- matchAnswer finds by substring
- matchAnswer returns undefined when no match
- Invalid JSON throws
- Entries missing required fields are skipped with warning

### Step 3: Idle Detector
**Files:** `src/headless/idle-detector.ts`, `test/unit/idle-detector.test.ts`
**Dependencies:** Step 1 (types)

Create:
- `IdleDetector` class with `reset()`, `start()`, `stop()`, `onTimeout` callback
- Configurable `idleTimeoutMs` (default 15000)
- Timer-based: if no `reset()` call within timeout, fires callback
- Handles edge cases: double-start, stop without start, reset after timeout

**Tests:**
- Timeout fires after configured duration
- reset() prevents timeout
- stop() cancels timer
- Double start is safe
- Default timeout is 15000ms

### Step 4: JSONL Event Stream
**Files:** `src/headless/jsonl-stream.ts`, `test/unit/jsonl-stream.test.ts`
**Dependencies:** Step 1 (types)

Create:
- `CIEventEmitter` class with `emit(event: CIEvent): void`
- `writeCIEvent(stream: Writable, event: CIEvent): void` — serializes to JSONL
- Event type guards: `isCIStartEvent()`, `isCIEndEvent()`, etc.
- Timestamp auto-injection if missing

**Tests:**
- Events serialize to single-line JSON
- Type guards discriminate correctly
- Missing timestamps auto-filled
- Invalid events rejected

### Step 5: Config
**Files:** `src/config.ts`
**Dependencies:** Step 1 (types)

Create:
- `PiCiConfig` interface matching spec §6
- `loadCiConfig(cwd?: string): PiCiConfig` — reads `.pi/pi-ci.json`, merges defaults
- Defaults: `{ enabled: true, idleTimeoutMs: 15000, maxRetries: 3, retryBackoffMaxMs: 30000, ... }`

### Step 6: Headless Orchestrator
**Files:** `src/headless/orchestrator.ts`, `test/unit/orchestrator.test.ts`
**Dependencies:** Steps 1–5

Create:
- `HeadlessOrchestrator` class tying together: exit codes, answer injection, idle detection, JSONL streaming
- `run(prompt: string, options: CIOptions): Promise<ExitCode>` — main execution loop
- Emits ci_start → ci_progress → ci_end events
- Auto-restart with exponential backoff on error/timeout
- Session resume support via `--resume` pattern

**Tests:**
- Successful run emits start + end events, returns 0
- Timeout triggers exit code 1
- Blocked state returns exit code 10
- Auto-restart retries on error, gives up after maxRetries
- Answer injection works in orchestrated flow

### Step 7: CI Pipeline Wrapper
**Files:** `src/ci/pipeline.ts`, `test/unit/pipeline.test.ts`
**Dependencies:** Step 6

Create:
- `CIPipeline` class with modes: single, plan, review, supervised
- `execute(mode, options)` — dispatches to correct mode
- Plan execution: reads plan.json, steps through items
- PR review mode: fetches diff, feeds to orchestrator
- Supervised mode: stdin/stdout forwarding for external orchestrator

**Tests:**
- Single task mode returns correct exit code
- Plan mode executes steps in order
- Invalid mode throws

### Step 8: PR Creator
**Files:** `src/ci/pr-creator.ts`, `test/unit/pr-creator.test.ts`
**Dependencies:** None (utility module, can be built in parallel with Steps 5–7)

Create:
- `createPR(options: PROptions): Promise<PRResult>` — wraps `gh pr create`
- `detectBaseBranch(): string` — detect default branch
- Error handling: gh not installed, auth failure, push failure

**Tests:**
- Constructs correct gh command
- Handles missing gh CLI
- Parses PR URL from output

### Step 9: Test Runner (Result Parsing)
**Files:** `src/ci/test-runner.ts`, `test/unit/test-runner.test.ts`
**Dependencies:** Step 1 (types)

Create:
- `parseTestResults(output: string, format: 'tap' | 'jest' | 'vitest'): TestSummary`
- `TestSummary` type: `{ passed: number, failed: number, total: number, duration_ms: number }`
- Emits `ci_test` events

**Tests:**
- Parses TAP output correctly
- Parses jest-style output
- Parses vitest-style output
- Handles empty/malformed output

### Step 10: Report Generation
**Files:** `src/ci/report.ts`, `test/unit/report.test.ts`
**Dependencies:** Steps 1, 4

Create:
- `generateReport(events: CIEvent[], options?: ReportOptions): string`
- JSONL report mode (default)
- Summary mode (human-readable)
- Cost aggregation from ci_cost events

**Tests:**
- JSONL report contains all events in order
- Summary report includes pass/fail counts
- Cost aggregation sums correctly

### Step 11: CI Status Tool + Extension Registration
**Files:** `src/tools/ci_status.ts`, `index.ts`
**Dependencies:** Steps 5–7

Create:
- `/ci status` command handler — shows current/last CI run status
- `index.ts` — extension entry point, registers command on `session_start`
- Pattern: `export default function(pi: ExtensionAPI): void { ... }`

**Tests:** (in `test/unit/ci-status.test.ts`)
- Returns status for known run ID
- Returns "no runs found" when no runs exist

---

## Parallelizati
[pi-crew compacted 4199 chars]