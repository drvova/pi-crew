# Deep Research: pi-powerbar

> Source: `Source/pi-powerbar/` — `@juanibiapina/pi-powerbar@0.9.1`
> Date: 2026-05-08

## 1. Tổng quan

`pi-powerbar` là Pi extension renders một powerline-style status bar ở dưới/trên editor.
Kiến trúc: **1 core renderer + N independent producers** — giao tiếp hoàn toàn qua events.

| Metric | Value |
|--------|-------|
| Package | `@juanibiapina/pi-powerbar@0.9.1` |
| Author | Juan Ibiapina (@juanibiapina) |
| Total LOC | 893 (src + test) |
| Extensions | 7 (1 core + 6 producers) |
| Dependencies | `pi-extension-settings`, `pi-sub-core` |
| Pi API surface | `ExtensionAPI`, `ExtensionContext`, `Theme`, `TUI`, `Component` |

## 2. Architecture Pattern — Event-Driven Producer/Consumer

### 2.1 Core Design

```
Producer extensions ──powerbar:update──▶ powerbar core
                                        ├── segment store (Map<id, Segment>)
                                        ├── render.ts (build single line)
                                        └── ctx.ui.setWidget (register with Pi TUI)
```

**Key insight**: Producer extensions KHÔNG import gì từ powerbar core.
Hợp đồng duy nhất: emit event `powerbar:update` với payload `{id, text?, suffix?, icon?, color?, bar?, barSegments?}`.

### 2.2 Multi-Extension Package

`package.json` khai báo:
```json
"pi": {
  "extensions": ["./dist", "node_modules/@marckrenn/pi-sub-core/index.ts"]
}
```

Pi auto-discovers tất cả `dist/*/index.js` → mỗi subdirectory là 1 extension độc lập.

### 2.3 Extension Lifecycle

| Event | Core | Git | Tokens | Context | Provider | Model | Sub |
|-------|------|-----|--------|---------|----------|-------|-----|
| init | registerSettings, on(update) | register-segment | register-segment | register-segment | register-segment | register-segment | register-segment |
| session_start | loadSettings, hideFooter, refresh | emitBranch | resetTokens | resetContext | emitProvider | emitModel | - |
| session_switch | (removed in 0.8.0) | - | - | - | - | - | - |
| tool_result | - | emitBranch | emitTokens | emitContext | - | - | - |
| turn_start | - | - | - | emitContext | emitProvider | emitModel | - |
| turn_end | - | - | emitTokens | emitContext | - | - | - |
| model_select | - | - | - | - | emitProvider | emitModel | - |
| sub-core:ready | - | - | - | - | - | - | emitUsage |
| sub-core:update-current | - | - | - | - | - | - | emitUsage |
| session_shutdown | clearWidget, cleanup | - | - | - | - | - | - |

## 3. Rendering System

### 3.1 Layout Algorithm (`render.ts`)

```
[icon text bar suffix] │ [icon text bar suffix] │ ...  ←→  [icon text bar suffix] │ ...
└──────── left side ─────────────────────────┘    └──────── right side ───────────┘
```

1. Read `left[]` and `right[]` from settings
2. Filter `Map<id, Segment>` → chỉ render segments listed in settings
3. Skip segments với no text + no suffix + no bar
4. Render mỗi segment: `[icon] [text] [bar] [suffix]`
5. Join mỗi side với separator (themed)
6. Pad middle → left flush-left, right flush-right
7. **Overflow**: Shrink widest segment(s) bằng `truncateToWidth` cho đến khi fit

### 3.2 Progress Bar Styles

**Continuous** (default trước 0.7.0):
```
██▎        ← █ filled + ▏▎▍▌▋▊▉ partial + space empty
```

**Blocks** (default từ 0.7.0):
```
▁ ▂ ▃ ▄ ▅ ▆ ▇ █ ← partial-height glyphs
```
- Mỗi block có dim background track + filled glyph
- `barSegments` hint: số discrete blocks (e.g. sub-hourly=5, sub-weekly=7)
- Trông giống pi-sub visual style

### 3.3 Widget Lifecycle

```typescript
// Core: on session_start
ctx.ui.setWidget("powerbar", (tui, theme) => ({
  render(width): string[] {
    return [renderBar(segments, settings, theme, width)];
  },
  invalidate() {},
}), { placement: settings.placement });
```

Pi TUI gọi `render(width)` khi cần vẽ lại. Powerbar không cache — re-renders every time.
`invalidate()` rỗng vì không có cached state.

### 3.4 Footer Hiding

Core extension ẩn Pi's default footer:
```typescript
ctx.ui.setFooter(() => ({ render(): string[] { return []; }, invalidate() {} }));
```
Vì powerbar đã hiển thị model, tokens, context — footer là redundant.

## 4. Settings System

### 4.1 pi-extension-settings Integration

