# Bug: Provider quota display truncated to "W..." during sub-agent runs

**Status:** FIXED via custom footer (`ctx.ui.setFooter`). See "Resolution" below.
**Severity:** Cosmetic
**Affected:** `src/extension/crew-vibes/` (provider quota renderer)
**Reporter:** user (live observation, 2026-07-09)

> Correction: the earlier "UNFIXABLE IN EXTENSION LAYER / WONTFIX" verdict was
> wrong on two counts. (1) The `spreadLine` U+00A0 full-width padding (from
> commit `f0baee9`) was described as "reverted attempt 1" but was in fact still
> ACTIVE and was the direct cause — it padded our row to the full terminal width
> using `process.stdout.columns` (which differs from pi's real render width),
> guaranteeing overflow and right-truncation of the quota. (2) Option A (custom
> footer) was never actually attempted; it is viable and is what the fix uses.

---

## Symptom

When pi-crew spawns sub-agents, the provider quota text in pi's footer
status bar is truncated. User reported seeing:

```
⚙ lr • MiniMax-M3 75k o Orbit                                                                             Minimax 5h ▬▬▬ 29% 1h6m W...
```

The `Wk ▬▬▬▬▬▬▬▬ 19% 1d4h` segment (weekly quota bar + percent + reset) is
chopped to just `W` followed by the dim ellipsis `...`.

## Root cause

`@earendil-works/pi-coding-agent` (pi) joins ALL extension statuses into
ONE footer line via `ctx.ui.setStatus()`, sorted alphabetically by key,
then calls `truncateToWidth(joined, width, "...")` if joined width
exceeds terminal width.

Source: `dist/modes/interactive/components/footer.js` lines 213–222:

```js
const sortedStatuses = Array.from(extensionStatuses.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, text]) => sanitizeStatusText(text));
const statusLine = sortedStatuses.join(" ");
lines.push(truncateToWidth(statusLine, width, theme.fg("dim", "...")));
```

Concretely, the joined line becomes:

```
pi-crew  + " " + pi-crew-bar  + " " + pi-crew-quota
(widget)    (capacity)          (provider quota)
```

When sub-agents spawn, `pi-crew` widget text (worker counts, queue,
model name — `statusSummary()` in `src/ui/widget/widget-model.ts`)
grows from ~10 chars to ~50-80 chars. The joined line exceeds terminal
width, and `truncateToWidth` chops the RIGHT side first — which is
where our provider quota lives. Result: weekly bar lost.

## Why naive fixes don't work

The extension knows only its OWN status text, not other extensions'
status texts. Several "obvious" fixes were attempted (all reverted):

### Attempt 1 — Right-align quota with U+00A0 padding

Prepend non-breaking spaces (U+00A0, which `sanitizeStatusText` does
not collapse) to push quota to the right edge of `process.stdout.columns`.

```ts
const cols = process.stdout.columns || 120;
const pad = Math.max(0, cols - quotaWidth - capWidth - 1);
const padded = capText + "\u00A0".repeat(pad) + quotaText;
setCapacityStatus(ctx, config, padded);
```

**Why it fails:** pad accounts for our row's own capacity+quota width
but NOT for `pi-crew` widget text or `pi-sub-bar` text that prepends
ours. When those grow during sub-agent spawn, joined line exceeds
cols and pi's `truncateToWidth` chops quota anyway.

### Attempt 2 — Subtract capacity width dynamically

Cache `lastCapacityText` so we know our own row's capacity width when
padding quota:

```ts
const capWidth = lastCapacityText ? visibleLen(lastCapacityText) : 0;
const pad = Math.max(0, cols - quotaWidth - capWidth - 1);
```

**Why it fails:** still doesn't account for `pi-crew` widget width or
other extensions' widths. Same overflow problem.

### Attempt 3 — Reserve buffer for other extensions

```ts
const otherReserve = Math.floor(cols * 0.5);
const pad = Math.max(0, cols - quotaWidth - capWidth - 1 - otherReserve);
```

**Why it fails:** heuristic, not exact. 50% may be too much (quota
gets pushed left and looks unbalanced) or too little (still overflows).
Padding is not "dynamic" in the sense of reacting to actual other
status widths.

### Attempt 4 — Split into widget via setWidget("...", [cap, quota])

`setWidget()` with `placement: "belowEditor"` renders a Container with
one Text component per array entry → 2 separate lines below editor,
not subject to joined status truncation.

**Why it fails:** moves the display out of the footer status bar to
below the editor. User wanted it in the footer (status bar), not in
a new visual zone.

## Viable fixes (none attempted; documenting for future)

### A. Custom footer via `setFooter(factory)`

Pi exposes `ctx.ui.setFooter((tui, theme, footerData) => Component)` —
extensions can replace the entire footer. The factory receives
`footerData.getExtensionStatuses()` so we still see other extensions'
statuses.

Implementation outline:
1. Build a custom `FooterComponent` that renders cwd + stats + our
   2 lines (capacity + quota right-aligned).
2. Call `ctx.ui.setFooter(factory)` on `session_start`.
3. On `session_shutdown`, call `ctx.ui.setFooter(undefined)` to restore
   pi's built-in footer.

Cost: ~150 LoC + need to mirror pi's built-in footer logic (cwd,
branch, token stats, model, etc.) so we don't lose any info.

