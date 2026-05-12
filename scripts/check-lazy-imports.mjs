import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const out = execSync(
	`git grep -nE "await import\\(" -- "src/**/*.ts"`,
	{ encoding: "utf-8" },
);

const bad = [];
const fileCache = new Map();

for (const line of out.split("\n").filter(Boolean)) {
	if (line.includes("// LAZY:")) continue;
	const m = line.match(/^([^:]+):(\d+):/);
	if (!m) continue;
	const [, file, lineNum] = m;
	if (!fileCache.has(file)) fileCache.set(file, readFileSync(file, "utf-8").split(/\r?\n/));
	const lines = fileCache.get(file);
	const prevLine = lines[Number(lineNum) - 2] ?? "";
	if (!prevLine.includes("// LAZY:")) bad.push(line);
}

if (bad.length > 0) {
	console.error("Dynamic imports without `// LAZY:` marker:\n" + bad.join("\n"));
	process.exit(1);
}

console.log("All dynamic imports have `// LAZY:` marker.");
