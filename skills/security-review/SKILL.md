# Security Review Skill

**Version:** 1.0.0  
**Author:** pi-crew team  
**Source:** `source/Anthropic-Cybersecurity-Skills/` distillation

## Overview

Security review patterns for pi-crew multi-agent orchestration.
Based on MITRE ATLAS v5.4, NIST AI RMF, and Anthropic Cybersecurity Skills.

## TRIGGERS

Trigger this skill when:
- User requests: "security review", "vulnerability scan", "audit", "pen test"
- Keywords: security, vulnerability, auth, owasp, injection, xss, csrf, exploit
- Actions: `team action='run', team='review'`
- High-risk tasks routed by autonomous policy

## ENFORCE

### Gate 1: PATH TRAVERSAL (RED → GREEN)
```
RED: Any unvalidated path operation (read/write/exec)
YELLOW: Path validated but without symlink check
GREEN: Path validated with assertSafePathId() + resolveRealContainedPath()
```

### Gate 2: PROMPT INJECTION (RED → Green)
```
RED: Untrusted input passed to model without sanitization
YELLOW: Partial sanitization (regex only, no context markers)
GREEN: Full sanitization with injection markers + context isolation
```

### Gate 3: SECRET EXPOSURE (RED → Green)
```
RED: *** values visible in logs/artifacts/transcripts
YELLOW: Partial redaction (logs only, not artifacts)
GREEN: Full redaction via redactEvent(), sanitizeEnvSecrets()
```

### Gate 4: SUPPLY CHAIN (RED → Green)
```
RED: Dependencies from untrusted sources without verification
YELLOW: Lockfile checked but package integrity not verified
GREEN: Package integrity verified + npm audit + typosquatting check
```

## PATTERNS

### Pattern 1: Agent Context Poisoning Detection

**MITRE ATLAS:** AML.T0051 (Prompt Injection), AML.T0054 (Jailbreak)

```typescript
// Check for injection markers in user input
const INJECTION_PATTERNS = [
  /\b(ignore|disregard|forget)\s+(previous|all|above)\s+(instructions|prompts)/i,
  /\b(you\s+are\s+now|act\s+as|pretend)\s+\w+/i,
  /<\s*script\s*>/i,
  /\{\{.*?\}\}/,  // Template injection
  /\$\{.*?\}/,    // Variable injection
  /\[\s*system\s*\]/i,
  /\[\s*assistant\s*\]/i,
];

function detectInjection(input: string): boolean {
  return INJECTION_PATTERNS.some(p => p.test(input));
}

// Check task packet for poisoned context
function validateTaskPacket(packet: TaskPacket): ValidationResult {
  const injections = detectInjection(packet.prompt);
  if (injections) {
    return {
      severity: 'critical',
      category: 'prompt-injection',
      evidence: packet.prompt,
      recommendation: 'Sanitize input with injection markers',
    };
  }
  return { severity: 'pass', category: 'context-integrity', evidence: null };
}
```

### Pattern 2: Path Traversal Prevention

**MITRE ATLAS:** ATT&CK T1059 (Command & Scripting Interpreter)

```typescript
import { assertSafePathId, resolveContainedPath } from '../utils/safe-paths.ts';

function safeFileOperation(path: string, cwd: string): SafePathResult {
  // Step 1: Validate path ID format
  assertSafePathId(path);
  
  // Step 2: Resolve to absolute with containment
  const resolved = resolveContainedPath(path, cwd);
  
  // Step 3: Verify resolved path is within cwd
  if (!resolved.startsWith(cwd)) {
    return {
      safe: false,
      reason: 'Path escapes working directory',
      resolved: undefined,
    };
  }
  
  return {
    safe: true,
    resolved,
    reason: 'Path validated and contained',
  };
}
```

### Pattern 3: Supply Chain Security

**MITRE ATLAS:** AML.T0010 (Supply Chain), AML.T0104 (Software Supply Chain)

