=== Task 1: 01_explore (explorer) ===
Status: COMPLETED
Role: explorer
Result artifact: /home/bom/source/my_pi/pi-crew/.crew/artifacts/team_20260512045415_6b1c0a089e3c3713/results/01_explore.txt
Log artifact: /home/bom/source/my_pi/pi-crew/.crew/artifacts/team_20260512045415_6b1c0a089e3c3713/logs/01_explore.log
Transcript: /home/bom/source/my_pi/pi-crew/.crew/artifacts/team_20260512045415_6b1c0a089e3c3713/transcripts/01_explore.jsonl
Usage: {"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"cost":0,"turns":0}
(no output)

=== Task 2: 02_plan (planner) ===
Status: COMPLETED
Role: planner
Result artifact: /home/bom/source/my_pi/pi-crew/.crew/artifacts/team_20260512045415_6b1c0a089e3c3713/results/02_plan.txt
Log artifact: /home/bom/source/my_pi/pi-crew/.crew/artifacts/team_20260512045415_6b1c0a089e3c3713/logs/02_plan.log
Transcript: /home/bom/source/my_pi/pi-crew/.crew/artifacts/team_20260512045415_6b1c0a089e3c3713/transcripts/02_plan.jsonl
Usage: {"input":30719,"output":4340,"cacheRead":228928,"cacheWrite":0,"cost":0,"turns":0}
Now I have all the information needed. Let me create the comprehensive implementation plan.

---

# Implementation Plan: pi-web-research Extension

## Overview

Create a new standalone Pi extension at `/home/bom/source/my_pi/pi-web-research/` that provides web search, content fetching/extraction, and deep research capabilities. The extension follows the same patterns as `pi-crew` and `pi-memory` (minimal `index.ts`, registration in `src/extension/register.ts`, tools via `pi.registerTool`, commands via `pi.registerCommand`, events via `pi.on`).

---

## File Structure (30 files total)

```
pi-web-research/
├── index.ts                           # Entry point — delegates to register
├── package.json                       # Dependencies: better-sqlite3, typebox, linkedom (HTML parsing)
├── tsconfig.json                      # ES2022, NodeNext, strict — same as pi-memory
├── README.md                          # Usage docs
├── src/
│   ├── config.ts                      # Load .pi/pi-web-research.json config
│   ├── extension/
│   │   └── register.ts                # Main registration (tools, commands, events)
│   ├── search/
│   │   ├── engine.ts                  # SearchEngine interface + SearchResult type
│   │   ├── brave.ts                   # Brave Search API implementation
│   │   ├── gemini.ts                  # Google Gemini search implementation
│   │   ├── exa.ts                     # Exa AI search implementation
│   │   ├── duckduckgo.ts             # DuckDuckGo HTML-scrape fallback (no API key)
│   │   └── fallback-chain.ts         # Ordered fallback across providers
│   ├── extract/
│   │   ├── fetcher.ts                # HTTP fetch + raw HTML/text retrieval
│   │   ├── extractor.ts             # HTML → text/markdown extraction (linkedom)
│   │   ├── github.ts                # GitHub URL-specific extraction
│   │   └── budget.ts                # Token counting + truncation enforcement
│   ├── research/
│   │   ├── mode.ts                  # Research orchestrator (search→fetch→synthesize)
│   │   ├── synthesize.ts            # Multi-source synthesis logic
│   │   └── report.ts                # Report formatting (summary, findings, citations)
│   ├── cache/
│   │   ├── store.ts                 # SQLite-based content cache
│   │   └── dedup.ts                 # URL deduplication + staleness checks
│   ├── tools/
│   │   ├── web_search.ts            # web_search tool handler
│   │   ├── web_fetch.ts             # web_fetch tool handler
│   │   └── web_research.ts          # web_research tool handler
│   └── types.ts                     # Shared types and interfaces
└── test/
    └── unit/
        ├── fallback-chain.test.ts    # Fallback ordering, skip unavailable, all-fail
        ├── extractor.test.ts         # HTML → text/markdown, noise removal, selector
        ├── budget.test.ts            # Token counting, truncation, boundary cases
        ├── github.test.ts            # URL pattern parsing, README/issue/PR extraction
        ├── cache-store.test.ts       # Store/retrieve, TTL expiry, size limit
        ├── dedup.test.ts             # URL normalization + dedup logic
        ├── synthesize.test.ts        # Multi-source merge, contradiction detection
        ├── report.test.ts            # Report format validation
        ├── config.test.ts            # Config loading, defaults, env var fallback
        └── web-search-tool.test.ts   # Tool handler integration with mock engine
```

---

## Implementation Order (6 Phases)

### Phase 1: Scaffolding + Config + Types (3 files)
**Files:** `package.json`, `tsconfig.json`, `index.ts`, `src/types.ts`, `src/config.ts`
**Dependencies:** None (foundation)

| Step | Description |
|------|-------------|
| 1.1 | Create `package.json` with deps: `better-sqlite3`, `typebox`, `linkedom` (zero-dependency HTML parser). Peer dep: `@mariozechner/pi-coding-agent`. Test runner: `node:test` + `node:assert/strict` (same as pi-memory). |
| 1.2 | Create `tsconfig.json` — copy from pi-memory (ES2022, NodeNext, strict). |
| 1.3 | Create `index.ts` — minimal entry: `export default function(pi) { registerPiWebResearch(pi); }` |
| 1.4 | Create `src/types.ts` — define `SearchResult`, `ExtractedContent`, `ResearchReport`, `CacheEntry`, `ConfigSchema` interfaces. |
| 1.5 | Create `src/config.ts` — load `.pi/pi-web-research.json`, merge defaults, resolve API keys from config or env vars (`BRAVE_API_KEY`, `GEMINI_API_KEY`, `EXA_API_KEY`). Validate with typebox. |

**Validation:** `npm run typecheck` passes.

---

### Phase 2: Search Layer (6 files)
**Files:** `src/search/engine.ts`, `src/search/brave.ts`, `src/search/gemini.ts`, `src/search/exa.ts`, `src/search/duckduckgo.ts`, `src/search/fallback-chain.ts`
**Dependencies:** Phase 1 (types)

| Step | Description |
|------|-------------|
| 2.1 | `engine.ts` — Define `SearchEngine` interface: `{ name, isAvailable(), search(query, opts) => SearchResult[] }`. Define `SearchResult` with `{ title, url, snippet, source, date? }`. |
| 2.2 | `brave.ts` — Implement `SearchEngine` using Brave Search API (`https://api.search.brave.com/res/v1/web/search`). Requires API key. Returns parsed results. |
| 2.3 | `gemini.ts` — Implement using Gemini API with search grounding. Requires API key. |
| 2.4 | `exa.ts` — Implement using Exa API (`https://api.exa.ai/search`). Requires API key. |
| 2.5 | `duckduckgo.ts` — Implement as HTML scrape fallback (no API key). Parse DDG HTML results. Rate-limited, last resort. |
| 2.6 | `fallback-chain.ts` — Given config `fallbackChain: string[]`, iterate engines in order. Skip engines where `isAvailable()` returns false (no API key). If engine errors, catch and try next. Return empty array with suggestion if all fail. |

**Validation:** Unit tests for fallback-chain (mock engines), each engine in isolation.

**Risks:**
- DuckDuckGo HTML structure may change — document this fragility, add selector tests
- API rate limits — fallback-chain must handle 429 gracefully

---

### Phase 3: Extraction Layer (4 files)
**Files:** `src/extract/fetcher.ts`, `src/extract/extractor.ts`, `src/extract/github.ts`, `src/extract/budget.ts`
**Dependencies:** Phase 1 (types)

| Step | Description |
|------|-------------|
| 3.1 | `fetcher.ts` — HTTP GET with configurable timeout, User-Agent. Return raw HTML/text. Handle redirects, content-type detection. Use Node.js built-in `fetch` (available in Node 18+). |
| 3.2 | `extractor.ts` — Use `linkedom` (zero-dependency DOM parser) to: (a) strip noise elements (script, style, nav, ads), (b) optionally apply CSS selector, (c) find main content via heuristic (largest text block / article tag), (d) convert to text/markdown/html. |
| 3.3 | `github.ts` — Pattern-match GitHub URLs: `/owner/repo` → fetch README via GitHub raw API + file tree via GitHub API. `/blob/` → file content. `/issues/N` → issue + comments. `/pull/N` → PR description + changed files. `/wiki` → wiki content. Use GitHub REST API (no auth required for public repos, rate-limited without token). |
| 3.4 | `budget.ts` — Token estimation: ~4 chars per token. `enforceBudget(content, maxTokens)` → truncate with `[... truncated at N chars ...]` message. Return `{ content, truncated, originalLength, finalLength }`. |

**Validation:** Unit tests for extraction (provide HTML fixtures), GitHub URL parsing, budget enforcement at boundaries.

**Risks:**
- `linkedom` may not handle all real-world HTML — test with diverse fixtures
- GitHub API rate limit (60/hr unauthenticated) — consider caching aggressively

---

### Phase 4: Cache Layer (2 files)
**Files:** `src/cache/store.ts`, `src/cache/dedup.ts`
**Dependencies:** Phase 1 (types, config)

| Step | Description |
|------|-------------|
| 4.1 | `store.ts` — SQLite-based cache via `better-sqlite3`. Table: `cache_entries(url TEXT PK, content TEXT, content_type TEXT, fetched_at INTEGER, expires_at INTEGER, size_bytes INTEGER)`. Methods: `get(url)`, `set(url, content, contentType, ttl)`, `clear()`, `cleanExpired()`, `getSizeBytes()`. Stored at `.pi/web-research-cache/cache.db`. |
| 4.2 | `dedup.ts` — URL normalization: lowercase scheme+host, strip trailing slash, sort query params, strip tracking params (`utm_*`, `fbclid`, etc.)
[pi-crew compacted 6184 chars]