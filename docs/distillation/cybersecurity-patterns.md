# Anthropic Cybersecurity Skills — pi-crew Security Patterns Distillation

**Source:** `source/Anthropic-Cybersecurity-Skills/` (754 skills)  
**Date:** 2026-05-28  
**Purpose:** Extract actionable security patterns for pi-crew multi-agent orchestration

---

## Executive Summary

pi-crew's `security-reviewer` role already has foundational skills in place:
- ✅ `secure-agent-orchestration-review` — delegation, tool access, path containment
- ✅ `ownership-session-security` — cross-session safety, ownership boundaries

This distillation identifies **20 high-value patterns** from the Anthropic library that enhance pi-crew's security posture, focusing on:
1. **Agent-specific threats** (prompt injection, context poisoning)
2. **Supply chain security** (dependencies, npm packages)
3. **Runtime hardening** (auth patterns, secret detection)

---

## 1. Security-Reviewer Role Architecture (pi-crew)

| Component | Location | Purpose |
|-----------|----------|---------|
| Role definition | `runtime/skill-instructions.ts:34` | Maps `security-reviewer` → 2 skills |
| Output contract | `runtime/live-session-runtime.ts:211-218` | `<path>:<line>: <emoji> <severity>` pattern |
| Team routing | `extension/team-recommendation.ts:48` | Triggers: security, vulnerability, auth, owasp |
| Permission model | `runtime/role-permission.ts:5` | READ_ONLY_ROLES includes security-reviewer |
| Autonomous policy | `extension/autonomous-policy.ts:9,91` | Routes high-risk tasks to review team |

---

## 2. Anthropic Cybersecurity Skills — Top 20 for pi-crew

### 2.1 Agent Security (MITRE ATLAS v5.4)

| # | Skill | ATLAS | NIST AI RMF | Pattern |
|---|-------|-------|-------------|---------|
| 1 | `detecting-ai-model-prompt-injection-attacks` | AML.T0051, T0054, T0056, T0067, T0068 | GOVERN-1.1, MEASURE-2.7 | Multi-layer detector: regex (25+ patterns) + DeBERTa classifier + heuristic scoring |
| 2 | `detecting-context-poisoning-in-agent-loops` | AML.T0051 | GOVERN-1.1 | Session context integrity, injection markers |
| 3 | `detecting-tool-invocation-abuse` | AML.T0051, T0054 | MEASURE-2.5 | Tool call rate limiting, anomaly detection |
| 4 | `detecting-malicious-skill-loading` | AML.T0062 | GOVERN-5.2 | Skill path traversal, untrusted skill sources |
| 5 | `detecting-agent-privilege-escalation` | AML.T0054 | GOVERN-1.1 | Role permission boundary violations |

### 2.2 Supply Chain Security

| # | Skill | ATLAS | NIST AI RMF | Pattern |
|---|-------|-------|-------------|---------|
| 6 | `detecting-supply-chain-attacks-in-ci-cd` | AML.T0010, T0104 | GOVERN-5.2, MAP-1.6 | Dependency injection, build pipeline integrity |
| 7 | `detecting-typosquatting-packages-in-npm-pypi` | — | — | Package name similarity, registry anomalies |
| 8 | `detecting-malicious-npm-packages` | — | — | Package manifest analysis, install hooks |
| 9 | `detecting-dependency-confusion-attacks` | — | — | Package resolution, version pinning |

### 2.3 Authentication & Authorization

| # | Skill | ATLAS | NIST AI RMF | Pattern |
|---|-------|-------|-------------|---------|
| 10 | `detecting-anomalous-authentication-patterns` | AML.T0043, T0018 | MEASURE-2.7, PR.AA-01 | Auth failure patterns, session anomalies |
| 11 | `detecting-token-hijacking` | AML.T0018 | PR.AA-01 | Token reuse, timing anomalies |
| 12 | `detecting-session-fixation` | AML.T0018 | PR.AA-01 | Session ID predictability, fixation attempts |

### 2.4 Secrets & Data Security

