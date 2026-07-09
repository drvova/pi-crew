# Bug: Provider quota display truncated to "W..." during sub-agent runs

**Status:** UNFIXABLE IN EXTENSION LAYER — needs upstream pi fix or workaround.
**Severity:** Cosmetic
**Affected:** `src/extension/crew-vibes/` (provider quota renderer)
**Reporter:** user (live observation, 2026-07-09)

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

## Decision

After 5 reverted attempts (commits 81859e6, a74e453, a9eb30e, 900737c,
5e56b63), the only fix that puts quota in the footer is option A
(custom footer) which is too invasive for a cosmetic bug. The
remaining options either change display location or lose info.

**Status: WONTFIX (in current state).** If a future user reports this
as a blocker, implement option A.

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