import type { SpeedConfig } from "./config.ts";
import { hasCrewFont } from "./font-detect.ts";

/**
 * Crew figures replacing the original cat glyphs from pi-speeed / pi-chonk.
 * Uses PUA glyphs (U+E700..U+E70F) from the bundled crew-vibes.ttf font;
 * run `npm run install:crew-font` or rely on the postinstall hook.
 * Without the font the glyphs render as tofu boxes.
 */

// Speed indicator: 16 runner poses stored as PUA glyphs in the bundled
// crew-vibes.ttf (U+E700..U+E70F). Each frame is one glyph + a trailing
// space (mirrors pi-speeed's RunCat layout) so the working indicator keeps
// a constant 2-cell width across frames. Faster tok/s cycles frames faster
// (see intervalForSpeed). Install the font via `npm run install:crew-font`
// or the postinstall hook; without it the glyphs render as tofu boxes.
const PUA_CREW_FRAMES: readonly string[] = [
	"\uE700 ",
	"\uE701 ",
	"\uE702 ",
	"\uE703 ",
	"\uE704 ",
	"\uE705 ",
	"\uE706 ",
	"\uE707 ",
	"\uE708 ",
	"\uE709 ",
	"\uE70A ",
	"\uE70B ",
	"\uE70C ",
	"\uE70D ",
	"\uE70E ",
	"\uE70F ",
] as const;

// Fallback frames using standard Unicode block elements that render on any
// terminal without a custom font.  8 frames — half the PUA count — both
// produce a smooth animation at the same cadence because the Loader cycles
// frames independently via its own setInterval.
const ASCII_FALLBACK_FRAMES: readonly string[] = [
	"\u258C ",
	"\u258D ",
	"\u258E ",
	"\u258F ",
	"\u2590 ",
	"\u2591 ",
	"\u2592 ",
	"\u2593 ",
] as const;

// Re-export PUA frames for direct consumers that don't need the font check.
export const RUN_CREW_FRAMES = PUA_CREW_FRAMES;

/**
 * Return the best available indicator frames.
 * Returns PUA glyphs when crew-vibes.ttf is installed, otherwise falls back
 * to standard Unicode block elements that render on any terminal.
 */
export function crewFrames(): readonly string[] {
	return hasCrewFont() ? PUA_CREW_FRAMES : ASCII_FALLBACK_FRAMES;
}

/**
 * Map a tok/s reading to a working-indicator frame interval in ms.
 * Ported from pi-speeed's runcatInterval: interval = scale / speed, clamped
 * to [min, max]. A null/zero speed falls back to the default (idle) cadence.
 */
export function intervalForSpeed(config: SpeedConfig, speed: number | null): number {
	if (speed === null || !Number.isFinite(speed) || speed <= 0) return config.defaultIntervalMs;
	return Math.max(config.minIntervalMs, Math.min(config.maxIntervalMs, Math.round(config.scale / speed)));
}

/**
 * Pick the capacity stage index (0..levels-1) for a context-fill percent.
 * Ported from pi-chonk's chonkIndex.
 */
export function capacityIndex(percent: number | null | undefined, levels = 6): number {
	if (percent === null || percent === undefined || !Number.isFinite(percent)) return 0;
	return Math.max(0, Math.min(levels - 1, Math.floor((Math.max(0, Math.min(100, percent)) / 100) * levels)));
}

/** The last two stages are "danger" stages and get the error color. */
export function isDangerStage(index: number, levels: number): boolean {
	return index >= Math.max(0, levels - 2);
}
