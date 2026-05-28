# pi-mono Review: Full May 2026 Analysis

**Date:** 2026-05-28  
**Reviewed range:** `2026-05-01..2026-05-28` — **398 total commits**, 240+ in relevant packages  
**Packages reviewed:** `packages/agent/`, `packages/coding-agent/`, `packages/ai/`, `packages/tui/`, `packages/oh-my-pi/`

---

## Executive Summary

**No breaking changes found.** May 2026 was dominated by:
1. **Ongoing `AgentHarness` refactor** — massive architectural work (35+ harness commits)
2. **UX refinements** — terminal rendering, word boundaries, compact reads
3. **New AI providers** — Together AI, Xiaomi MiMo
4. **New features** — image models, Codex websocket transport, session ID naming
5. **Bug fixes** — 30+ fixes in relevant packages

pi-crew v0.5.2 remains **fully compatible**. All dependencies are stable.

---

## 1. HIGH IMPACT — Ongoing Architecture (AgentHarness)

### ⚠️ Major Refactor: AgentHarness (35+ commits in May)

This is the biggest ongoing change. It's a **multi-month refactor** restructuring how pi's agent loop works internally.

**Commit arc (May):**
| Date | Commit | Change |
|------|--------|--------|
| May 3 | `a5b27367` | `feat(agent): add initial harness foundation` (+3,678 lines!) |
| May 3 | `83599e78` | `feat(agent): split harness compaction and session modules` |
| May 5 | `d29e47c7` | `feat(agent): add harness factory helpers` |
| May 6 | `530f14c0` | `refactor(agent): expose concrete harness session` |
| May 6 | `e1ca501d` | `refactor(agent): expose concrete harness` |
| May 6 | `617d8b31` | `refactor(agent): tighten harness environment and resources` |
| May 7 | `ddb18640` | `feat(agent): return diagnostics from resource loaders` |
| May 12 | `c0f416aa` | `feat(agent): add harness stream configuration` |
| May 13 | `79db9d62` | `refactor(agent): make harness resources explicit` |
| May 13 | `e25415dd` | `refactor(agent): finalize harness resource config` |
| May 14 | `846906e4` | `refactor(agent): add result-based execution env` |
| May 14 | `b7ea8210` | `refactor(agent): run harness loop directly` |
| May 15 | `80c918c2` | `refactor(agent): isolate node filesystem session dependencies` |
| May 15 | `a31ce0f4` | `refactor(agent): return results from compaction helpers` |
| May 15 | `4f40f62b` | `refactor(agent): harden harness session semantics` |
| May 19 | `b9448276` | `fix(agent): stop tool preflight after extension abort` |
| May 21 | `96f0edd0` | `Count user image tokens in context estimates` |

**Key architectural changes:**

1. **New module structure** (`packages/agent/src/harness/`):
   - `agent-harness.ts` — main orchestrator (grew to ~1,000+ lines)
   - `compaction/` — split into `compaction.ts`, `branch-summarization.ts`, `utils.ts`
   - `session/` — `jsonl-session-storage.ts`, `memory-session-storage.ts`, `session-repo.ts`
   - `env/nodejs.ts` — Node.js execution environment (+370 lines)
   - `execution-env.ts` — abstracted execution environment
   - `skills.ts` — harness-level skill loading
   - `system-prompt.ts` — harness-level system prompt composition
   - `prompt-templates.ts` — prompt template processing with `mapSkill`/`mapPromptTemplate`

2. **Result-based execution env** — harness now returns structured results instead of void. Makes testing and hook integration cleaner.

3. **Resource diagnostics** — resource loaders return diagnostics (warnings/errors) alongside content.

4. **Tool preflight abort fix** — `b9448276` fixed a bug where sibling tool calls kept preparing after run abort. **This is relevant to pi-crew** — when pi-crew cancels a task, pi's internal tool preflight now correctly stops.

**Relevance to pi-crew:**
- pi-crew currently uses `child-pi.ts` spawning — **not** `AgentHarness` directly
- The harness refactor is internal to pi; public APIs are stable
- When `AgentHarness` stabilizes (removes `Agent` dependency, adds tool registry), pi-crew could consider migration
- **This is a future migration path, not a current concern**

**Action:** Continue monitoring harness stabilization. No current code changes needed.

---

## 2. MEDIUM IMPACT — Aligned Direction

### A. New AI Providers

**Together AI** (`7adb8e76`) — first-class `@earendil-works/pi-ai` support. API key `TOGETHER_API_KEY`, auto-detection for base URLs, `thinkingFormat: 'together'` compat flag.

**Xiaomi MiMo** (`a4462267`) — new provider with `thinkingFormat` support and per-region token plan.

**Relevance:** pi-crew doesn't configure providers directly. **No action needed.**

### B. Codex Websocket Transport (`4745a958`)

Added **cached Codex websocket transport** for faster session resumption. Code generation becomes faster on subsequent turns within the same session.

**Relevance:** pi-crew tasks are typically single-session. **No action needed**, but good to know for longer multi-turn tasks.

### C. Generic Resource Loading — `mapSkill` / `mapPromptTemplate`

pi-mono added typed resource loading with `mapSkill`/`mapPromptTemplate` callbacks in `harness/skills.ts` and `harness/prompt-templates.ts`. Allows transforming skills with source-attached metadata.

**Relevance:** pi-crew's `src/skills/discover-skills.ts` uses simpler approach. **Opportunity:** Consider map callbacks if pi-crew adds source-aware skill metadata (e.g., skill scope tracking). **Low priority.**

