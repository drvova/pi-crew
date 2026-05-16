Now I have a thorough understanding of the spec, the pi-crew extension pattern, the Pi ExtensionAPI, and the test conventions. Let me produce the plan.

---

# Implementation Plan: pi-memory Extension

## Summary

Implement the **pi-memory** extension fully per `SPEC.md` at `/home/bom/source/my_pi/docs/extensions/pi-memory/SPEC.md`, creating all files under `/home/bom/source/my_pi/pi-memory/`. The extension follows the pi-crew pattern: a minimal `index.ts` entry point delegates to `src/extension/register.ts`, which wires hooks, tools, and commands via the `ExtensionAPI`.

---

## Architecture Overview

```
pi-memory/
├── index.ts                           # Extension entry point (like pi-crew/index.ts)
├── src/
│   ├── extension/
│   │   └── register.ts                # Main registration (hooks, tools, commands)
│   ├── store/
│   │   ├── sqlite.ts                  # SQLite database manager (open, close, pragmas)
│   │   ├── schema.ts                  # Table creation, migrations, index management
│   │   ├── fts5-index.ts              # Dual FTS5 indexing (porter + trigram)
│   │   ├── search.ts                  # BM25 scoring, RRF fusion, proximity reranking
│   │   ├── vocabulary.ts              # Term frequency tracking
│   │   └── events.ts                  # Session event tracking (CRUD on events table)
│   ├── memory/
│   │   ├── hierarchical.ts            # PI_MEMORY.md + .pi-memory/ file management
│   │   ├── mental-models.ts           # Named curated summaries (auto-seed, refresh)
│   │   ├── recall.ts                  # Progressive disclosure recall (3 budget levels)
│   │   ├── retain.ts                  # Memory storage with deduplication
│   │   └── reflect.ts                 # Consolidation + garbage collection
│   ├── compound/
│   │   ├── analyzer.ts                # Session analysis at shutdown
│   │   ├── extractor.ts               # Solution extraction (bug/knowledge/decision)
│   │   ├── router.ts                  # Route findings to bug/knowledge/decision types
│   │   ├── dedup.ts                   # 5-dimension overlap assessment
│   │   └── writer.ts                  # YAML frontmatter writer (.pi-memory/solutions/)
│   ├── continuity/
│   │   ├── tracker.ts                 # Track edits, errors, decisions per session
│   │   ├── resumer.ts                 # Session resume context builder
│   │   └── compaction-hook.ts         # preCompactionContext handler
│   ├── tools/
│   │   ├── memory-search.ts           # memory_search tool handler
│   │   ├── memory-store.ts            # memory_store tool handler
│   │   ├── memory-recall.ts           # memory_recall tool handler
│   │   └── memory-status.ts           # memory_status tool handler
│   └── config.ts                      # Extension config loader + defaults
├── skills/
│   ├── memory-search/                 # Skill file for memory search
│   ├── memory-store/                  # Skill file for memory store
│   └── compound-note/                 # Skill file for compound notes
├── test/
│   └── unit/
│       ├── sqlite.test.ts             # SQLite open/close/schema tests
│       ├── fts5-index.test.ts         # Dual-index accuracy tests
│       ├── search.test.ts             # RRF + proximity reranking tests
│       ├── progressive-disclosure.test.ts  # Budget-level recall tests
│       ├── compounding.test.ts        # Session analysis → solution extraction tests
│       ├── dedup.test.ts              # 5-dimension overlap tests
│       ├── anti-feedback.test.ts      # Wrapper tag format tests
│       ├── session-continuity.test.ts  # Resume context tests
│       ├── mental-models.test.ts      # Auto-seed, refresh, budget tests
│       ├── config.test.ts             # Config loading/validation tests
│       └── hierarchical.test.ts       # PI_MEMORY.md generation tests
├── package.json
└── tsconfig.json
```

---

## File Creation Order (Topological by Dependency)

### Phase 1: Scaffolding + Core Store (no runtime dependencies)

