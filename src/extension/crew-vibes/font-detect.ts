import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

/**
 * Detect whether the crew-vibes PUA font (U+E700..U+E70F) is installed.
 * Without it, the 16 runner-pose glyphs render as identical tofu boxes
 * and the animation appears frozen.  The result is cached at module load
 * — filesystem checks are cheap and the answer never changes within a
 * single process lifetime.
 */

function fontPath(): string {
	const os = platform();
	const home = homedir();
	if (os === "darwin") return join(home, "Library", "Fonts", "crew-vibes.ttf");
	if (os === "linux") return join(home, ".local", "share", "fonts", "crew-vibes.ttf");
	if (os === "win32") {
		const local = process.env.LOCALAPPDATA ?? join(home, "AppData", "Local");
		return join(local, "Microsoft", "Windows", "Fonts", "crew-vibes.ttf");
	}
	return "";
}

let _hasFont: boolean | null = null;

/** Returns true when the crew-vibes PUA font file is present. */
export function hasCrewFont(): boolean {
	if (_hasFont !== null) return _hasFont;
	const p = fontPath();
	_hasFont = p !== "" && existsSync(p);
	return _hasFont;
}