### D. Stream Options Formalization

`AgentHarnessStreamOptions` is now a curated config surface (transport/timeout/retries/headers/metadata), snapshotted per-turn and patchable by `before_provider_request` hooks.

**Relevance:** pi-crew's `runtime/policy-engine.ts` handles model routing but doesn't expose transport/timeout/retry config. **Low priority opportunity** — consider adding `--stream-timeout`, `--max-retries` to `team action='run'`.

---

## 3. LOW IMPACT — New Features (No Action Needed)

### A. Image Models & Image Content (`9751057b`, `63c61aac`)

New `generateImages()` function and `images` API. Agents can now generate images. pi-crew tasks can use this if they have image-generation capability.

**No action needed** — pi-crew just passes tasks to pi; pi handles the capability.

### B. Session ID Naming (`52dc08c1`)

Explicit session ID naming — users can now specify a session ID on startup. Useful for resuming specific sessions.

**Potentially useful** for pi-crew's `inheritContext` feature (parent context passing). No current integration needed.

### C. Compact Read Rendering (`588639fa`, `373bd128`)

Large file reads are now collapsed by default with a "Show more" toggle. Reduces noise in agent output.

**UX improvement** — affects how pi-crew workers see read output. **No action needed.**

### D. Incremental Bash Streaming (`6b18cdba`)

Bash tool now streams output incrementally instead of waiting for the full command to finish. Better UX for long-running commands.

**No action needed** — this is internal to pi's bash tool.

### E. Edit Tool Unified Patch (`60a55a23`)

New unified patch format for the edit tool. More robust handling of multi-file edits.

**Relevance:** pi-crew's executor agents use the edit tool. **No action needed**, but good to know.

### F. RPC `excludeFromContext` Flag (`61babc24`)

New flag on bash commands to exclude command output from context. Useful for noisy commands (e.g., `ls -la` in large directories).

**Potentially useful** for pi-crew — could filter out noisy intermediate commands from task context. **Low priority.**

### G. Adaptive Thinking for Anthropic-Compatible Aliases (`d801d88a`)

Custom Anthropic-compatible model aliases now support adaptive thinking level selection.

**No action needed** — model-level config.

### H. Word Boundary Fixes (`44021008`, `b62776e4`, `701801de`)

TUI now uses `Intl.Segmenter` for proper Unicode word boundaries. Fixes copy/paste behavior across terminals.

**No action needed** — terminal UX.

### I. OAuth Device Code Refactor (`c554364c`, `11e868b7`)

Refactored device code login for Copilot and cleaned up OAuth callbacks.

**No action needed** — auth infrastructure.

### J. Windows VT Input Helper (`4868222e`)

Replaced `koffi` FFI library with native Windows VT input handling. Better Windows support.

**No action needed.**

### K. Remove Global Fetch Override (`c9e70492`)

Removed global `fetch` override. All fetch calls now go through proper dispatchers. Better debugging and reliability.

**No action needed** — infrastructure cleanup.

---

## 4. Bug Fixes Relevant to pi-crew

| Commit | Fix | Relevance |
|--------|-----|-----------|
| `b9448276` | Tool preflight stops after extension abort | **HIGH** — affects pi-crew task cancellation |
| `e007fcd0` | RPC rejects pending requests on child process exit | Affects child-pi cleanup |
| `9600ded9` | Revert stdout backpressure fix (then `d0d1d8ed` re-fixed) | Affects child-pi stdout handling |
| `ce0e801d` | Retry RPC stdout backpressure | Affects child-pi streaming |
| `c685b273` | Mark retrying agent end events | Affects event log accuracy |
| `32bcdc97` | Simplify agent session settlement | Affects session cleanup |
| `b1893b3d` | Preserve oversized tail output with trailing newline | Affects output truncation |
| `f9530678` | Correct bash truncation line count | Affects bash output display |

---

## 5. Opportunities for pi-crew Enhancement

> **Full implementation plans with code examples:** [`docs/pi-mono-opportunities.md`](./pi-mono-opportunities.md)

| # | Opportunity | Priority | Effort | Key Impact |
|---|-------------|----------|--------|-----------|
| 1 | **BM25 Semantic Reranking** for `team action='recommend'` | HIGH | Medium | Fixes keyword-matching failures for nuanced goals |
| 2 | **Extended Hook Phases** (`before_turn` / `after_turn`) | MEDIUM | Medium | Enables per-turn observability and early abort |
| 3 | **Hook Lifecycle Tests** | MEDIUM | Small | Coverage for untested hooks |
| 4A | **Task Phase Tracking** | LOW | Small | Richer `team action='status'` output |
| 4B | **Hook Documentation** (`docs/hooks.md`) | LOW | Small | Developer experience |

---

## 6. Summary

| Check | Result |
|-------|--------|
| Breaking API changes (May 2026) | **None** |
| Changes requiring pi-crew updates | **None** |
| Major architectural work | AgentHarness refactor (ongoing, internal) |
| New features | Image models, Codex websocket, Together AI, session ID naming |
| Bug fixes | 30+ in relevant packages, 1 directly relevant to pi-crew cancellation |
| Opportunities identified | 5 |
| Urgent migrations needed | **None** |

**Conclusion:** pi-crew v0.5.2 is fully compatible with pi's entire May 2026 release. The AgentHarness refactor is substantial but purely internal — it will eventually provide a migration path for pi-crew to use harness-based execution instead of child-process spawning, but this is a future consideration (6+ months out). Maintain current architecture; focus on pi-crew-specific enhancements.
