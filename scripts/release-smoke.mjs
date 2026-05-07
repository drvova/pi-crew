#!/usr/bin/env node
/**
 * Release smoke test — verifies packed tarball loads correctly in a temp project.
 * Run: node scripts/release-smoke.mjs
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");

function log(msg) {
	console.log(`[release-smoke] ${msg}`);
}

function run(cmd, cwd) {
	log(`  $ ${cmd}`);
	execSync(cmd, { cwd, stdio: "pipe", timeout: 60_000 });
}

try {
	// 1. Read version from package.json
	const rootPkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf-8"));
	const version = rootPkg.version;
	log(`Package version: ${version}`);

	// 2. Pack tarball
	log("Packing tarball...");
	execSync("npm pack", { cwd: root, stdio: "pipe", timeout: 60_000 });
	const tarballName = `pi-crew-${version}.tgz`;
	const tarballPath = path.join(root, tarballName);
	if (!fs.existsSync(tarballPath)) throw new Error(`Tarball not found: ${tarballPath}`);
	log(`  Tarball: ${tarballName}`);

	// 3. Create temp project
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-smoke-"));
	log(`Temp project: ${tmpDir}`);
	try {
		run("npm init -y", tmpDir);

		// 4. Install packed tarball
		run(`npm install ${tarballPath}`, tmpDir);

		// 5. Verify extension loads
		const pkgPath = path.join(tmpDir, "node_modules", "pi-crew", "package.json");
		if (!fs.existsSync(pkgPath)) throw new Error("pi-crew package not found in node_modules");
		const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
		log(`  Installed version: ${pkg.version}`);

		// 6. Verify key entrypoints exist
		const srcRegister = path.join(tmpDir, "node_modules", "pi-crew", "src", "extension", "register.ts");
		if (fs.existsSync(srcRegister)) {
			log(`  Extension register entrypoint found: ${srcRegister}`);
		} else {
			throw new Error("Could not find extension register entrypoint");
		}

		// 7. Verify version consistency
		if (pkg.version !== version) {
			throw new Error(`Version mismatch: root=${version} installed=${pkg.version}`);
		}
		log(`  Version consistency: OK ${pkg.version}`);

		log("Release smoke test PASSED!");
	} finally {
		fs.rmSync(tmpDir, { recursive: true, force: true });
		// Clean up tarball
		try { fs.unlinkSync(tarballPath); } catch {}
	}
} catch (error) {
	console.error("Release smoke test FAILED:", error instanceof Error ? error.message : String(error));
	process.exit(1);
}