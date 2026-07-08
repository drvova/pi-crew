/**
 * ANSI art cat animation frames extracted from runner-spritesheet.png.
 * Used when PUA font glyphs are not available (web terminals like gotty).
 * Each frame is an array of strings (one per line).
 */
export const CAT_FRAMES: readonly string[][] = [
	// Frame 0 — standing
	["▄▄ ███▄ ", "▀▀█████▄", "  ██▀██ ", "  ▀▀  ▀▀"],
	// Frame 1 — step 1
	["  ████  ", "  █████▄", "▄██████▀", "  ██ ▀█▄"],
	// Frame 2 — step 2
	[" ▄██████", " █████▀ ", "███████ ", "▀██████ "],
	// Frame 3 — step 3
	["  ████  ", "▄█████▄ ", "▀██████▄", "▄█▀  ██ "],
] as const;

/** Number of animation frames. */
export const CAT_FRAME_COUNT = CAT_FRAMES.length;
