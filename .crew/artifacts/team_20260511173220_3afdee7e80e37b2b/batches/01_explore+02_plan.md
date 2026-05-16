=== Task 1: 01_explore (explorer) ===
Status: COMPLETED
Role: explorer
Result artifact: /home/bom/source/my_pi/pi-crew/.crew/artifacts/team_20260511173220_3afdee7e80e37b2b/results/01_explore.txt
Log artifact: /home/bom/source/my_pi/pi-crew/.crew/artifacts/team_20260511173220_3afdee7e80e37b2b/logs/01_explore.log
Transcript: /home/bom/source/my_pi/pi-crew/.crew/artifacts/team_20260511173220_3afdee7e80e37b2b/transcripts/01_explore.jsonl
Usage: {"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"cost":0,"turns":0}
(no output)

=== Task 2: 02_plan (planner) ===
Status: COMPLETED
Role: planner
Result artifact: /home/bom/source/my_pi/pi-crew/.crew/artifacts/team_20260511173220_3afdee7e80e37b2b/results/02_plan.txt
Log artifact: /home/bom/source/my_pi/pi-crew/.crew/artifacts/team_20260511173220_3afdee7e80e37b2b/logs/02_plan.log
Transcript: /home/bom/source/my_pi/pi-crew/.crew/artifacts/team_20260511173220_3afdee7e80e37b2b/transcripts/02_plan.jsonl
Usage: {"input":39820,"output":7043,"cacheRead":198080,"cacheWrite":0,"cost":0,"turns":0}
Now I have all the information needed. Let me produce the implementation plan.

---

# Implementation Plan: pi-smart Extension

## Summary

Implement the pi-smart Pi extension — an output filtering, compression, analyze tool, and cost tracking system — fully per `SPEC.md`. The extension will be created at `/home/bom/source/my_pi/pi-smart/` following the pi-crew pattern (`index.ts` → `src/extension/register.ts`).

---

## Key Findings from Discovery

### Patterns to Follow (from pi-crew)

| Pattern | pi-crew Reference | pi-smart Equivalent |
|---|---|---|
| Extension entry | `index.ts` → `registerPiTeams(pi)` | `index.ts` → `registerPiSmart(pi)` |
| Main registration | `src/extension/register.ts` (~700 lines) | `src/extension/register.ts` (session lifecycle, hooks) |
| Tool registration | `registerTeamTool(pi, deps)` using `ToolDefinition` | `registerAnalyzeTool(pi, deps)`, `registerSmartConfigTool(pi)` |
| Command registration | `registerTeamCommands(pi, deps)` | `registerSmartCommands(pi, deps)` |
| Event hooks | `pi.on("session_start", ...)`, `pi.on("tool_call", ...)` | `pi.on("session_start", ...)`, `pi.on("before_agent_start", ...)`, etc. |
| Context usage | `ctx.getContextUsage()?.tokens`, `ctx.compact()` | Budget state machine |
| Config loading | `loadConfig(cwd)` from `src/config/config.ts` | `loadSmartConfig(cwd)` from `src/config.ts` |
| Package structure | ESM (`"type": "module"`), peer deps on `@mariozechner/pi-*` | Same |
| Tests | `node --experimental-strip-types --test test/unit/*.test.ts` | Same |

### Pi Extension API Events Available

Based on pi-crew usage, these Pi events are confirmed available:
- ✅ `session_start` — reset counters, load config, register widget
- ✅ `session_shutdown` — cleanup
- ✅ `before_agent_start` — inject steering notes based on budget state
- ✅ `turn_end` — check context usage for budget state machine
- ✅ `session_before_compact` — guard critical context during compaction
- ✅ `tool_call` — permission gate (used by pi-crew for destructive action blocking)
- ✅ `resources_discover` — inject skill paths
- ⚠️ `tool_result` — SPEC requires this; **needs verification** if Pi exposes it as an extension hook. If not available, alternative: intercept at `tool_call` level or use Pi's event bus.
- ⚠️ `message_end` — SPEC requires extracting `usage` from `AssistantMessage`; **needs verification** if this event is exposed to extensions.
- ⚠️ `turn_start` — SPEC requires budget check at turn start; `turn_end` is confirmed, `turn_start` may or may not exist.
- ⚠️ `context` — SPEC wants steering message injection before provider requests; **needs verification** if this event exists.
- ⚠️ `after_provider_response` — SPEC mentions this; **needs verification**.

**Risk mitigation**: If an event is unavailable, degrade gracefully. For `tool_result`, consider registering the `analyze` tool as a proper `ToolDefinition` (which works) and focus filtering on what's observable. For cost tracking, `message_end` usage data may be available through `turn_end` context or `ctx.getContextUsage()`.

### ExtensionContext API

Confirmed from pi-crew usage:
- `ctx.cwd` — project root
- `ctx.getContextUsage()` → `{ tokens: *** | null } | undefined`
- `ctx.compact({ customInstructions, onComplete, onError })`
- `ctx.ui.notify(msg, level)`, `ctx.ui.setWidget()`
- `ctx.hasUI`
- `ctx.model?.contextWindow` — context window size

---

## File Structure (42 files total)

```
pi-smart/
├── index.ts                              # Extension entry
├── package.json                          # Package config
├── tsconfig.json                         # TypeScript config
├── AGENTS.md                             # Dev guidance
├── src/
│   ├── extension/
│   │   ├── register.ts                   # Main registration + hooks
│   │   ├── register-analyze-tool.ts      # Analyze tool registration
│   │   ├── register-smart-config-tool.ts # smart_config tool registration
│   │   └── register-commands.ts          # /smart command registration
│   ├── filter/
│   │   ├── pipeline.ts                   # Filter chain orchestrator
│   │   ├── config.ts                     # Per-command filter profiles
│   │   └── filters/
│   │       ├── strip-ansi.ts
│   │       ├── collapse-blanks.ts
│   │       ├── head-tail.ts
│   │       ├── dedup-lines.ts
│   │       ├── strip-timestamps.ts
│   │       ├── shorten-paths.ts
│   │       ├── strip-npm-progress.ts
│   │       ├── strip-git-diff-stats.ts
│   │       ├── compact-json.ts
│   │       ├── strip-test-runner-header.ts
│   │       ├── collapse-stack-traces.ts
│   │       └── custom-regex.ts
│   ├── compress/
│   │   ├── caveman.ts                    # Semantic compression engine
│   │   └── intensity.ts                  # terse/normal/verbose levels
│   ├── analyze/
│   │   ├── sandbox.ts                    # Secure execution sandbox
│   │   └── languages.ts                  # Polyglot temp file / exec config
│   ├── budget/
│   │   ├── tracker.ts                    # Context window monitoring
│   │   ├── state-machine.ts              # NORMAL/FRUGAL/COMPACT/EMERGENCY
│   │   └── pinning.ts                    # Critical context protection
│   ├── cost/
│   │   ├── tracker.ts                    # Token usage aggregation
│   │   ├── pricing.ts                    # Model pricing database
│   │   └── widget.ts                     # Cost dashboard widget
│   └── config.ts                         # Extension config loader
├── test/
│   └── unit/
│       ├── filter-pipeline.test.ts
│       ├── strip-ansi.test.ts
│       ├── collapse-blanks.test.ts
│       ├── head-tail.test.ts
│       ├── dedup-lines.test.ts
│       ├── strip-timestamps.test.ts
│       ├── shorten-paths.test.ts
│       ├── strip-npm-progress.test.ts
│       ├── strip-git-diff-stats.test.ts
│       ├── compact-json.test.ts
│       ├── strip-test-runner-header.test.ts
│       ├── collapse-stack-traces.test.ts
│       ├── custom-regex.test.ts
│       ├── filter-config.test.ts
│       ├── caveman.test.ts
│       ├── intensity.test.ts
│       ├── sandbox.test.ts
│       ├── budget-state-machine.test.ts
│       ├── budget-tracker.test.ts
│       ├── pinning.test.ts
│       ├── cost-tracker.test.ts
│       ├── pricing.test.ts
│       ├── cost-widget.test.ts
│       └── config.test.ts
└── skills/
    └── analyze-first/
        └── skill.md                      # Skill injection for analyze usage
```

---

## Implementation Phases (Ordered)

### Phase 0: Scaffold (3 files) — No dependencies

| Step | File(s) | Description |
|---|---|---|
| 0.1 | `package.json` | ESM package with peer deps on `@mariozechner/pi-coding-agent`, `@mariozechner/pi-agent-core`, etc. Scripts: `test`, `typecheck`. `"pi": { "extensions": ["./index.ts"] }` |
| 0.2 | `tsconfig.json` | Copy from pi-crew: `ES2022`, `NodeNext`, strict, `noEmit`, `allowImportingTsExtensions` |
| 0.3 | `index.ts` | Minimal: `import { registerPiSmart } from "./src/extension/register.ts"; export default function(pi) { registerPiSmart(pi); }` |
| 0.4 | `AGENTS.md` | Dev notes for pi-smart |

**Validation**: `npx tsc --noEmit` passes.

---

### Phase 1: Config + Filter Pipeline (8 files) — Foundation layer

**Dependencies**: Phase 0

| Step | File | Description | Key Details |
|---|---|---|---|
| 1.1 | `src/config.ts` | Config loader | Read `.pi/pi-smart.json`, merge with defaults, validate schema. Return typed `PiSmartConfig` interface. |
| 1.2 | `src/filter/pipeline.ts` | Filter pipeline orchestrator | `applyPipeline(text, filters[]): string`. Safe: skip on error, log, pass through. Track `bytesIn`, `bytesOut`, `reductionPct`. |
| 1.3 | `src/filter/config.ts` | Per-command filter profiles | `resolveProfile(toolName, command): FilterSpec[]`. Match `bash: npm test` > `bash: *` > `defaultProfile`. Parse filter args like `head-tail:30`. |
| 1.4 | `src/filter/filters/strip-ansi.ts` | ANSI filter | Regex: `\x1b\[[0-9;]*[a-zA-Z]` |
| 1.5 | `src/filter/filters/collapse-blanks.ts` | Blank line collapse | Replace 2+ blank lines → 1 |
| 1.6 | `src/filter/filters/head-tail.ts` | Head/tail truncation | Configurable N lines. Insert `[... N lines truncated ...]` |
| 1.7 | `src/filter/filters/dedup-lines.ts` | Consecutive dedu
[pi-crew compacted 12999 chars]