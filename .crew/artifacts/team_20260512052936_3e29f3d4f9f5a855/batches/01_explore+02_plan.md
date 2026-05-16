=== Task 1: 01_explore (explorer) ===
Status: COMPLETED
Role: explorer
Result artifact: /home/bom/source/my_pi/pi-crew/.crew/artifacts/team_20260512052936_3e29f3d4f9f5a855/results/01_explore.txt
Log artifact: /home/bom/source/my_pi/pi-crew/.crew/artifacts/team_20260512052936_3e29f3d4f9f5a855/logs/01_explore.log
Transcript: /home/bom/source/my_pi/pi-crew/.crew/artifacts/team_20260512052936_3e29f3d4f9f5a855/transcripts/01_explore.jsonl
Usage: {"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"cost":0,"turns":0}
(no output)

=== Task 2: 02_plan (planner) ===
Status: COMPLETED
Role: planner
Result artifact: /home/bom/source/my_pi/pi-crew/.crew/artifacts/team_20260512052936_3e29f3d4f9f5a855/results/02_plan.txt
Log artifact: /home/bom/source/my_pi/pi-crew/.crew/artifacts/team_20260512052936_3e29f3d4f9f5a855/logs/02_plan.log
Transcript: /home/bom/source/my_pi/pi-crew/.crew/artifacts/team_20260512052936_3e29f3d4f9f5a855/transcripts/02_plan.jsonl
Usage: {"input":28949,"output":4818,"cacheRead":347904,"cacheWrite":0,"cost":0,"turns":0}
I now have enough context to create the implementation plan. Let me write it up.

---

# Implementation Plan: pi-debug Extension

## Summary

Build a standalone Pi extension (`pi-debug`) that provides a DAP (Debug Adapter Protocol) client with 7 registered tools, debug adapter registry, session management, and auto-suggest on runtime errors. The architecture follows the `pi-lsp` extension pattern closely.

## Architecture Overview

```
pi-debug/
├── index.ts                          # Extension entry point
├── package.json
├── tsconfig.json
├── README.md
├── src/
│   ├── extension/
│   │   ├── register.ts               # Main registration: session_start, session_shutdown, tool_result hook
│   │   └── tool-registry.ts          # Register all 7 debug tools via pi.registerTool()
│   ├── client/
│   │   ├── connection.ts             # DAP transport: stdio (Content-Length header) + TCP socket
│   │   ├── session.ts                # Single debug session: initialize, launch/attach, events, teardown
│   │   └── manager.ts                # Debug session pool (max 1 active, multiple stopped)
│   ├── features/
│   │   ├── breakpoints.ts            # setBreakpoints, setFunctionBreakpoints, conditional + hitCount
│   │   ├── stacktrace.ts             # stackTrace request → formatted frames
│   │   ├── variables.ts              # variables request for scopes (locals, globals)
│   │   ├── stepping.ts               # continue, next, stepIn, stepOut
│   │   └── evaluate.ts              # evaluate request in stopped context
│   ├── adapters/
│   │   ├── registry.ts               # DEFAULT_ADAPTERS + detectAdapter(file) + custom config
│   │   ├── node-debug.ts             # js-debug adapter specifics
│   │   └── python-debug.ts           # debugpy adapter specifics
│   ├── types.ts                      # DAP protocol types, config types, JSON-RPC types
│   └── config.ts                     # Load .pi/pi-debug.json with defaults
└── test/
    └── unit/
        ├── connection.test.ts        # Connection framing, parse, kill
        ├── session.test.ts           # Session lifecycle (mocked connection)
        ├── manager.test.ts           # Session pool
        ├── breakpoints.test.ts       # Breakpoint set/remove logic
        ├── stacktrace.test.ts        # Stack trace formatting
        ├── variables.test.ts         # Variable scope parsing
        ├── stepping.test.ts          # Step action mapping
        ├── evaluate.test.ts          # Evaluation context
        ├── registry.test.ts          # Adapter detection by file extension
        ├── config.test.ts            # Config loading defaults
        └── auto-suggest.test.ts      # tool_result hook logic
```

## Dependencies & Rationale

| Dependency | Purpose |
|---|---|
| `typebox` | JSON schema for tool parameters (same as pi-lsp) |
| `@mariozechner/pi-coding-agent` (peer) | ExtensionAPI, ToolDefinition, event types |
| `node:child_process` | Spawn debug adapter processes |
| `node:net` | TCP transport for adapters that require it |

No SUL-licensed sources copied. The DAP client is implemented from the [DAP specification](https://microsoft.github.io/debug-adapter-protocol/) (MIT-licensed spec).

## Ordered Implementation Steps

### Step 1: Scaffold project structure & types
**Files:** `package.json`, `tsconfig.json`, `index.ts`, `src/types.ts`

- Create `package.json` following pi-lsp pattern (name: `pi-debug`, pi extension manifest, typebox dep)
- `tsconfig.json` identical to pi-lsp
- `index.ts` — minimal entry: `export default function(pi) { registerPiDebug(pi); }`
- `src/types.ts` — DAP protocol types:
  - `DapRequest`, `DapResponse`, `DapEvent` (seq-based, NOT id-based like JSON-RPC)
  - `DapCapabilities`, `DapThread`, `DapStackFrame`, `DapScope`, `DapVariable`, `DapBreakpoint`
  - `DebugSessionState` enum: `stopped`, `initializing`, `running`, `paused`, `shutting_down`
  - `DebugAdapterConfig` (language, command, extensions, detectionFiles, transport)
  - `DebugExtensionConfig` (enabled, autoSuggest, defaultAdapter, stopOnEntry, etc.)
  - **Key DAP difference from LSP**: Messages use `seq` (auto-incrementing integer), not `id`. Request→Response correlate via `request_seq`. DAP also has `event` message type with `event` field instead of `method`.

**Validation:** `tsc --noEmit` passes.

### Step 2: Config module
**Files:** `src/config.ts`

- Load `.pi/pi-debug.json` with defaults from SPEC §7
- Validate `adapters` sub-config
- Return typed `DebugExtensionConfig`

**Validation:** Unit test for config loading with defaults and overrides.

### Step 3: DAP transport layer (connection)
**Files:** `src/client/connection.ts`

- **Transport modes:**
  - **stdio** (default): Spawn child process, use Content-Length header framing (identical to LSP). Parse messages via buffer.
  - **TCP**: Connect to host:port, same framing but over socket.
- **Message format**: DAP uses `seq`, `type: "request"|"response"|"event"`, not JSON-RPC `id`/`method`.
- **Key methods**: `sendRequest(command, args) → Promise<DapResponse>`, `sendEvent(handler)`, `kill()`
- **Event handling**: DAP events like `stopped`, `continued`, `terminated`, `output`, `breakpoint` must be dispatched to registered handlers.
- **Difference from LSP connection**: DAP uses `command` field (not `method`), responses use `request_seq` (not `id`), and events use `event` field (not `method`). Body is the `body` field.

**Validation:** Unit tests for message framing, parse, pending request resolution, kill cleanup.

### Step 4: Debug adapter registry
**Files:** `src/adapters/registry.ts`, `src/adapters/node-debug.ts`, `src/adapters/python-debug.ts`

- `DEFAULT_ADAPTERS` array from SPEC §4
- `detectAdapter(filePath, cwd)` — match by file extension, then detection files
- `getAdapter(language)` — lookup by language name
- Node adapter: `["node", "--inspect-brk"]` for JS, with `--loader ts-node/esm` for TS
- Python adapter: `["python", "-m", "debugpy", "--listen", "0.0.0.0:0"]` (TCP mode for debugpy)
- Custom adapter support from config

**Validation:** Unit tests for extension→adapter mapping, detection file logic.

### Step 5: Session management
**Files:** `src/client/session.ts`, `src/client/manager.ts`

**Session (`session.ts`):**
- Wraps a `Connection` + a single DAP debug session
- Lifecycle: `initialize()` → `launch(program, args, stopOnEntry)` → event loop → `disconnect()`
- Emits session state changes: `paused`, `running`, `terminated`
- Manages thread ID tracking (DAP requires thread ID for stepping/stack)
- Handles DAP `stopped` events (reason: breakpoint, step, exception, entry)
- Handles `terminated` event

**Manager (`manager.ts`):**
- At most one active debug session (matching DAP's model of a focused debug target)
- `startSession(program, adapter)` → creates Session, initializes adapter, returns session
- `getActiveSession()` → current session
- `stopSession()` → disconnect and cleanup
- Session timeout / idle cleanup

**Validation:** Unit tests with mocked Connection for lifecycle transitions.

### Step 6: Feature modules
**Files:** `src/features/breakpoints.ts`, `stepping.ts`, `stacktrace.ts`, `variables.ts`, `evaluate.ts`

Each feature module takes a `Session` and provides high-level functions:

| Module | DAP Requests | Output |
|---|---|---|
| `breakpoints.ts` | `setBreakpoints`, `setFunctionBreakpoints` | Breakpoint IDs, verified status |
| `stepping.ts` | `continue`, `next`, `stepIn`, `stepOut` | Confirmation |
| `stacktrace.ts` | `stackTrace` | Formatted `Array<{file, line, function, args}>` |
| `variables.ts` | `scopes` → `variables` | `Array<{name, value, type}>` for given scope |
| `evaluate.ts` | `evaluate` | Expression result string |

**Key DAP flows:**
- Set breakpoints: `setBreakpoints({source, breakpoints})` before launch
- On `stopped` event: get threadId → `stackTrace({threadId})` → `scopes({frameId})` → `variables({variablesReference})`
- Step: `continue/next/stepIn/stepOut({threadId})`
- Evaluate: `evaluate({expression, frameId, context})`

**Validation:** Unit tests per module with mocked session/connection.

### Step 7: Tool registration
**Files:** `src/extension/tool-registry.ts`

Register 7 tools via `pi.registerTool(
[pi-crew compacted 7600 chars]