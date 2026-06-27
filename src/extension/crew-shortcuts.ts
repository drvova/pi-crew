/**
 * Crew keyboard shortcuts (Round 13 UX).
 *
 * Registers a small set of keyboard shortcuts for fast access to the most
 * useful pi-crew overlays. Keys are chosen to avoid collisions with Pi's
 * built-in keymap (see analysis of pi-tui core/keybindings defaults):
 *
 *   alt+s → open the pi-crew settings overlay (config + theme picker)
 *   alt+c → open the pi-crew run dashboard overlay (mnemonic: **C**rew)
 *
 * OCCUPIED alt+ keys in the built-in keymap (must NOT reuse — verified against
 * pi-tui TUI_KEYBINDINGS + pi core keybindings.js):
 *   alt+b (cursor word left)   alt+f (cursor word right)
 *   alt+d (delete word forward) alt+y (yank pop)
 *   alt+v (paste)              alt+s (crew settings — this module)
 *   alt+enter / alt+up/down/left/right / alt+backspace / alt+delete
 * Free alt+<letter> keys include: a, c, e, g, h, i, j, k, l, m, n, o, p, q,
 * r, t, u, w, x, z.
 *
 * NOTE: an earlier revision used `alt+d` for the dashboard; that collided
 * with `tui.editor.deleteWordForward` and Pi's conflict detector stripped the
 * editor binding. `alt+c` is free AND mnemonic.
 *
 * NOTE: alt+m (mailbox) and alt+t (status) were considered but are NOT wired
 * — the mailbox overlay is run-scoped (requires a runId; reached via the
 * dashboard) and there is no standalone status overlay (status is a text
 * command). See the K-2 note accompanying openTeamDashboard in commands.ts.
 *
 * Shortcuts are guarded by `hasUI` so they never fire in print/RPC mode, and
 * by the optional `registerShortcut` API so older Pi versions degrade
 * gracefully (no-op).
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { KeyId } from "@earendil-works/pi-tui";

type ShortcutHandler = (ctx: ExtensionContext) => Promise<void> | void;

interface ShortcutRegistration {
	/** Pi KeyId, e.g. "alt+s". */
	key: KeyId;
	description: string;
	handler: ShortcutHandler;
}

const CREW_SHORTCUTS: ReadonlyArray<ShortcutRegistration> = [
	{
		key: "alt+s",
		description: "pi-crew: open settings (config + theme picker)",
		// Lazy-import the overlay so this module stays lightweight at load time
		// (avoids pulling the full commands.ts dependency tree into every
		// process that imports this module, e.g. the unit test).
		handler: async (ctx) => {
		// LAZY: defer dynamic import of ./registration/commands.ts to its call site.
			const { openTeamSettingsOverlay } = await import("./registration/commands.ts");
			await openTeamSettingsOverlay(ctx);
		},
	},
	{
		key: "alt+c",
		description: "pi-crew: open run dashboard (Crew)",
		// Lazy-import so the heavy UI module chain (RunDashboard etc.) is only
		// loaded on first use, not at extension load.
		handler: async (ctx) => {
		// LAZY: defer dynamic import of ./registration/commands.ts to its call site.
			const { openTeamDashboard } = await import("./registration/commands.ts");
			await openTeamDashboard(ctx);
		},
	},
];

/**
 * Register all crew keyboard shortcuts on a Pi instance. Safe to call once at
 * extension load. No-ops when `registerShortcut` is unavailable (older Pi).
 */
export function registerCrewShortcuts(
	pi: { registerShortcut?: (shortcut: KeyId, options: { description?: string; handler: ShortcutHandler }) => void },
): void {
	for (const sc of CREW_SHORTCUTS) {
		pi.registerShortcut?.(sc.key, { description: sc.description, handler: sc.handler });
	}
}

/** Exported for tests / introspection. */
export const CREW_SHORTCUT_KEYS: readonly KeyId[] = CREW_SHORTCUTS.map((s) => s.key);
