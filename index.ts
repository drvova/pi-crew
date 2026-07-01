/**
 * pi-crew entrypoint — v0.9.17+ bundle opt-in.
 *
 * By default loads via inline strip-types. Set `PI_CREW_USE_BUNDLE=1`
 * to use the bundled dist/index.mjs (~5% faster cold-start, see
 * `scripts/bench-cold-start.mjs`). The bundle must be built first via
 * `npm run build:bundle` (or installed with a package that ships dist/).
 *
 * If PI_CREW_USE_BUNDLE is set but the bundle is missing/unreadable,
 * we log a single warning at startup and fall back to strip-types.
 * Slow beats broken.
 *
 * History:
 *   - v0.9.16 and earlier: pure strip-types.
 *   - v0.9.17 initial bundle-flip attempt (`06f16d7`): bundle default
 *     with strip-types fallback. Benchmarked at ~5% faster total
 *     cold-start but +9% register overhead and +9MB npm package.
 *     Reverted to opt-in after cost-benefit review (2026-07-01).
 *
 * Design notes:
 *   - Dynamic `await import` for the bundle path keeps the strip-types
 *     path cheap when the env var is not set.
 *   - Env var check is intentionally permissive: any of 1/true/yes/on
 *     (case-insensitive) opts in. Empty / missing = strip-types.
 *   - We never read this env var in the bundle itself; it's purely an
 *     entrypoint-level gate.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerPiTeams as registerPiTeamsFromSrc } from "./src/extension/register.ts";
import { waitForRun as waitForRunFromSrc } from "./src/runtime/run-tracker.ts";
import { accessSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Minimal bundle shape — we only use a few named exports. Keep this loose
// because dist/index.mjs has no .d.ts (it's a build artifact, not source).
type BundleModule = {
	default?: (pi: ExtensionAPI) => void;
	waitForRun?: typeof waitForRunFromSrc;
	registerPiTeams?: (pi: ExtensionAPI) => void;
};

const OPTS_IN = new Set(["1", "true", "yes", "on"]);
const useBundle = OPTS_IN.has((process.env.PI_CREW_USE_BUNDLE ?? "").toLowerCase());

const here = dirname(fileURLToPath(import.meta.url));
const bundlePath = resolve(here, "dist", "index.mjs");

let bundleModule: BundleModule | undefined;
if (useBundle) {
	try {
		accessSync(bundlePath);
		// Lazy import: don't pay the parse cost when bundle is missing,
		// but DO pay it (once) when present. This keeps the strip-types
		// path cheap in dev when PI_CREW_USE_BUNDLE is unset.
		bundleModule = await import(bundlePath);
	} catch {
		// Bundle opted-in but missing. Single warning so users notice
		// without spamming repeated entries. Slow beats broken.
		console.warn(
			`[pi-crew] PI_CREW_USE_BUNDLE=1 but ${bundlePath} missing or unreadable; ` +
				`falling back to strip-types. Run \`npm run build:bundle\` to build.`,
		);
		bundleModule = undefined;
	}
}

export const waitForRun = bundleModule?.waitForRun ?? waitForRunFromSrc;
export const registerPiTeams: (pi: ExtensionAPI) => void =
	bundleModule?.registerPiTeams ?? registerPiTeamsFromSrc;

export default bundleModule?.default ?? ((pi: ExtensionAPI) => registerPiTeamsFromSrc(pi));