Settings được register qua event:
```typescript
pi.events.emit("pi-extension-settings:register", {
  name: "powerbar",
  settings: definitions,
});
```

### 4.2 Dynamic Segment Catalog

Producers register segments dynamic:
```typescript
pi.events.emit("powerbar:register-segment", { id: "git-branch", label: "Git Branch" });
```

Core lắng nghe → adds to catalog → re-registers settings với updated options.
Điều này cho phép **external producers** (từ packages khác) thêm segments vào settings menu!

### 4.3 Configuration Values

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| left | ordered-list | `git-branch,tokens,context-usage` | Left side segment IDs |
| right | ordered-list | `provider,model,sub-hourly,sub-weekly` | Right side segment IDs |
| separator | select | ` │ ` | Between-segment separator |
| placement | select | `belowEditor` | Widget placement |
| bar-style | select | `blocks` | `continuous` or `blocks` |
| bar-width | select | `10` | 4–24 chars |

## 5. Key Design Patterns Worth Noting

### 5.1 Dedup/No-op Detection (v0.9.1)

```typescript
function segmentEquals(left: Segment | undefined, right: Segment): boolean {
  return left?.text === right.text && ...;
}
```

Core skip re-render nếu payload identical → giảm widget churn từ chatty producers.

### 5.2 No Import Coupling

Producers biết:
- Event name: `"powerbar:update"` and `"powerbar:register-segment"`
- Payload shape: `{id, text?, suffix?, icon?, color?, bar?, barSegments?}`

Core biết:
- Event name: `"powerbar:update"`
- How to render a `Segment`

→ **Zero coupling**. External extensions có thể emit `powerbar:update` mà không cần install pi-powerbar.

### 5.3 Safe Segment Deletion

```typescript
if (!payload.text && payload.bar === undefined) {
  segments.delete(payload.id);
}
```

Delete khi cả text lẫn bar đều absent. Điều này cho phép segment với chỉ suffix (no text).

### 5.4 fgToBgAnsi Hack for Blocks

```typescript
function fgToBgAnsi(fgAnsi: string): string {
  return fgAnsi.replace("\x1b[38;", "\x1b[48;");
}
```

Blocks mode cần dim background → convert foreground ANSI escape to background.
Direct ANSI manipulation thay vì dùng theme API — workaround cho missing theme API.

### 5.5 Sub-Core Event Selection (v0.9.1)

Chỉ listen `sub-core:update-current`, bỏ `sub-core:update-all`:
- `update-all` filters entries by cache TTL → current provider có thể missing
- `update-current` luôn authoritative cho current provider
- Fix: https://github.com/marckrenn/pi-sub/issues/58

## 6. Comparison: pi-powerbar vs pi-crew Powerbar Publisher

