#!/usr/bin/env node
/**
 * Cross-platform postinstall orchestrator.
 *
 *   1. Build the ESM bundle (best-effort; on failure we log a fallback and
 *      let Pi fall back to strip-types loading).
 *   2. Install the bundled crew-vibes.ttf into the user fonts directory so
 *      the crew-vibes speed/capacity PUA glyphs render.
 *
 * Replaces the old `postinstall` shell chain so the font install runs on
 * every platform without relying on shell-specific chaining (`;`/`&&`).
 */
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function run(scriptRel) {
	const abs = join(root, scriptRel);
	if (!existsSync(abs)) return 1;
	const result = spawnSync(process.execPath, [abs], { stdio: "inherit" });
	return result.status ?? 1;
}

function main() {
	try {
		// Dev clones ship devDeps (esbuild) and always rebuild — dist/ may be
		// stale vs src during development. Git/production installs ship NO
		// devDeps: their committed dist/index.mjs is by construction in sync
		// with the checkout, so we use it as-is. Rebuilding it (even with the
		// `bun build` fallback) would dirty the git-tracked dist/ and block the
		// next `pi update` pull. The bun fallback therefore fires ONLY when no
		// bundle shipped at all (e.g. install from a commit without dist/).
		// Never dump an ERR_MODULE_NOT_FOUND stack for these expected states.
		const hasEsbuild = existsSync(join(root, "node_modules", "esbuild"));
		const hasCommittedBundle = existsSync(join(root, "dist", "index.mjs"));
		const hasBun = () => spawnSync("bun", ["--version"], { stdio: "ignore" }).status === 0;
		if (hasEsbuild || (!hasCommittedBundle && hasBun())) {
			const bundleStatus = run("scripts/build-bundle.mjs");
			if (bundleStatus !== 0) {
				console.warn(
					"[pi-crew] postinstall: bundle build skipped or failed; using committed dist/ (or strip-types fallback). Run npm run build:bundle to retry.",
				);
			}
		} else if (hasCommittedBundle) {
			console.log("[pi-crew] postinstall: using committed dist/ bundle.");
		} else {
			console.log("[pi-crew] postinstall: no bundler and no committed bundle — Pi will strip-types load index.ts.");
		}
		// Font install is best-effort and must never fail the install.
		run("scripts/install-crew-vibes-font.mjs");
	} catch (err) {
		// Postinstall must NEVER fail the install (SEC-M2).
		console.warn("[pi-crew] postinstall: best-effort step failed:", err instanceof Error ? err.message : err);
	}
}

main();