### B. Patch pi-coding-agent upstream

Request that pi support multi-line extension status — e.g., add a
`setStatus(key, lines: string[])` overload that puts each entry on its
own line, OR a `setStatusLine(position, key, text)` that allows
pinning a status to line 1 vs line 2.

Cost: requires upstream PR + waiting for new pi release.

### C. Shorten quota to always fit

Drop the weekly bar entirely (or shrink to 1-2 chars). Quota becomes
`Minimax 5h 29%` (~15 chars). Even if `pi-crew` widget text is 80 chars
and capacity is 22 chars, total = 80+1+22+1+15 = 119, fits in 120 cols
usually.

Cost: loses reset timers and weekly bar visualization. User originally
wanted the bars.

## Why the 5 prior attempts all failed (same root cause)

All five fought the truncation from INSIDE `setStatus`, where an extension
cannot see (a) the `pi-crew` widget status width that grows during sub-agent
runs, (b) other extensions' widths, (c) pi's real render width, and where pi
always right-truncates the joined line:

- `81859e6` — split into `pi-crew-quota` key. pi joins all keys onto one line;
  quota still rightmost → still chopped. (Misdiagnosed as slot-overwrite.)
- `a74e453` — NBSP pad by `cols - quotaWidth - 1`. Ignores capacity + widget
  widths → overflow → chop.
- `a9eb30e` — NBSP pad by `cols - quotaWidth - capWidth - 1`. Still ignores the
  widget width and other extensions → overflow.
- `900737c` — `setWidget(belowEditor)` 2-line. Works (no truncation) but sits
  below the editor, not in the footer. Rejected.
- `5e56b63` — one status line + NBSP pad (`process.stdout.columns`). Same flaw
  as #2/#3, plus a width source that disagrees with pi's actual render width.

## Resolution (implemented)

Definitive fix = option A, **custom footer via `ctx.ui.setFooter(factory)`** —
the one approach none of the 5 attempts tried. It sidesteps every failure mode
above because the footer `Component`'s `render(width)` receives pi's REAL render
width and we own the line layout, so the meters get their own line(s) that the
join can never truncate.

- `src/extension/crew-vibes/footer.ts` — `CrewVibesFooter implements Component`.
  Reproduces pi's built-in footer lines (pwd/branch/session; token stats + cost
  + context% + model + thinking) from `ctx.sessionManager`/`ctx.model`/
  `ctx.getContextUsage()`/`footerData`, keeps other extensions' statuses on the
  joined line (still truncated, like pi), and renders **capacity + quota on a
  dedicated line** using the real width. When the terminal is too narrow, the
  meters wrap to two lines (capacity above, quota right-aligned below).
- `src/extension/crew-vibes/index.ts` — installs the footer on `session_start`
  (and re-install/remove in `applyConfig`), restores pi's built-in footer with
  `setFooter(undefined)` on disable/`session_shutdown`, drops the `spreadLine`
  padding, stores the raw provider-usage snapshot (rendered by the footer), and
  tracks thinking level via the `thinking_level_select` event.
- `src/ui/pi-ui-compat.ts` — added a guarded `setFooter()` wrapper (no-op on
  hosts that predate the API).

Accepted fidelity trade-offs (pi does not expose these to extensions):
- The `(auto)` compaction indicator is always shown (matches pi's default);
  the toggle state is not observable.
- Thinking level comes from `thinking_level_select`; before the first switch it
  shows the default ("off").

Proof: `test/unit/crew-vibes.test.ts` adds two tests — quota stays fully visible
while an overflowing status line is truncated, and the meters wrap to two lines
on a narrow terminal.

## How to revert fully

If you want to wipe all 5 reverted commits from history:

```bash
git revert f74adae 7588b26 0f0905d a61d5de dced96a  # the 5 reverts above
```

Or just leave them — they're labeled "Revert ..." so it's clear what
they undo.

## References

- pi footer rendering: `/home/bom/.nvm/versions/node/v22.23.1/lib/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/components/footer.js:213-222`
- pi truncateToWidth: `node_modules/@earendil-works/pi-tui/dist/utils.js:821`
- pi-crew widget status source: `src/ui/widget/widget-model.ts:77-99` (`statusSummary()`)
- crew-vibes provider rendering: `src/extension/crew-vibes/render.ts:158-194` (`renderProviderUsage()`)
- crew-vibes quota publish: `src/extension/crew-vibes/index.ts` (`publishProviderQuota()`)