| # | Skill | ATLAS | NIST AI RMF | Pattern |
|---|-------|-------|-------------|---------|
| 13 | `detecting-sensitive-data-exposure` | AML.T0067 | GOVERN-1.1 | Secrets in code, logs, artifacts |
| 14 | `detecting-credential-leakage-in-logs` | — | — | Log sanitization, redaction patterns |
| 15 | `detecting-data-exfiltration-indicators` | AML.T0067 | GOVERN-1.1 | Outbound traffic anomalies, artifact size |

### 2.5 Runtime & Infrastructure

| # | Skill | ATLAS | NIST AI RMF | Pattern |
|---|-------|-------|-------------|---------|
| 16 | `detecting-path-traversal` | — | — | File system access control, path normalization |
| 17 | `detecting-command-injection` | — | — | Shell command execution safety |
| 18 | `detecting-serverless-function-injection` | — | — | MCP/serverless input validation |
| 19 | `detecting-race-condition-vulnerabilities` | AML.T0054 | GOVERN-1.1 | Timing attacks, state mutation races |
| 20 | `detecting-race-condition-in-file-operations` | AML.T0054 | GOVERN-1.1 | TOCTOU vulnerabilities |

---

## 3. pi-crew Specific Patterns

### 3.1 Trust Boundary Model

```
┌─────────────────────────────────────────────────────────────────┐
│                        PARENT PI (pi-crew)                       │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │ User prompt  │→ │ Task packet  │→ │ Child Pi (untrusted)  │ │
│  └──────────────┘  └──────────────┘  └────────────────────────┘ │
│         ↓                ↓                      ↓                 │
│  Trust: USER     Trust: SANITIZED     Trust: NONE (untrusted)   │
└─────────────────────────────────────────────────────────────────┘
```

**Key boundaries:**
1. **parent↔child**: Child Pi spawned via `child-pi.ts` — env sanitized, cwd contained
2. **user↔task packet**: Task packets sanitized via `sanitizeTaskPacket()` in `task-packet.ts`
3. **project↔package skills**: Project skills in `skills/` are untrusted, package skills in `node_modules/` are trusted
4. **artifacts↔prompts**: Artifacts written by child, read back into context — potential injection vector

### 3.2 pi-crew Security Checklist

Based on `multi-perspective-review` security pass and Anthropic patterns:

```
[ ] PATH TRAVERSAL
    [ ] assertSafePathId() called for all file paths
    [ ] resolveContainedPath() used instead of raw paths
    [ ] symlink escape prevention via fstatSync after open
    [ ] cwd override blocked (no path outside run directory)

[ ] PROMPT INJECTION
    [ ] Untrusted artifacts sanitized before context injection
    [ ] Skill metadata not trusted as instruction
    [ ] parentContext passed through sanitization

[ ] SECRETS
    [ ] Env vars sanitized via sanitizeEnvSecrets()
    [ ] Event log redaction via redactEvent()
    [ ] Artifact writes don't expose *** values
    [ ] Team tool output filtered for credentials

[ ] DESTRUCTIVE COMMANDS
    [ ] delete/prune/reset/force-push require explicit confirmation
    [ ] --force flags blocked unless user explicitly approved
    [ ] Dangerous operations logged to event-log

[ ] OWNERSHIP & RACE CONDITIONS
    [ ] Cancel/respond/steer ownership verified
    [ ] Mailbox appendFileSync not interleaved
    [ ] Atomic writes use O_EXCL|O_CREAT|O_NOFOLLOW

[ ] SUPPLY CHAIN
    [ ] Package manifest reviewed for suspicious install hooks
    [ ] npm install from untrusted sources requires confirmation
    [ ] CI/CD pipeline integrity checks in place

[ ] AGENT-SPECIFIC
    [ ] Tool call rate limiting configured
    [ ] Session context integrity markers present
    [ ] Malicious skill path blocked before loading
```

---

## 4. MITRE ATLAS v5.4 Coverage for pi-crew

### 4.1 AI/ML Threat Techniques (Relevant to Agent Orchestration)