| # | File | Purpose | Dependencies | Est. LOC |
|---|------|---------|-------------|----------|
| 1 | `package.json` | Package manifest. `better-sqlite3` as dependency. Peer deps on `@mariozechner/pi-coding-agent`. `"pi": { "extensions": ["./index.ts"], "skills": ["./skills"] }` | None | ~60 |
| 2 | `tsconfig.json` | Same structure as pi-crew's tsconfig | None | ~15 |
| 3 | `src/config.ts` | Config types + loader. Reads `.pi/pi-memory.json`. Default values per SPEC §11. Validates with typebox. | None | ~200 |
| 4 | `src/store/schema.ts` | SQL DDL for all tables (sources, chunks, chunks_trigram, vocabulary, events, solutions, mental_models) + indexes + pragmas. Export `initSchema(db)` function. | None | ~120 |
| 5 | `src/store/sqlite.ts` | `MemoryDB` class: open/close DB, WAL mode, backup on write, connection management. Takes project cwd → `.pi-memory/memory.db`. | schema.ts | ~100 |
| 6 | `src/store/fts5-index.ts` | `indexContent(db, sourceId, title, content, category)` and `removeFromIndex(db, sourceId)`. Inserts into both chunks and chunks_trigram. | sqlite.ts (types) | ~80 |
| 7 | `src/store/vocabulary.ts` | Term frequency tracking. `updateVocabulary(db, terms)` and `getVocabStats(db, term)`. | sqlite.ts (types) | ~60 |
| 8 | `src/store/events.ts` | Event CRUD: `logEvent(db, sessionId, type, data)`, `getSessionEvents(db, sessionId)`, `getRecentEvents(db, limit)`. | sqlite.ts (types) | ~80 |
| 9 | `src/store/search.ts` | Core search: `porterSearch(db, query, limit)`, `trigramSearch(db, query, limit)`, `rrf(porter, trigram, K)`, `proximityRerank(results, query)`, `search(db, query, opts)`. | sqlite.ts (types) | ~150 |

### Phase 2: Memory Layer

| # | File | Purpose | Dependencies | Est. LOC |
|---|------|---------|-------------|----------|
| 10 | `src/memory/hierarchical.ts` | `ensurePiMemoryDir(cwd)`, `generatePIMemoryMd(db, cwd)`, `updateMarkdownFile(cwd, name, content)`, `readMarkdownFile(cwd, name)`. Manages `.pi-memory/` directory and `PI_MEMORY.md`. | store/* | ~150 |
| 11 | `src/memory/retain.ts` | `storeMemory(db, opts)` → inserts into sources table + FTS5 indexing + category-specific markdown updates. | store/*, hierarchical.ts | ~120 |
| 12 | `src/memory/recall.ts` | `recallMemories(db, context, budget)` → progressive disclosure: Level 0 (2KB), Level 1 (10KB), Level 2 (full). Anti-feedback wrapper: `<memories>` tag pattern. | store/search.ts | ~120 |
| 13 | `src/memory/mental-models.ts` | `autoSeedModels(db)`, `refreshMentalModel(db, name)`, `getMentalModel(db, name)`, `renderMentalModel(model)` → `<mental_model>` XML tags. | store/* | ~140 |
| 14 | `src/memory/reflect.ts` | `consolidateMemories(db)` → garbage collection: prune old events, recompute mental models, compact solutions. | store/*, mental-models.ts | ~100 |

### Phase 3: Compounding Engine

| # | File | Purpose | Dependencies | Est. LOC |
|---|------|---------|-------------|----------|
| 15 | `src/compound/router.ts` | `routeFinding(events)` → classify as bug/knowledge/decision based on event patterns. | store/events.ts | ~60 |
| 16 | `src/compound/extractor.ts` | `extractBugSolution(error, fix)`, `extractKnowledge(pattern)`, `extractDecision(decision)`. Returns structured solution objects. | store/events.ts | ~100 |
| 17 | `src/compound/dedup.ts` | `OverlapAssessment` interface, `assessOverlap(newSol, existingSol)`, `shouldDedup(overlap)` → weighted 5-dim check at 0.7 threshold. Uses FTS5 for text similarity + file set intersection. | store/search.ts | ~100 |
| 18 | `src/compound/writer.ts` | `writeSolution(cwd, solution)` → YAML frontmatter file in `.pi-memory/solutions/`. `readSolution(path)` → parse YAML. | hierarchical.ts | ~100 |
| 19 | `src/compound/analyzer.ts` | `analyzeSession(db, cwd)` → orchestrates: error pattern extraction, decision extraction, pattern extraction, dedup check, write solutions. Called at `session_shutdown`. | router.ts, extractor.ts, dedup.ts, writer.ts | ~150 |

### Phase 4: Session Continuity

| # | File | Purpose | Dependencies | Est. LOC |
|---|------|---------|-------------|----------|
| 20 | `src/continuity/tracker.ts` | `createSessionTracker(db, sessionId)` → returns `{trackEdit(file, turn)`, `trackError(tool, msg, turn)`,
[pi-crew compacted 9370 chars]
