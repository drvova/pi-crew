=== Task 1: 01_explore (explorer) ===
Status: COMPLETED
Role: explorer
Result artifact: /home/bom/source/my_pi/pi-crew/.crew/artifacts/team_20260512060529_346fcffadce322e2/results/01_explore.txt
Log artifact: /home/bom/source/my_pi/pi-crew/.crew/artifacts/team_20260512060529_346fcffadce322e2/logs/01_explore.log
Transcript: /home/bom/source/my_pi/pi-crew/.crew/artifacts/team_20260512060529_346fcffadce322e2/transcripts/01_explore.jsonl
Usage: {"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"cost":0,"turns":0}
(no output)

=== Task 2: 02_code-review (reviewer) ===
Status: COMPLETED
Role: reviewer
Result artifact: /home/bom/source/my_pi/pi-crew/.crew/artifacts/team_20260512060529_346fcffadce322e2/results/02_code-review.txt
Log artifact: /home/bom/source/my_pi/pi-crew/.crew/artifacts/team_20260512060529_346fcffadce322e2/logs/02_code-review.log
Transcript: /home/bom/source/my_pi/pi-crew/.crew/artifacts/team_20260512060529_346fcffadce322e2/transcripts/02_code-review.jsonl
Usage: {"input":96634,"output":10077,"cacheRead":1491456,"cacheWrite":0,"cost":0,"turns":0}
Here is the complete code review of all 9 Pi extensions.

---

## Code Review Report — 9 Pi Extensions

**Scope:** `/home/bom/source/my_pi/docs/extensions/SPEC.md` + all extension source code
**Test Results:** All 9 extensions pass `npm test` (847 tests total, 0 failures)

---

### Summary Table

| Extension | Severity | Files Read | Tests | Test Status |
|---|---|---|---|---|
| pi-smart | Medium | 30+ | 105 | ✅ pass |
| pi-memory | Medium | 30+ | 79 | ✅ pass |
| pi-pipeline | High | 40+ | 178 | ✅ pass |
| pi-lsp | Medium | 25+ | 42 | ✅ pass |
| pi-review | High | 25+ | 93 | ✅ pass |
| pi-visual | Low | 25+ | 114 | ✅ pass |
| pi-web-research | Low | 25+ | 82 | ✅ pass |
| pi-ci | Medium | 15+ | 81 | ✅ pass |
| pi-debug | Low | 20+ | 73 | ✅ pass |

---

### [HIGH] Issues

#### 1. `pi-review` — No-Op Static Analysis
**File:** `src/review/orchestrator.ts:226–228`
```typescript
private evaluateChecklistItem(...): ReviewFinding | null {
  // This is a static analysis placeholder. In a real implementation,
  // the Pi agent would use the checklist item + context to produce findings.
  return null;
}
```
**Impact:** Every checklist item from every perspective returns `null`, producing an empty `findings` array regardless of diff content. The SPEC promises multi-perspective review (security, performance, maintainability). The implementation is a stub that defers all actual analysis to the agent via prompt context — but the tool still calls `evaluateChecklistItem()` and silently drops results. This means `review_diff` and `review_file` tools always return zero findings.
**Fix:** Either (a) implement actual static analysis per checklist item (e.g., regex-based security patterns, complexity heuristics), or (b) change the flow so the `review_diff` tool itself is an agent prompt with the checklist context rather than returning findings directly.
**Verification:** `src/review/orchestrator.ts` line 226; confirmed `findings` always empty from orchestrator flow.

#### 2. `pi-pipeline` — Verification Gates Always Pass (Stub Implementations)
**File:** `src/verify/gates.ts:30–95`
```typescript
export function checkTestsGate(ctx: TaskContext): GateResult {
  if (!ctx.testCommand) {
    return { gateId: "tests", passed: true, evidence: "No test command", ... };
  }
  return { gateId: "tests", passed: true, evidence: `Ran: ${ctx.testCommand}`, message: "All tests pass" }; // ← always passes!
}
```
**Impact:** All 6 verification gates (`tests`, `typecheck`, `lint`, `regression`, `evidence`, `tdd`) return `passed: true` unconditionally. The SPEC defines gates as blocking checkpoints that actually run commands. In practice, `pipeline_verify` tool and `/verify` command always report all gates passing. The `evidence` gate does check the output text, but only for presence of keywords — not for actual proof.
**Fix:** Actually `exec()` the test/typecheck/lint commands and check exit codes. Integrate with pi-lsp for `typecheck`. Use the SPEC's IDENTIFY→RUN→READ→VERIFY pattern.
**Verification:** All 6 gate functions (`checkTestsGate`, `checkTypecheckGate`, `checkLintGate`, `checkRegressionGate`, `checkEvidenceGate`, `checkTddGate`) at `src/verify/gates.ts:25–95`.

#### 3. `pi-pipeline` — `context` Hook Bypasses Type Safety
**File:** `src/extension/register.ts:78`
```typescript
(pi as any).on("context", contextHook as any);
```
**Impact:** The `context` event handler is cast to `any` to bypass TypeScript's complex `AgentMessage` type. This pattern hides potential type errors and makes it impossible to verify the hook signature matches Pi's API. Since `contextHook` returns `{ messages?: Array<Record<string, unknown>> }`, the cast obscures whether the returned type is actually compatible with `ContextEventResult`.
**Fix:** Define a typed wrapper or use a documented escape hatch. Consider whether Pi's type definitions can be relaxed.
**Verification:** `src/extension/register.ts:78`.

---

### [MEDIUM] Issues

#### 4. `pi-smart` — `turn_end` Budget Check Works, But `message_end` Compression Missing
**File:** `src/extension/register.ts` (register.ts lacks `message_end` hook entirely)
**SPEC requirement:** `message_end` → Response Compression (caveman/terse/normal/verbose). The SPEC defines this hook as a core feature.
**Impact:** Assistant response compression (`cavemanCompress` / `lightCompress` in `src/compress/caveman.ts`) is implemented but never called — there's no `message_end` handler in the register function. Only `tool_result` filtering and `before_agent_start` steering are wired.
**Fix:** Add the `message_end` hook:
```typescript
pi.on("message_end", (event) => {
  const msg = event.message as AssistantMessage;
  if (msg.role !== "assistant") return;
  const compressed = compressByIntensity(msg.content.toString(), state.intensity);
  if (compressed.reductionPct > 0) return { message: { ...msg, content: compressed.text } };
});
```
**Verification:** `src/extension/register.ts` — no `message_end` handler; `src/compress/caveman.ts` exists with working implementation.

#### 5. `pi-memory` — Critical Hooks Not Registered
**File:** `src/extension/register.ts`
**SPEC requirement:** `session_compact` → compaction-aware recall; `turn_end` → track errors & results; `message_start` → track decisions.
**Impact:** None of these hooks are registered. The `session_compact` hook is referenced in SPEC as "compaction-aware recall" — when Pi compacts context, pi-memory should inject relevant memories. Currently the compaction flow (`src/continuity/compaction-hook.ts`) exists but is never invoked because no hook registers it. Similarly, decision tracking via `message_start` and error tracking via `turn_end` are not wired.
**Fix:** Register the hooks in `registerPiMemory()`:
```typescript
pi.on("session_compact", (event, ctx) => { ... });
pi.on("turn_end", (event, ctx) => { ... });
pi.on("message_start", (event, ctx) => { ... });
```
**Verification:** `src/extension/register.ts` — confirmed only `session_start`, `session_shutdown`, `tool_call`, `resources_discover` hooks.

#### 6. `pi-smart` — Missing `after_provider_response` Hook
**File:** `src/extension/register.ts`
**SPEC requirement:** `after_provider_response` → Cost Tracking (initial token extraction).
**Impact:** The SPEC notes that `after_provider_response` provides status/headers for debugging. Actual token usage is extracted from `message_end` (which is also missing — see #4). The `cost/tracker.ts` exists with full implementation but the data source is disconnected.
**Fix:** See fix for #4 — once `message_end` is registered, tokens can be extracted from `event.message.usage`.
**Verification:** `src/extension/register.ts` — no `after_provider_response` handler.

#### 7. `pi-ci` — Headless Orchestrator Is Standalone, Not Integrated with Pi Core
**File:** `index.ts:30–65`
**SPEC requirement:** This extension requires Pi core changes (`--mode ci` flag, structured exit codes, answer injection at CLI level, JSONL streaming).
**Impact:** The `HeadlessOrchestrator` and related classes (`EXIT_CODES`, `IdleDetector`, `CIEventCollector`) are fully implemented and well-structured, but the extension only registers a `/ci status` command. The actual headless mode (exit codes, JSONL events, `--mode ci`) requires Pi core modifications that are outside the extension's scope. This is documented in the SPEC but creates a gap: `pi-ci` provides CI-building blocks but cannot run headless without core changes.
**Fix:** This is by design per the SPEC, but the SPEC should clarify that `pi-ci` alone won't enable headless mode — it requires a PI core PR first. The extension is usable for the `/ci status` command and the CI pipeline tooling.
**Verification:** `index.ts` registers only `ci` command; no `session_start`/`session_shutdown` hooks.

#### 8. `pi-pipeline` — No `tool_call` Verification Gate (Blocks Tools)
**File:** `src/extension/register.ts` — no `tool_call` hook registered
**SPEC requirement:** `tool_call` → verification gates (can block tool execution with `{ block: true, reason: "..." }`).
**Impact:** The SPEC defines blocking tool execution as a key pipeline feature (e.g., block `bash` if tests are red). `ToolCallEventResult` type suppor
[pi-crew compacted 8679 chars]