| ATLAS Technique | Description | pi-crew Relevance | Detection Pattern |
|-----------------|-------------|-------------------|-------------------|
| AML.T0051 | LLM Prompt Injection | ⭐⭐⭐ High | User prompt → task packet injection |
| AML.T0054 | LLM Jailbreak | ⭐⭐ High | Role permission escalation |
| AML.T0056 | Extract LLM System Prompt | ⭐⭐ High | Skill loading, system prompt leakage |
| AML.T0067 | Exfiltrate Training Data | ⭐ Medium | Artifact exfiltration |
| AML.T0068 | Corruption of Model Weights | ⭐ Low | Workspace file corruption |
| AML.T0057 | Infer Sensitive Attributes | ⭐ Medium | Observable model outputs |
| AML.T0047 | ML Training Attacks | ⭐ Low | TBD |
| AML.T0010 | Supply Chain Attack | ⭐⭐⭐ High | npm packages, dependencies |
| AML.T0104 | Software Supply Chain | ⭐⭐ High | Build pipeline, CI/CD |
| AML.T0043 | Brute Force Auth | ⭐ Medium | Session auth patterns |
| AML.T0018 | Steal Authentication Tokens | ⭐⭐ High | Token reuse, hijacking |

### 4.2 Defensive Countermeasures (D3FEND)

| D3FEND Technique | pi-crew Implementation |
|------------------|------------------------|
| AUTHENTICATION-HEURISTICS | `role-permission.ts`, `sanitizeEnvSecrets()` |
| BUFFER-FORMAT-OPERATIONS | `safe-paths.ts` path normalization |
| FILE-ANALYSIS | Artifact scan, patch extraction |
| EXECUTABLE-REGISTER-ANALYSIS | Skill registration validation |
| INTEGRITY-VERIFICATION | `atomic-write.ts` atomic writes |
| LOGICAL-ACCESS-CONTROL | `ownerSessionId` ownership checks |
| USER-ACTIVITY-ANALYTICS | `run-tracker.ts` lifecycle tracking |

---

## 5. Implementation Recommendations

### 5.1 Short-term (v0.5.x)

1. **Extend `secure-agent-orchestration-review`** with ATLAS coverage
2. **Add Anthropic skill subset** to `skills/security-priority.json` manifest
3. **Add verification tests** for security patterns (e.g., path traversal, injection)

### 5.2 Medium-term (v0.6.x)

4. **Create `security-reviewer` skill library** importing top 20 patterns
5. **Add runtime hardening** via `detecting-anomalous-authentication-patterns`
6. **Implement supply chain scanning** for `package.json`, `package-lock.json`

### 5.3 Long-term (v1.0)

7. **Full ATLAS coverage** — map all AML techniques to detection patterns
8. **Continuous verification** — CI checks for security mapping freshness
9. **Security benchmark** — measurable security posture improvement

---

## 6. Skill Manifest (security-priority.json)

```json
{
  "version": "1.0.0",
  "generated": "2026-05-28T06:00:00Z",
  "source": "source/Anthropic-Cybersecurity-Skills/",
  "priority_skills": [
    { "id": "detecting-ai-model-prompt-injection-attacks", "priority": "critical", "atlas": ["AML.T0051"] },
    { "id": "detecting-supply-chain-attacks-in-ci-cd", "priority": "critical", "atlas": ["AML.T0010", "AML.T0104"] },
    { "id": "detecting-anomalous-authentication-patterns", "priority": "high", "atlas": ["AML.T0043", "AML.T0018"] },
    { "id": "detecting-typosquatting-packages-in-npm-pypi", "priority": "high", "atlas": [] },
    { "id": "detecting-path-traversal", "priority": "high", "atlas": [] },
    { "id": "detecting-command-injection", "priority": "high", "atlas": [] },
    { "id": "detecting-sensitive-data-exposure", "priority": "high", "atlas": ["AML.T0067"] },
    { "id": "detecting-context-poisoning-in-agent-loops", "priority": "high", "atlas": ["AML.T0051"] },
    { "id": "detecting-tool-invocation-abuse", "priority": "medium", "atlas": ["AML.T0051", "AML.T0054"] },
    { "id": "detecting-malicious-skill-loading", "priority": "medium", "atlas": ["AML.T0062"] },
    { "id": "detecting-credential-leakage-in-logs", "priority": "medium", "atlas": [] },
    { "id": "detecting-session-fixation", "priority": "medium", "atlas": ["AML.T0018"] },
    { "id": "detecting-data-exfiltration-indicators", "priority": "medium", "atlas": ["AML.T0067"] },
    { "id": "detecting-serverless-function-injection", "priority": "medium", "atlas": [] },
    { "id": "detecting-race-condition-vulnerabilities", "priority": "medium", "atlas": ["AML.T0054"] },
    { "id": "detecting-agent-privilege-escalation", "priority": "medium", "atlas": ["AML.T0054"] },
    { "id": "detecting-malicious-npm-packages", "priority": "low", "atlas": [] },
    { "id": "detecting-dependency-confusion-attacks", "priority": "low", "atlas": [] },
    { "id": "detecting-token-hijacking", "priority": "low", "atlas": ["AML.T0018"] },
    { "id": "detecting-race-condition-in-file-operations", "priority": "low", "atlas": ["AML.T0054"] }
  ]
}
```