```typescript
const TRUSTED_NPM_SOURCES = [
  'registry.npmjs.org',
  'registry.npmmirror.com',
];

function validateNpmPackage(manifest: PackageManifest): ValidationResult {
  // Check for typosquatting
  const suspiciousNames = detectTyposquatting(manifest.name);
  if (suspiciousNames.length > 0) {
    return {
      severity: 'high',
      category: 'typosquatting',
      evidence: `Package name similar to: ${suspiciousNames.join(', ')}`,
    };
  }
  
  // Check for post-install scripts
  if (manifest.scripts?.postinstall && !isTrustedSource(manifest)) {
    return {
      severity: 'medium',
      category: 'supply-chain',
      evidence: 'Post-install script detected',
    };
  }
  
  // Check dependencies
  const dangerousDeps = findDangerousDependencies(manifest.dependencies);
  if (dangerousDeps.length > 0) {
    return {
      severity: 'high',
      category: 'dependency-confusion',
      evidence: dangerousDeps,
    };
  }
  
  return { severity: 'pass', category: 'supply-chain', evidence: null };
}
```

### Pattern 4: Secret Redaction

**MITRE ATLAS:** AML.T0067 (Exfiltrate Training Data)

```typescript
import { redactEvent } from '../state/event-log.ts';

const SECRET_PATTERNS = [
  /\b(?:api[_-]?key|secret|token|password|credential)["\s]*[=:]["\s]*[A-Za-z0-9+/]{20,}/gi,
  /\b(?:ghp|github)_[A-Za-z0-9]{36,}/g,
  /\bBearer\s+[A-Za-z0-9+/=_.-]{20,}/g,
  /\b[A-Za-z0-9+/]{40,}={0,2}\b/g,  // Generic long base64
];

function redactSecrets(content: string): string {
  let redacted = content;
  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, '***REDACTED***');
  }
  return redacted;
}

// Apply to all event types
function safeLogEvent(event: CrewEvent): void {
  const redacted = redactEvent(event);  // Built-in redaction
  appendEvent(redacted);
}
```

### Pattern 5: Race Condition Detection

**MITRE ATLAS:** AML.T0054 (Privilege Escalation via Race)

```typescript
// Detect timing attacks and race conditions
const RACE_CONDITION_PATTERNS = [
  { pattern: /appendFileSync.*race/i, severity: 'medium' },
  { pattern: /readFileSync.*writeFileSync.*race/i, severity: 'high' },
  { pattern: /mkdirSync.*mkdir.*race/i, severity: 'medium' },
];

function detectRaceConditions(code: string): Finding[] {
  const findings: Finding[] = [];
  
  // Check for file operation races
  for (const { pattern, severity } of RACE_CONDITION_PATTERNS) {
    if (pattern.test(code)) {
      findings.push({
        severity,
        category: 'race-condition',
        pattern: pattern.source,
        recommendation: 'Use atomic write or filesystem locking',
      });
    }
  }
  
  // Check for timing-sensitive operations
  if (code.includes('setTimeout') && code.includes('auth')) {
    findings.push({
      severity: 'medium',
      category: 'timing-attack',
      recommendation: 'Add constant-time comparison for auth checks',
    });
  }
  
  return findings;
}
```

### Pattern 6: Authentication Anomaly Detection

**MITRE ATLAS:** AML.T0043 (Auth Failure), AML.T0018 (Token Theft)

```typescript
interface AuthPattern {
  sessionId: string;
  timestamp: number;
  failures: number;
  source: string;
}

function detectAuthAnomalies(sessions: AuthPattern[]): Finding[] {
  const findings: Finding[] = [];
  
  // Brute force detection
  for (const session of sessions) {
    if (session.failures > 5) {
      findings.push({
        severity: 'high',
        category: 'brute-force',
        evidence: `${session.failures} auth failures from ${session.source}`,
      });
    }
    
    // Token reuse detection
    if (session.timestamp < Date.now() - 3600000) {
      findings.push({
        severity: 'medium',
        category: 'token-reuse',
        evidence: 'Stale session token used',
      });
    }
  }
  
  // Session fixation
  const predictableIds = sessions.filter(s => 
    /^(session|team|run)_[a-z0-9]{8}$/i.test(s.sessionId)
  );
  if (predictableIds.length > 0) {
    findings.push({
      severity: 'medium',
      category: 'session-fixation',
      evidence: 'Predictable session ID pattern detected',
    });
  }
  
  return findings;
}
```

