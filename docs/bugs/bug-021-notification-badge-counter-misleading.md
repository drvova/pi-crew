# Bug Report: Notification Bell Badge Misread as "Queued Messages"

**Date:** 2026-06-29
**Severity:** Medium (UX / User Confusion — no data loss, no functional impact)
**Status:** Partially fixed (Option A + Option B-display applied 2026-06-29; decay / owner-scope / auto-reset / deprecation remain open product decisions)
**Reporter:** User investigation session (manual triage)
**Related:** `docs/bugs/cross-session-notification-leakage.md` (related but distinct —
  that one filters notifications *delivered* across sessions; this one accumulates
  the badge count without decay regardless of session ownership)
**Affects:** pi-crew widget header + powerbar segment (`pi-crew-active`)

---

## Summary

The `🔔N` bell badge shown in the crew widget header (and the equivalent
`pi-crew-active` powerbar segment) is the **cumulative notification counter**
(`widgetState.notificationCount`), not a message-queue size. Users reading the
bell icon as "queued messages" conclude there are hundreds of pending items
when in fact:

- Actual `status === "queued"` agents across all runs: **0**
- Actual `status === "queued"` tasks across all `tasks.json`: **0**
- Mailbox unread (inbox) messages: **0** (no `mailbox/inbox.jsonl` exists)
- Live in-memory agents (`listActiveLiveAgents`): **0**

The "227" observed during investigation is therefore a stale cumulative count,
not a backlog. This file documents the data path, why it accumulates without
bound, and the three fix options.

---

## Symptom

| Surface | What user sees | What it actually is |
|---|---|---|
| Crew widget header (above editor) | `⠋ Crew agents🔔227 · 1 running · 0/1 done · /team-dashboard` | Cumulative warning/error notification count since pi session start |
| pi powerbar segment `pi-crew-active` | `⚙ 1 running · 🔔227 · <model> · 30k` | Same counter, rendered via `notificationBadge()` |
| Widget "X queued" sub-string | **Not shown** (suppressed when count is 0) | Would be from `agents.filter(a => a.status === "queued")` |

User paraphrase: *"agents are running — why are there 227 queued messages?"*
— the bell icon is interpreted as a message-queue indicator.

### Reproduction

1. Start a long-running pi session that processes many background subagents
   (e.g. porting work that spawns 100+ `executor` subagents via `team` runs).
2. Wait for a meaningful number of `subagent-completed` notifications to be
   delivered (the `info` severity is filtered out; only `warning`/`error`/
   `critical` increment the counter).
