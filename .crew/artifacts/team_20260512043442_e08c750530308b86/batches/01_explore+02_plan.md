=== Task 1: 01_explore (explorer) ===
Status: COMPLETED
Role: explorer
Result artifact: /home/bom/source/my_pi/pi-crew/.crew/artifacts/team_20260512043442_e08c750530308b86/results/01_explore.txt
Log artifact: /home/bom/source/my_pi/pi-crew/.crew/artifacts/team_20260512043442_e08c750530308b86/logs/01_explore.log
Transcript: /home/bom/source/my_pi/pi-crew/.crew/artifacts/team_20260512043442_e08c750530308b86/transcripts/01_explore.jsonl
Usage: {"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"cost":0,"turns":0}
(no output)

=== Task 2: 02_plan (planner) ===
Status: COMPLETED
Role: planner
Result artifact: /home/bom/source/my_pi/pi-crew/.crew/artifacts/team_20260512043442_e08c750530308b86/results/02_plan.txt
Log artifact: /home/bom/source/my_pi/pi-crew/.crew/artifacts/team_20260512043442_e08c750530308b86/logs/02_plan.log
Transcript: /home/bom/source/my_pi/pi-crew/.crew/artifacts/team_20260512043442_e08c750530308b86/transcripts/02_plan.jsonl
Usage: {"input":37386,"output":7434,"cacheRead":530624,"cacheWrite":0,"cost":0,"turns":0}
Excellent. I now have comprehensive understanding of all the patterns, APIs, and requirements. Let me create the implementation plan.

---

# pi-visual Extension — Implementation Plan

## Overview

This plan covers the full implementation of `pi-visual`, a Pi TUI extension providing interactive visual overlays for plan review, diff review (side-by-side), architecture visualization, and task progress. The extension lives at `/home/bom/source/my_pi/pi-visual/` and follows established patterns from `pi-review`, `pi-crew`, and the `pi-tui` component model.

---

## Architecture Summary

```
pi-visual/
├── index.ts                          # Entry point (pi-visual extension factory)
├── src/
│   ├── extension/
│   │   ├── register.ts               # Registration: events, commands, tools
│   │   └── tool-registry.ts          # Tool definitions for LLM-callable tools
│   ├── plan/
│   │   ├── plan-overlay.ts           # Plan Review Overlay Component
│   │   ├── task-card.ts              # Single task card component
│   │   ├── dependency-graph.ts       # Task dependency visualization
│   │   └── plan-actions.ts           # Approve/reject/reorder actions
│   ├── diff/
│   │   ├── diff-overlay.ts           # Diff Review Overlay Component
│   │   ├── side-by-side.ts           # Side-by-side diff rendering engine
│   │   ├── annotation.ts             # Inline annotation/comment system
│   │   └── review-summary.ts         # Review summary component
│   ├── architecture/
│   │   ├── arch-overlay.ts           # Architecture View Overlay Component
│   │   ├── file-graph.ts             # File dependency graph (tree-based)
│   │   ├── impact-view.ts            # Change impact visualization
│   │   └── symbol-map.ts             # Symbol map (pi-lsp integration)
│   ├── progress/
│   │   ├── progress-widget.ts        # Task progress widget (footer/powerbar)
│   │   └── status-line.ts            # Status line component
│   ├── components/
│   │   ├── scrollable.ts             # Reusable scrollable container
│   │   ├── selectable-list.ts        # Keyboard-navigable list
│   │   ├── split-pane.ts             # Horizontal/vertical split pane
│   │   └── markup.ts                 # Lightweight markdown→ANSI rendering
│   └── config.ts                     # Configuration loader (.pi/pi-visual.json)
├── test/
│   ├── unit/
│   │   ├── plan-overlay.test.ts
│   │   ├── task-card.test.ts
│   │   ├── dependency-graph.test.ts
│   │   ├── diff-overlay.test.ts
│   │   ├── side-by-side.test.ts
│   │   ├── annotation.test.ts
│   │   ├── review-summary.test.ts
│   │   ├── arch-overlay.test.ts
│   │   ├── file-graph.test.ts
│   │   ├── impact-view.test.ts
│   │   ├── progress-widget.test.ts
│   │   ├── status-line.test.ts
│   │   ├── scrollable.test.ts
│   │   ├── selectable-list.test.ts
│   │   ├── split-pane.test.ts
│   │   └── markup.test.ts
│   └── integration/
│       └── commands.test.ts
├── package.json
├── tsconfig.json
└── README.md
```

---

## Implementation Phases (Ordered)

### Phase 0: Project Scaffold & Config
**Files:** `package.json`, `tsconfig.json`, `index.ts`, `src/config.ts`, `src/extension/register.ts`, `src/extension/tool-registry.ts`

| Step | Description |
|------|-------------|
| 0.1 | Create `package.json` following `pi-review` pattern: `"type": "module"`, `"pi": { "extensions": ["./index.ts"] }`, peerDeps on `@mariozechner/pi-coding-agent`, devDep on `@mariozechner/pi-coding-agent` + `typescript`. Dep on `diff` (for diff computation) and `typebox`. |
| 0.2 | Create `tsconfig.json` matching `pi-review` pattern (`ES2022`, `NodeNext`, strict). |
| 0.3 | Create `index.ts` — minimal entry: `import type { ExtensionAPI } from "@mariozechner/pi-coding-agent"; export default function(pi: ExtensionAPI): void { registerPiVisual(pi); }` |
| 0.4 | Create `src/config.ts` — load `.pi/pi-visual.json` with sensible defaults (`enabled: true`, `autoOpen`, `syntaxHighlighting: true`, `maxDiffLines: 500`, `diffViewer: "tui"`). Use `zod` or manual validation. |
| 0.5 | Create `src/extension/register.ts` — skeleton: `session_start` handler, load config, register commands stubs, register tools. |
| 0.6 | Create `src/extension/tool-registry.ts` — register 3 tools: `visual_update_plan`, `visual_update_progress`, `visual_show_findings`. These are called by other extensions (pi-pipeline, pi-crew, pi-review) to push state. |
| 0.7 | Register `/visual` command with subcommand routing: `plan`, `diff`, `architecture`, `progress`. Use `pi.registerCommand("visual", ...)` with arg parsing. |

**Dependencies:** None (foundation)
**Validation:** `tsc --noEmit` passes; `node --experimental-strip-types` can load the entry point without errors.

---

### Phase 1: Shared TUI Components
**Files:** `src/components/scrollable.ts`, `src/components/selectable-list.ts`, `src/components/split-pane.ts`, `src/components/markup.ts`

| Step | Description |
|------|-------------|
| 1.1 | **Scrollable** — Wraps a child `Component` in a virtual-scroll viewport. Tracks `scrollOffset`, `maxHeight`. `handleInput` for arrow keys, Page Up/Down, Home/End. `render(width)` renders only visible lines. Uses the `Component` interface from `@mariozechner/pi-tui`. |
| 1.2 | **SelectableList** — Extends Scrollable with `selectedIndex`, keyboard navigation (↑↓), selection highlight via theme function. Fires `onSelect` callback. Items are generic `{ label, description?, data }`. |
| 1.3 | **SplitPane** — Renders two child components side by side (vertical split) or stacked (horizontal). Takes `splitRatio` (e.g., 0.5 for 50/50). Draws a vertical `│` divider for side-by-side. Used by diff view. |
| 1.4 | **Markup** — Lightweight markdown-to-ANSI renderer. Handles headings (bold+underline), bullet lists, code spans (dim), code blocks (indented), horizontal rules. Does NOT depend on `pi-tui`'s Markdown component (to avoid coupling to its theme); uses a simple theme function map. |

**Dependencies:** Phase 0 (for type imports only)
**Validation:** Unit tests for each: render at width=80, verify line count, verify scroll behavior, verify split rendering, verify markup output.

---

### Phase 2: Progress Widget (Simplest Overlay — Start Here)
**Files:** `src/progress/progress-widget.ts`, `src/progress/status-line.ts`

| Step | Description |
|------|-------------|
| 2.1 | **StatusLine** — Single-line component: `📊 Pipeline: [████████░░] 80% — Task 4/5 (reviewing) | Cost: $0.38`. Takes `ProgressState { total, completed, currentTask, phase, cost? }`. Renders progress bar with block characters. |
| 2.2 | **ProgressWidget** — Registered via `ctx.ui.setWidget("pi-visual-progress", factory)` or `ctx.ui.setStatus("pi-visual-progress", text)`. Consumes `visual_update_progress` tool events to update state. Periodically re-renders via animation frame counter. Uses `ctx.ui.setWidget` for rich rendering or falls back to `setStatus` for simple text. |
| 2.3 | Wire `/visual progress` command to toggle widget visibility. |
| 2.4 | Wire `visual_update_progress` tool to accept `{ total, completed, currentTask, phase, cost? }` and update widget state. |

**Dependencies:** Phase 0, Phase 1 (Scrollable not needed here; direct rendering)
**Validation:** Unit test: render at width=80, verify progress bar fills correctly. Unit test: status line truncation. Test `/visual progress` command routing.

---

### Phase 3: Plan Review Overlay
**Files:** `src/plan/plan-overlay.ts`, `src/plan/task-card.ts`, `src/plan/dependency-graph.ts`, `src/plan/plan-actions.ts`

| Step | Description |
|------|-------------|
| 3.1 | **TaskCard** — Renders a single task in the plan: checkbox `[✓]/[→]/[ ]`, task number, description, files, complexity, dependencies. Takes `PlanTask { id, description, files, complexity?, dependsOn?, status }`. Renders as 2-4 lines of styled text. |
| 3.2 | **DependencyGraph** — Text-based dependency visualization. Renders task IDs with arrow connectors (`01 → 02 → 03`). Identifies critical path and parallel groups. Returns `string[]` for embedding in overlay. |
| 3.3 | **PlanActions** — Action handler for plan operations: approve all, reject with reason, edit task, deepen plan. Returns action result objects that the overlay feeds back v
[pi-crew compacted 16170 chars]