### Pattern 7: Tool Invocation Abuse Detection

**MITRE ATLAS:** AML.T0051 (Prompt Injection)

```typescript
interface ToolMetrics {
  toolName: string;
  callCount: number;
  timeWindow: number;
  anomalies: string[];
}

function detectToolAbuse(metrics: ToolMetrics[]): Finding[] {
  const findings: Finding[] = [];
  const RATE_THRESHOLD = 10; // calls per minute
  const BURST_THRESHOLD = 20; // calls in 30 seconds
  
  for (const metric of metrics) {
    // Rate limiting
    const rate = metric.callCount / (metric.timeWindow / 60000);
    if (rate > RATE_THRESHOLD) {
      findings.push({
        severity: 'high',
        category: 'tool-abuse',
        evidence: `${metric.toolName}: ${rate.toFixed(1)} calls/min (threshold: ${RATE_THRESHOLD})`,
        recommendation: 'Implement rate limiting or throttling',
      });
    }
    
    // Burst detection
    if (metric.callCount > BURST_THRESHOLD && metric.timeWindow < 30000) {
      findings.push({
        severity: 'critical',
        category: 'tool-burst',
        evidence: `${metric.toolName}: ${metric.callCount} calls in <30s`,
        recommendation: 'Block tool and investigate source',
      });
    }
  }
  
  return findings;
}
```

### Pattern 8: Malicious Skill Loading Detection

**MITRE ATLAS:** AML.T0062 (Exfiltrate Data via ML)

```typescript
const UNSAFE_SKILL_PATTERNS = [
  /(^|\/)\.\.(\/|$)/,                    // Path traversal
  /^[A-Z]:/i,                            // Windows absolute path
  /^\//,                                 // Unix absolute path
  /\.exe$|\.dll$|\.so$/i,                // Binary files
  /<script|SQL|SELECT.*FROM/i,           // Script injection
];

function validateSkillPath(path: string): ValidationResult {
  if (!path || path.includes('\0')) {
    return {
      safe: false,
      reason: 'Null byte or empty path',
      category: 'malicious-skill',
    };
  }
  
  for (const pattern of UNSAFE_SKILL_PATTERNS) {
    if (pattern.test(path)) {
      return {
        safe: false,
        reason: `Path matches unsafe pattern: ${pattern}`,
        category: 'malicious-skill',
      };
    }
  }
  
  // Check if skill exists and is readable
  if (!existsSync(path)) {
    return {
      safe: false,
      reason: 'Skill file does not exist',
      category: 'missing-skill',
    };
  }
  
  return {
    safe: true,
    reason: 'Skill path validated',
    category: 'skill-path',
  };
}
```

---

## TOOLS

| Tool | Purpose |
|------|---------|
| `assertSafePathId()` | Path ID format validation |
| `resolveContainedPath()` | Path containment resolution |
| `redactEvent()` | Event log redaction |
| `sanitizeEnvSecrets()` | Environment variable sanitization |
| `sanitizeTaskPacket()` | Task packet sanitization |
| `atomicWriteJson()` | Atomic file writes |

---

## METRICS

| Metric | Target |
|--------|--------|
| Path traversal findings | 0 critical |
| Secret exposure | 0 in any artifact |
| Supply chain issues | <5 medium |
| Race conditions | <2 medium |
| Tool abuse detection | 100% coverage |

---

*See also: `docs/distillation/cybersecurity-patterns.md`*