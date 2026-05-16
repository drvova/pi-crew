Selected skills: read-only-explorer, multi-perspective-review
Skill paths passed to child Pi: 2

# Applicable Skills
The following skills were selected for this worker. Follow them when they match the current task. If a selected skill conflicts with the explicit task packet, project AGENTS.md, or user request, follow the stricter/higher-priority instruction and report the conflict.

## read-only-explorer
Description: Read-only exploration and audit workflow. Use for explorer, analyst, reviewer, and source-audit roles that must inspect code without modifying files.
Source: project:skills/read-only-explorer

# read-only-explorer

Use this skill for explorer, analyst, reviewer, and source-audit roles.

## Contract

- Do not edit files.
- Do not write generated artifacts outside the run artifact directory.
- Prefer `read`, `rg`, `find`, `git status`, and package metadata inspection.
- Record exact files inspected.
- Distinguish direct evidence from inference.
- If implementation is needed, recommend it instead of modifying code.

## Output shape

Return:

1. files inspected;
2. findings with path references;
3. risks/unknowns;
4. recommended next tests or implementation tasks.

---

## multi-perspective-review
Description: Use when reviewing a plan, diff, implementation, worker output, release candidate, or external review feedback.
Source: project:skills/multi-perspective-review

# multi-perspective-review

Core principle: review early, review often, and separate concerns. Reviewer output is evidence to evaluate, not an instruction to obey blindly.

Distilled from detailed reads of requesting-code-review, receiving-code-review, subagent review checkpoints, differential review, and specialized review-agent patterns.

## Review Passes

Run relevant passes separately:

1. Spec compliance: Does the work match the request and nothing extra?
2. Correctness: Are edge cases, state transitions, and failure paths right?
3. Regression risk: Could config precedence, runtime defaults, or public APIs break?
4. Security: Trust boundaries, path containment, prompt injection, secrets, permissions.
5. Tests: Do tests assert the changed behavior and isolation concerns?
6. Maintainability: Narrow diff, typed inputs, clear ownership, reversible changes.
7. Operator experience: Error/status text, recovery hints, artifacts, logs.
8. Compatibility: Windows paths, Node/Pi versions, CLI flags, legacy paths.

## Finding Format

```text
[severity] path:line or symbol
Issue: ...
Impact: ...
Fix: ...
Verification: ...
```

Severity:

- critical: data loss, secret leak, arbitrary command/path escape, unusable default install;
- high: broken core workflow, ownership bypass, persistent incorrect state;
- medium: important regression, flaky test, confusing recoverable behavior;
- low: polish, maintainability, docs.

## Handling Review Feedback

[skill instructions truncated]