3. Open the widget header. Bell badge shows e.g. `🔔184` (today's count) or
   `🔔227` if the session has been alive longer.
4. Confirm queue is actually empty by running `/team-dashboard` and reading
   the agents-pane `Counts` line — it reads `running=1, queued=0, recent=0`.

---

## Root Cause

### Counter increment path

`src/extension/register.ts:308-309` (inside `configureNotifications` callback):

```ts
widgetState.notificationCount =
  (widgetState.notificationCount ?? 0) + 1;
```

The counter lives in the `CrewWidgetState` closure for the lifetime of the pi
process. It is reset only by:

- `dismissNotifications()` action — `src/extension/register.ts:2146-2164` →
  `widgetState.notificationCount = 0;`
- Pi process restart.

There is **no decay, no per-run scoping, no acknowledgement**.

### Display path

`src/ui/widget/widget-renderer.ts:35-44` — `widgetHeader()`:

```ts
export function widgetHeader(runs: WidgetRun[], runningGlyph: string, maxLines = 20, notificationCount = 0): string {
  // …running/queued/waiting/done counts…
  return `${runningGlyph} Crew agents${notificationBadge(notificationCount)} · ${parts.join(" · ")} · /team-dashboard`;
}
```

`src/ui/widget/widget-formatters.ts:147-152` — `notificationBadge()`:

```ts
export function notificationBadge(count: number | undefined, env: NodeJS.ProcessEnv = process.env): string {
  if (!count || count <= 0) return "";
  const term = `${env.TERM ?? ""} ${env.WT_SESSION ?? ""} ${env.TERM_PROGRAM ?? ""}`.toLowerCase();
  const supportsEmoji = !term.includes("dumb") && env.NO_COLOR !== "1";
  return supportsEmoji ? ` 🔔${count}` : ` [!${count}]`;
}
```

`src/ui/powerbar-publisher.ts:125` — same value is broadcast to the
`pi-crew-active` powerbar segment via `notificationText`.

### Severity filter that creates the asymmetry

`src/config/defaults.ts:100` — `DEFAULT_NOTIFICATIONS.severityFilter` excludes
`info`. Re-applied at:

- `src/extension/register.ts:301-303`
- `src/extension/notification-router.ts:12, 90`

Today's `.crew/state/notifications/2026-06-29.jsonl` for the project where
this was reported:

| Severity | Count | Increments badge? |
|---|---|---|
| `info` | 88 | **No** (filtered) |
| `warning` | 184 | **Yes** |
| `error` | (subset of warning) | Yes |
| `critical` | (rare) | Yes |

Source breakdown: 270 `subagent-completed` + 2 `run-maintenance`. The 184
warnings map to: 171 `subagent-error` + 7 `subagent-failed` + 6
`subagent-cancelled` — i.e. almost entirely **"Child Pi worker became
unresponsive and was terminated"** events from background runs.

The remaining ~43 (227 − 184) come from earlier in the session or from
non-`subagent-completed` sources (`subagent-stuck`, `health`,
`crash-recovery`) — see `notifyOperator` call sites in
`src/extension/register.ts` lines 455, 497, 532, 727, 759, 786, 1388, 1410,
1437, 1453, 1479, 1500, 1519, 1848.

### Owner-scoped filtering is incomplete

`src/extension/register.ts:769-775` correctly gates `subagent.stuck-blocked`
on `isOwnerSessionCurrent`, but the bulk `subagent-completed` notifications
at lines 753-761 and the `crew.subagent.completed` event hooks are **not
owner-scoped at the `notifyOperator` level**. A long-lived pi session
accumulates counts from older `ownerSessionGeneration`s. (This is the
behavioural cousin of `cross-session-notification-leakage.md`, but applies
to the badge counter rather than the notification router deliver path.)

### Cache pin risk

`src/ui/widget/index.ts:108-128` — `CrewWidgetComponent.cacheSignature`
includes `:${this.model.notificationCount ?? 0}`. The header line is
re-rendered every tick from `cachedBaseLines` with the spinner-glyph swap
(lines 171-174), but the `🔔N` segment is part of the cached header text.
If no event-bus signal invalidates the cache (`run:state` / `worker:lifecycle`
/ `ui:invalidate` per lines 104-107), the displayed number can persist even
when the underlying counter has changed.

---

## Why no other surface shows 227

Verified each candidate reader:

| Reader | Source | Reads as |
|---|---|---|
| `widget-renderer.ts:37` | `agents.filter(a => a.status === "queued")` | **0** |
| `widget-model.ts:72` | `agents.filter(a => a.status === "queued" \|\| a.status === "waiting")` | **0** |
| `widget-model.ts:69 statusSummary` | same `agents` array | **0** |
| `powerbar-publisher.ts:119` | `tasks.filter(t => t.status === "queued" \|\| t.status === "waiting")` | **0** |
| `dashboard-panes/mailbox-pane.ts:8` | `mailbox/inbox.jsonl` | no file → 0 |
| `live-run-sidebar.ts:188` | tasks.json waiting | **0** |
| `agents-pane.ts` `groups.queued` | agent records | **0** |
| `.crew/state/subagents/*.json` | legacy records (271 files) | **0** with `status: "queued"` |
| `terminal-status.ts:101-200` | `listLiveAgents()` | empty in current session |
| `health-pane.ts:25` | `healthy/stale/dead/missing` | not a "queued" semantic |

No string literal `"queued messages"` exists anywhere in `src/` (verified via
`rg "queued messages|pending messages|unread messages|notification count" -i`
— only matches in `intercom-bridge.ts` and `task-runner/run-projection.ts`,
neither rendered in the TUI).

No arithmetic over the recorded subagent status counts (87 completed, 171
error, 7 failed, 6 cancelled) yields 227 either. So **the widget cannot be
reading 227 from the agent-records stream**; it is exclusively from
`widgetState.notificationCount`.

---

## Verification Steps

To confirm a user is hitting *this* bug (and not, e.g., a real queue
backlog):

1. Run `/team-dashboard` (read-only snapshot).
2. In the agents-pane, read the `Counts` line — it should show
   `running=N, queued=0, recent=0` (or whatever the real counts are).
3. If `queued=0` but the widget header shows `🔔N` with N > 0, this bug is
   the explanation.
4. To reset: invoke `/team-dismiss` (or restart pi). The badge should
   disappear (count goes to 0 → `notificationBadge` returns `""`).
5. To read the actual notification log: open `.crew/state/notifications/
   YYYY-MM-DD.jsonl` and filter by `severity ∈ {warning, error, critical}`
   for the desired window.

---

## Proposed Fixes (in order of preference)

### Option A — Rename / relabel the badge (lowest risk, fastest)

Change `notificationBadge()` to a less ambiguous string. The bell icon is
the primary source of user confusion; replacing the glyph or appending a
qualifier disambiguates without changing semantics:

```ts
// ui/widget/widget-formatters.ts
return supportsEmoji
  ? ` ·${count} notify`
  : ` [${count} notify]`;
```

Or use a different glyph that does not suggest "messages":
`·${count} alerts` / `[${count} alerts]`. Then update the widget header
template in `widget-renderer.ts:35-44` to drop the literal "Crew agents"
prefix that combines with the bell to read as "queued messages".

### Option B — Cap + decay

Bound the counter (e.g. show "99+") and/or decay by ageing out notifications
older than N minutes. This addresses the underlying user-visible problem
without changing the underlying delivery path:

```ts
// extension/register.ts (after the increment)
const cap = 99;
widgetState.notificationCount = Math.min(cap, widgetState.notificationCount);
```

Plus a periodic decay tick in `configureObservability` that subtracts counts
for notifications older than the current TTL window.

### Option C — Owner-scope the counter

Mirror the fix from `cross-session-notification-leakage.md` at the
`notifyOperator` call site: skip notifications whose `runId` does not
belong to the current `ownerSessionGeneration`. This addresses the
cumulative-across-sessions aspect but does not bound within a single
session. Best combined with Option B.

### Recommended combination

A + C: rename the badge to a non-message glyph (cheap, immediate UX win) +
owner-scope the counter (consistent with the cross-session leak fix). B is
useful but the decay semantics need product input — is a notification
"consumed" once shown, once read, once dismissed, or once an hour passes?

---

## Open Questions

1. Should the counter reset on `/team-dismiss` only, or also when all
   current-session runs reach a terminal state? (Currently it only resets
   on the former.)
2. Should the powerbar segment also reflect this change, or keep its
   current `⚙ N running · 🔔N` shape? (The powerbar is more compact and
   less prone to misreading.)
3. Should `notificationBadge` be deprecated entirely in favour of an
   explicit "alerts" segment, given that the widget already shows the
   notification body via `notificationSink`?

---

## References

- `src/extension/register.ts:301-309` — severity filter + counter increment
- `src/extension/register.ts:753-761` — bulk `subagent-completed` notification
- `src/extension/register.ts:769-775` — `isOwnerSessionCurrent` gate (only
  applied to `subagent.stuck-blocked`, not the badge counter)
- `src/extension/register.ts:2146-2164` — `dismissNotifications()` reset hook
- `src/extension/notification-router.ts:12, 90` — severity-filter re-apply
- `src/config/defaults.ts:78` — `DEFAULT_UI.widgetPlacement` (above-editor)
- `src/config/defaults.ts:100` — `DEFAULT_NOTIFICATIONS.severityFilter`
- `src/ui/widget/widget-renderer.ts:35-44` — `widgetHeader()` assembly
- `src/ui/widget/widget-renderer.ts:61, 64, 95` — `queued` semantic in
  active-runs filter and priority
- `src/ui/widget/widget-model.ts:69-89` — `statusSummary()` short label
- `src/ui/widget/widget-model.ts:72` — `queued` + `waiting` count source
- `src/ui/widget/widget-formatters.ts:147-152` — `notificationBadge()`
- `src/ui/widget/widget-types.ts:22` — `CrewWidgetModel.notificationCount?`
- `src/ui/widget/index.ts:104-128` — `cacheSignature` and invalidation
- `src/ui/widget/index.ts:166, 245-252` — model → render propagation
- `src/ui/powerbar-publisher.ts:115-148` — powerbar `pi-crew-active`
  segment, badge insertion
- `src/ui/powerbar-publisher.ts:119` — `queuedCount` (from tasks.json)
- `src/ui/dashboard-panes/progress-pane.ts:15, 24` — `p.queued` (from
  `RunUiSnapshot.progress.queued`, not from agents)
- `src/ui/dashboard-panes/agents-pane.ts:105` — `queued` agent group
- `src/runtime/process-status.ts:117-148` — `isDisplayActiveRun`
- `docs/bugs/cross-session-notification-leakage.md` — related fix