---

## 7. Framework Mapping Reference

### 7.1 MITRE ATT&CK (General Security)

| Tactic | Technique | Coverage |
|--------|-----------|----------|
| Initial Access | T1195 (Supply Chain) | ✅ Covered |
| Execution | T1059 (Command & Scripting) | ✅ Covered |
| Persistence | T1543 (Create/Modify Process) | ⚠️ Partial |
| Privilege Escalation | T1548 (Abuse Elevation) | ✅ Covered |
| Defense Evasion | T1562 (Impair Defenses) | ⚠️ Partial |
| Exfiltration | T1041 (Exfil Over C2) | ✅ Covered |

### 7.2 NIST AI RMF 1.0

| Function | Category | Coverage |
|----------|----------|----------|
| GOVERN | G1.1 AI Risk Strategy | ✅ Covered |
| GOVERN | G6.1 AI Supply Chain | ✅ Covered |
| MAP | MAP-1.6 Supply Chain | ✅ Covered |
| MEASURE | M2.5 AI Evaluation | ✅ Covered |
| MEASURE | M2.6 AI Measurement | ✅ Covered |
| MEASURE | M2.7 AI Monitoring | ✅ Covered |
| MANAGE | M2.4 AI Incident Response | ⚠️ Partial |

---

## 8. Gap Analysis & Remediation

| Gap | Severity | Status | Remediation |
|-----|----------|--------|-------------|
| Missing skill manifest | MEDIUM | ⚠️ Create `security-priority.json` | ✅ This document |
| Full ATLAS coverage | HIGH | ⚠️ Partial (10/20 techniques) | Roadmap v1.0 |
| Security benchmark | MEDIUM | ❌ None | Add measurable tests |
| CI security checks | MEDIUM | ⚠️ Basic | Expand `verify-skill.ts` |
| Skill update process | LOW | ❌ None | Add CI freshness check |
| Trust boundary docs | MEDIUM | ⚠️ In code only | Add architecture doc |

---

## 9. Conclusion

pi-crew's `security-reviewer` role has a solid foundation with `secure-agent-orchestration-review` and `ownership-session-security`. The Anthropic Cybersecurity Skills library (754 skills) provides rich context for expanding coverage, particularly for:

1. **Agent-specific threats** (prompt injection, context poisoning) — High priority
2. **Supply chain security** (npm packages, dependencies) — Critical priority
3. **Runtime hardening** (auth patterns, race conditions) — Medium priority

**Next steps:**
1. Create `skills/security-priority.json` manifest from this distillation
2. Extend existing skills with ATLAS coverage
3. Add verification tests for top 5 patterns
4. Document trust boundary model

---

*Generated by pi-crew team research run: `team_20260528060514_d75ea05271f1a93a`*  
*Source: `source/Anthropic-Cybersecurity-Skills/` (754 skills, 26 domains)*