| Aspect | pi-powerbar (standalone) | pi-crew `powerbar-publisher.ts` |
|--------|--------------------------|----------------------------------|
| Role | Full powerbar renderer + producers | Producer only (emits `powerbar:update`) |
| Rendering | Owns widget, renders bar, left/right layout | No rendering — delegates to pi-powerbar |
| Segments | 6 built-in (git, tokens, context, provider, model, sub) | 2 segments (pi-crew-active, pi-crew-progress) |
| Settings | Full settings system via pi-extension-settings | Config via pi-crew config |
| Event usage | Both emits and consumes `powerbar:*` | Only emits `powerbar:update` and `powerbar:register-segment` |
| Coalescing | No coalescing (dedup only) | `RenderCoalescer` 200ms batching |
| Fallback | Widget-based | Status fallback when no powerbar consumer |
| Overflow | Shrinks widest segment | N/A (doesn't render) |
| Progress bars | Continuous + blocks styles | N/A |
| LOC | 893 total | 176 single file |

**pi-crew là một PRODUCER** cho pi-powerbar — đúng pattern. pi-crew emit `powerbar:update` events, pi-powerbar renders chúng.

## 7. Code Quality Assessment

### 7.1 Strengths

1. **Clean separation of concerns** — producer/consumer pattern executed perfectly
2. **Zero coupling** — producers don't import from core
3. **Dynamic segment catalog** — external extensions can register segments
4. **Dedup rendering** — no-op detection prevents churn
5. **Overflow handling** — shrink widest segment instead of crash
6. **Comprehensive test** — powerbar-sub has 5 targeted tests covering edge cases
7. **Good documentation** — PROMPT.md is excellent architecture doc
8. **Theme-aware rendering** — all colors go through Pi theme API

### 7.2 Potential Issues / Observations

1. **No error handling in producer event handlers**: Producers use `as` casts without validation:
   ```typescript
   const { id, label } = data as SegmentRegistration;
   ```
   If malformed event → silent crash. Low risk vì events are internal.

2. **Synchronous file reads**: `powerbar-git` uses `readFileSync` trong event handler.
   Acceptable vì chỉ đọc `.git/HEAD` (tiny file).

3. **No caching in core**: `refresh()` creates a new widget component every time.
   Widget re-renders fully on every `powerbar:update`. OK vì only 1 line to render.

4. **`currentCtx` closure pattern**: Core stores `currentCtx` in module scope.
   Works but not GC-friendly — ctx holds reference until `session_shutdown`.

5. **`loadSettings()` on every session_start**: No caching across sessions.
   Acceptable vì settings có thể change between sessions.

6. **No test coverage for core render.ts**: Tests only cover powerbar-sub.
   Render logic (progress bars, overflow, truncation) untested.

7. **`fgToBgAnsi` string replacement**: Relies on specific ANSI escape format.
   Fragile if Pi theme implementation changes.

### 7.3 Missing Features (opportunities)

1. **No click/interaction**: Segments không clickable. Could add `onClick` callback.
2. **No tooltip**: Segments không có hover info.
3. **No animation**: Progress bars không animate (only static rendering).
4. **No priority system**: Khi overflow, shrink widest — không có segment priority.
5. **No segment grouping**: Không có sub-segments hoặc nested layout.
6. **No conditional visibility**: Segments visible/invisible chỉ qua text=undefined.
   Không có min-width, collapse-threshold, etc.

## 8. Lessons for pi-crew

### 8.1 Patterns to Adopt

1. **Dedup detection** — pi-crew's `requestPowerbarUpdate` coalesces 200ms nhưng không skip identical payloads. Adding segmentEquals check would further reduce churn.

2. **Dynamic segment registration** — pi-crew already uses `powerbar:register-segment` (correct pattern).

3. **Overflow shrinking** — If pi-crew ever renders its own bar, use the shrink-widest algorithm.

4. **Event-only coupling** — pi-crew's powerbar-publisher already follows this pattern (emit-only).

### 8.2 pi-crew Powerbar Publisher Improvements

1. **Add dedup check**: Skip `updatePiCrewPowerbar()` if segment data unchanged.
   ```typescript
   // Before emitting, compare with last emitted state
   if (lastActiveText === activeText && lastProgressSuffix === progressSuffix) return;
   ```

2. **Use barSegments hint**: pi-crew progress bar currently sends `barSegments: 8`.
   Could make dynamic: `Math.min(total, 10)` for better visual scaling.

3. **Color transitions**: pi-crew uses fixed colors. Could add threshold-based:
   - progress < 50% → accent
   - progress 50-80% → warning  
   - progress > 80% → error
   - complete → success

### 8.3 Potential Integration Points

1. **pi-crew team status as powerbar segment**: Already done (`pi-crew-active`, `pi-crew-progress`).

2. **Agent health in powerbar**: Could add `pi-crew-health` segment showing dead/stale agents.

3. **Run cost in powerbar**: Could add `pi-crew-cost` segment showing cumulative token cost.

4. **Multi-run summary**: Could show "3 runs, 7/12 agents done" instead of single-run progress.

## 9. File Map

```
Source/pi-powerbar/
├── src/
│   ├── powerbar/               # Core renderer
│   │   ├── index.ts (125 lines) — event listener + widget + footer hiding
│   │   ├── render.ts (216 lines) — layout algorithm + progress bars
│   │   └── settings.ts (94 lines) — pi-extension-settings integration
│   ├── powerbar-git/           # Git branch producer
│   │   └── index.ts (55 lines) — reads .git/HEAD
│   ├── powerbar-tokens/        # Token stats producer
│   │   └── index.ts (65 lines) — sums session entries
│   ├── powerbar-context/       # Context usage producer
│   │   └── index.ts (51 lines) — progress bar with color thresholds
│   ├── powerbar-provider/      # Provider name producer
│   │   └── index.ts (35 lines) — shows provider from ctx.model
│   ├── powerbar-model/         # Model name producer
│   │   └── index.ts (44 lines) — model + thinking level
│   └── powerbar-sub/           # Subscription usage producer
│       └── index.ts (74 lines) — sub-core integration
├── test/
│   └── powerbar-sub.test.js (134 lines) — 5 unit tests
├── PROMPT.md                   # Architecture doc (excellent)
├── AGENTS.md                   # Build/check instructions
└── package.json                # Multi-extension package
```

## 10. Summary

`pi-powerbar` là một exemplar của clean extension architecture:
- **Producer/Consumer** pattern với zero coupling
- **Event-driven** communication — bất kỳ extension nào cũng có thể participate
- **Dynamic segment discovery** — catalog grows as producers register
- **Theme-aware rendering** — respects Pi's theme system
- **Overflow-safe** — graceful degradation on narrow terminals

pi-crew's `powerbar-publisher.ts` đã follow đúng pattern này (producer-only, emit events).
Phù hợp để làm reference implementation cho bất kỳ Pi extension nào muốn hiển thị data trên powerbar.
