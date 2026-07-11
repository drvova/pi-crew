#!/usr/bin/env node
/**
 * 5.5 — Bundle pi-crew into a single ESM file.
 *
 * Output:
 *   dist/index.mjs        — bundled extension entrypoint
 *   dist/index.mjs.map    — source map
 *
 * Pi peer dependencies are kept external. Bundling shrinks parse+module-
 * resolution cost on cold start: with strip-types Node still has to parse
 * each .ts file individually, so a single .mjs cuts the per-file overhead.
 *
 * Backends (single config, tried in order):
 *   1. esbuild — dev clones (devDependency).
 *   2. `bun build` CLI — git/production installs ship no devDeps, but Bun
 *      users already have a bundler inside the bun binary. Same entry,
 *      externals, banner, and outfile; equivalent flags.
 *
 * This script is invoked by `npm run build:bundle` and postinstall. The
 * `package.json#exports` field is configured so:
 *   - `dist/index.mjs` is the preferred entrypoint when present (set by Pi
 *     extension loader via "pi.extensions").
 *   - `index.ts` remains the fallback when dist/ is missing (e.g. running
 *     directly out of a clone without prior build).
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

const distDir = path.join(root, "dist");
fs.mkdirSync(distDir, { recursive: true });

// Bundle entry must be the bare extension (index.bundle.ts) NOT the
// entry shell (index.ts). If we bundled index.ts, the bundled code
// would re-resolve dist/index.mjs relative to ITS OWN location
// (file:///.../dist/index.mjs), producing dist/dist/index.mjs and a
// recursion error. index.bundle.ts has no shell logic so this is
// a clean single-file bundle. See index.bundle.ts header for details.
const ENTRY = path.join(root, "index.bundle.ts");
const OUTFILE = path.join(distDir, "index.mjs");

// Keep peer deps external so consumers' Pi versions resolve naturally.
// Direct deps as well — bundling their full graph would inflate the
// output and override consumer-installed versions.
const EXTERNALS = [
	"@earendil-works/pi-coding-agent",
	"@earendil-works/pi-ai",
	"@earendil-works/pi-agent-core",
	"@earendil-works/pi-tui",
	"cli-highlight",
	"diff",
	"jiti",
	"typebox",
];

// CJS-shim banner: pi-crew's dependency graph includes CommonJS modules
// (notably `yaml`) whose source calls `require("process")` etc. Bundlers
// emit these as runtime `require(...)` calls; in a pure-ESM context
// `require` is undefined, so we inject a `createRequire`-backed shim
// at the top of the bundle. This is the standard pattern for shipping
// CJS-mixed bundles as `.mjs`. See phase-2 H2 investigation (2026-06-30).
const BANNER =
	"// pi-crew bundled by scripts/build-bundle.mjs (5.5)\n" +
	"// CJS-shim for legacy deps (yaml, etc.) that call require() in ESM context.\n" +
	"import { createRequire as __piCrewCreateRequire } from 'node:module';\n" +
	"const require = __piCrewCreateRequire(import.meta.url);\n" +
	"const module = { exports: {} };\n" +
	"const exports = module.exports;\n";

async function buildWithEsbuild() {
	const { build } = await import("esbuild");
	const result = await build({
		entryPoints: [ENTRY],
		bundle: true,
		format: "esm",
		platform: "node",
		target: "node22",
		outfile: OUTFILE,
		sourcemap: true,
		logLevel: "info",
		external: EXTERNALS,
		// All node:* and Node-builtin modules are external by default for
		// platform=node.
		banner: { js: BANNER },
		metafile: true,
	});
	fs.writeFileSync(path.join(distDir, "build-meta.json"), JSON.stringify(result.metafile, null, 2) + "\n", "utf-8");
}

function buildWithBun() {
	// NOTE: bun's CLI parser requires `--flag=value` syntax — space-separated
	// `--outfile <path>` is silently ignored (output lands in cwd). Same story
	// for `--sourcemap=linked` combined with `--outfile`: bun redirects the
	// output to cwd. Both failure modes are caught by the output guard below.
	// No sourcemap on this path — production installs don't need it, and the
	// linked-sourcemap/outfile combination is what breaks output placement.
	const args = [
		"build",
		ENTRY,
		`--outfile=${OUTFILE}`,
		"--format=esm",
		"--target=node",
		`--banner=${BANNER}`,
		...EXTERNALS.map((pkg) => `--external=${pkg}`),
	];
	const result = spawnSync("bun", args, { cwd: root, stdio: "inherit" });
	if (result.error || result.status !== 0) {
		throw new Error(`bun build failed (status ${result.status ?? "spawn-error"}): ${result.error?.message ?? ""}`);
	}
	// A stale esbuild sourcemap next to a bun-built bundle would give WRONG
	// stack mappings — worse than no map. Remove it.
	fs.rmSync(`${OUTFILE}.map`, { force: true });
	// No esbuild metafile on this path; leave a marker so a stale esbuild
	// build-meta.json is never misattributed to this bundle.
	fs.writeFileSync(
		path.join(distDir, "build-meta.json"),
		JSON.stringify({ backend: "bun", builtAt: new Date().toISOString() }, null, 2) + "\n",
		"utf-8",
	);
}

const start = Date.now();
// Output guard: the backend must actually (re)write OUTFILE. A backend that
// exits 0 but writes elsewhere (e.g. bun with malformed --outfile syntax)
// must fail loudly, not report the stale previous bundle as fresh.
const preMtimeMs = fs.existsSync(OUTFILE) ? fs.statSync(OUTFILE).mtimeMs : -1;
try {
	await buildWithEsbuild();
} catch (esbuildErr) {
	console.warn(`[build-bundle] esbuild unavailable (${esbuildErr instanceof Error ? esbuildErr.message.split("\n")[0] : esbuildErr}); trying bun build`);
	buildWithBun();
}
const stat = fs.statSync(OUTFILE);
if (stat.mtimeMs <= preMtimeMs) {
	throw new Error(`[build-bundle] backend reported success but ${OUTFILE} was not rewritten — output landed elsewhere?`);
}
const elapsedMs = Date.now() - start;
console.log(`[build-bundle] dist/index.mjs ${(stat.size / 1024).toFixed(1)} KB in ${elapsedMs} ms`);
