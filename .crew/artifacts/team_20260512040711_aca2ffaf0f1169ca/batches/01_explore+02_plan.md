=== Task 1: 01_explore (explorer) ===
Status: COMPLETED
Role: explorer
Result artifact: /home/bom/source/my_pi/pi-crew/.crew/artifacts/team_20260512040711_aca2ffaf0f1169ca/results/01_explore.txt
Log artifact: /home/bom/source/my_pi/pi-crew/.crew/artifacts/team_20260512040711_aca2ffaf0f1169ca/logs/01_explore.log
Transcript: /home/bom/source/my_pi/pi-crew/.crew/artifacts/team_20260512040711_aca2ffaf0f1169ca/transcripts/01_explore.jsonl
Usage: {"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"cost":0,"turns":0}
(no output)

=== Task 2: 02_plan (planner) ===
Status: COMPLETED
Role: planner
Result artifact: /home/bom/source/my_pi/pi-crew/.crew/artifacts/team_20260512040711_aca2ffaf0f1169ca/results/02_plan.txt
Log artifact: /home/bom/source/my_pi/pi-crew/.crew/artifacts/team_20260512040711_aca2ffaf0f1169ca/logs/02_plan.log
Transcript: /home/bom/source/my_pi/pi-crew/.crew/artifacts/team_20260512040711_aca2ffaf0f1169ca/transcripts/02_plan.jsonl
Usage: {"input":29875,"output":4123,"cacheRead":263424,"cacheWrite":0,"cost":0,"turns":0}
Now I have a thorough understanding of the spec, the extension patterns (pi-lsp, pi-crew), and the file structure. Let me create the implementation plan.

---

# Implementation Plan: pi-review Extension

## Overview

Create `/home/bom/source/my_pi/pi-review/` — a standalone Pi extension providing multi-perspective code review, diff analysis, and review quality enforcement. The extension registers 3 tools (`review_diff`, `review_file`, `review_report`) and 5 slash commands (`/review`, `/review security`, `/review diff`, `/review report`, `/review file <path>`).

## Architecture Summary

```
pi-review/
├── index.ts                          # Extension entry point (exports default function)
├── package.json                      # Pi extension manifest
├── tsconfig.json                     # TypeScript config (ES2022, NodeNext, strict)
├── src/
│   ├── config.ts                     # Load .pi/pi-review.json, merge with defaults
│   ├── types.ts                      # All shared types (ReviewFinding, ReviewReport, etc.)
│   ├── perspectives/
│   │   ├── registry.ts               # Perspective registration + lookup
│   │   ├── security.ts               # Security perspective (OWASP + STRIDE)
│   │   ├── performance.ts            # Performance perspective
│   │   ├── maintainability.ts        # Code quality perspective
│   │   ├── style.ts                  # Style/convention perspective
│   │   ├── testing.ts                # Test coverage perspective
│   │   └── production.ts             # Production readiness perspective
│   ├── diff/
│   │   ├── git-diff.ts               # Git diff extraction (spawn git diff)
│   │   ├── change-analysis.ts        # Classify hunks: new/modified/deleted
│   │   ├── context-extractor.ts      # Extract surrounding code context
│   │   └── impact-calculator.ts      # Calculate blast radius
│   ├── review/
│   │   ├── orchestrator.ts           # Coordinate perspectives, collect findings
│   │   ├── finding.ts                # Finding factory + validation helpers
│   │   ├── severity.ts               # Severity classification logic
│   │   └── report.ts                 # Report generator (markdown/json/summary)
│   ├── quality/
│   │   ├── specificity.ts            # Review specificity checker
│   │   ├── anti-generic.ts           # Reject generic reviews
│   │   └── evidence-required.ts      # Validate evidence field presence
│   └── extension/
│       ├── register.ts               # Pi extension registration (tools + commands)
│       └── tool-registry.ts          # Register review_diff, review_file, review_report
└── test/
    └── unit/
        ├── config.test.ts
        ├── perspectives.test.ts
        ├── severity.test.ts
        ├── finding.test.ts
        ├── quality-anti-generic.test.ts
        ├── quality-evidence.test.ts
        ├── quality-specificity.test.ts
        ├── git-diff.test.ts
        ├── change-analysis.test.ts
        ├── context-extractor.test.ts
        ├── impact-calculator.test.ts
        ├── orchestrator.test.ts
        ├── report.test.ts
        └── tool-registry.test.ts
```

## Ordered Task Plan

### Task 1: Scaffolding — package.json, tsconfig.json, index.ts
**Owner:** executor
**Dependencies:** None
**Files to create:**
- `package.json` — following pi-lsp pattern: `type: "module"`, peerDependencies on `@mariozechner/pi-coding-agent`, dependency on `typebox`, `diff`, scripts for typecheck and test
- `tsconfig.json` — identical to pi-lsp config
- `index.ts` — minimal entry: `import { registerPiReview } from "./src/extension/register.ts"; export default function(pi) { registerPiReview(pi); }`
**Validation:** `tsc --noEmit` passes (empty register initially)

### Task 2: Types & Config — types.ts, config.ts
**Owner:** executor
**Dependencies:** Task 1
**Files to create:**
- `src/types.ts` — `ReviewFinding`, `ReviewReport`, `ReviewPerspective`, `Severity`, `DiffHunk`, `ChangeType`, `ReviewConfig`, perspective config types, `ReviewCommand`
- `src/config.ts` — `loadConfig(cwd)` reads `.pi/pi-review.json`, merges with defaults from spec section 8, validates perspectives and quality settings
**Validation:** Unit tests for config loading (defaults, custom, malformed)

### Task 3: Severity & Finding — severity.ts, finding.ts
**Owner:** executor
**Dependencies:** Task 2
**Files to create:**
- `src/review/severity.ts` — severity classification function, severity ordering (must-fix > should-fix > nice-to-have > info), severity badge strings
- `src/review/finding.ts` — `createFinding()`, `validateFinding()` (requires evidence field), `findingsByFile()`, `findingsBySeverity()`, `findingsByCategory()`
**Validation:** Unit tests for severity ordering, finding validation, grouping

### Task 4: Perspective Registry & Checklists
**Owner:** executor
**Dependencies:** Task 2
**Files to create:**
- `src/perspectives/registry.ts` — `PerspectiveRegistry` class: register(name, checklist, defaultSeverity), get(name), list(), filterByNames(names?), buildPromptContext(perspective, hunks)
- `src/perspectives/security.ts` — SECURITY_CHECKLIST from spec, OWASP Top 10 mapping, STRIDE mapping, perspective registration
- `src/perspectives/performance.ts` — PERFORMANCE_CHECKLIST
- `src/perspectives/maintainability.ts` — MAINTAINABILITY_CHECKLIST
- `src/perspectives/style.ts` — Style/convention checklist
- `src/perspectives/testing.ts` — TESTING_CHECKLIST
- `src/perspectives/production.ts` — PRODUCTION_CHECKLIST
**Validation:** Unit tests verifying all perspectives register, checklist items are non-empty, registry lookup works, filter works

### Task 5: Diff Analysis — git-diff.ts, change-analysis.ts, context-extractor.ts, impact-calculator.ts
**Owner:** executor
**Dependencies:** Task 2
**Files to create:**
- `src/diff/git-diff.ts` — `extractDiff(cwd, base?, head?)`: spawn `git diff` with unified format, parse output, handle errors, return raw diff string
- `src/diff/change-analysis.ts` — `classifyChanges(diff)`: parse unified diff into `DiffHunk[]`, classify each hunk as `new | modified | deleted | renamed`, extract file path, line ranges
- `src/diff/context-extractor.ts` — `extractContext(file, hunks, linesBefore=5, linesAfter=5)`: read file, extract surrounding context lines for each hunk
- `src/diff/impact-calculator.ts` — `calculateImpact(hunks, cwd)`: count files changed, lines added/removed, identify high-impact files (large changes, critical paths like auth/config), produce `ImpactAssessment`
**Validation:** Unit tests with sample diff strings for classification, context extraction from temp files, impact calculation edge cases (empty diff, binary files, renamed files)

### Task 6: Quality Enforcement — anti-generic.ts, evidence-required.ts, specificity.ts
**Owner:** executor
**Dependencies:** Task 3
**Files to create:**
- `src/quality/anti-generic.ts` — `GENERIC_PHRASES`, `isGenericReview(text)`, `rejectGenericReview(findings)` — filter out generic-only findings
- `src/quality/evidence-required.ts` — `validateFindingsHaveEvidence(findings)`: returns `{valid, invalid}` arrays, `formatEvidenceError(finding)` helper
- `src/quality/specificity.ts` — `scoreSpecificity(finding)`: 0-1 score based on evidence length, code snippet presence, line reference; `isSpecificEnough(finding, threshold)`
**Validation:** Unit tests: generic phrase detection, evidence validation, specificity scoring

### Task 7: Report Generator — report.ts
**Owner:** executor
**Dependencies:** Tasks 3, 6
**Files to create:**
- `src/review/report.ts` — `generateReport(findings, options)`: supports `format: "markdown" | "json" | "summary"`, `groupBy: "file" | "perspective" | "severity"`, `includeSuggestions: boolean`; markdown format includes severity badges, file links, code snippets; summary format is concise table; JSON is raw structured output
**Validation:** Unit tests for each format, each groupBy, empty findings edge case

### Task 8: Orchestrator — orchestrator.ts
**Owner:** executor
**Dependencies:** Tasks 4, 5, 6, 7
**Files to create:**
- `src/review/orchestrator.ts` — `ReviewOrchestrator` class: `reviewDiff(cwd, options)`, `reviewFile(cwd, file, options)`, `generateReport(findings, options)`. Orchestrates: (1) extract diff or read file, 
[pi-crew compacted 5782 chars]