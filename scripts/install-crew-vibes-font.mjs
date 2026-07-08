#!/usr/bin/env node
/**
 * Installs the bundled crew-vibes.ttf (PUA glyphs U+E700..U+E70A) into the
 * user fonts directory so the crew-vibes speed + capacity figures render
 * instead of tofu boxes. Cross-platform mirror of pi-speeed's install-font.
 *
 *   macOS   ~/Library/Fonts/crew-vibes.ttf
 *   Linux   ~/.local/share/fonts/crew-vibes.ttf  (+ fc-cache -f)
 *   Windows %LOCALAPPDATA%\Microsoft\Windows\Fonts\crew-vibes.ttf (per-user)
 *
 * Invoked by the npm `postinstall` hook and by `npm run install:crew-font`.
 * Best-effort: never fails the install.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = join(__dirname, "..", "assets", "crew-vibes.ttf");
const FONT_NAME = "crew-vibes.ttf";

function log(message) {
	console.log(`[pi-crew] ${message}`);
}

function installFont() {
	if (!existsSync(source)) {
		log(`crew-vibes font missing: ${source}`);
		return;
	}

	const os = platform();
	let targetDir;

	if (os === "darwin") {
		targetDir = join(homedir(), "Library", "Fonts");
	} else if (os === "linux") {
		targetDir = join(homedir(), ".local", "share", "fonts");
	} else if (os === "win32") {
		const localAppData = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
		targetDir = join(localAppData, "Microsoft", "Windows", "Fonts");
	} else {
		log(`Skipping font install on unsupported platform: ${os}`);
		return;
	}

	mkdirSync(targetDir, { recursive: true });
	const target = join(targetDir, FONT_NAME);
	copyFileSync(source, target);
	log(`Installed crew-vibes font to ${target}`);

	if (os === "linux") {
		// Refresh fontconfig cache so newly installed font is immediately
		// available to all terminals.  -fv for verbose + forced rebuild.
		const result = spawnSync("fc-cache", ["-fv", targetDir], { stdio: "ignore" });
		if (result.status === 0) log("Refreshed font cache (fc-cache -fv)");
		else log("fontconfig fc-cache not available; restart terminal if font is not visible");

		// Verify font is actually indexed by fontconfig
		const verify = spawnSync("fc-match", [":charset=E700"], { encoding: "utf8" });
		if (verify.stdout && verify.stdout.includes(FONT_NAME)) {
			log("Font verified: fc-match U+E700 -> crew-vibes.ttf");
		} else {
			log("WARNING: fc-match did not resolve U+E700 to crew-vibes.ttf");
			log("  Run: fc-cache -fv " + targetDir);
			log("  Then restart your terminal.");
		}
	}

	if (os === "win32") {
		// Register the per-user font in HKCU so Windows Terminal and other
		// apps pick it up for PUA glyph fallback. Copying alone is not enough.
		const regValue = "Crew Vibes (TrueType)";
		const regResult = spawnSync("reg", ["add", "HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Fonts", "/v", regValue, "/t", "REG_SZ", "/d", target, "/f"], { stdio: "ignore" });
		if (regResult.status === 0) log("Registered crew-vibes font in Windows registry (HKCU)");
		else log("Windows registry registration skipped (reg.exe unavailable); glyphs may not render until font is installed via Settings");
	}

	if (os === "darwin" || os === "win32") {
		log("Restart your terminal (or select a Crew-Vibes-capable font) if glyphs still show as boxes");
	}
}

try {
	installFont();
} catch (error) {
	log(`Font install failed: ${error instanceof Error ? error.message : String(error)}`);
	process.exitCode = 0;
}
