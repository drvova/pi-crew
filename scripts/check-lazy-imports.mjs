import { execSync } from "node:child_process";

const out = execSync(
	`git grep -nE "await import\\(" -- "src/**/*.ts"`,
	{ encoding: "utf-8" },
);

const lines = out.split("\n").filter(Boolean);
const bad = [];

for (let i = 0; i < lines.length; i++) {
	const line = lines[i];
	if (line.includes("// LAZY:")) continue;
	// Check if the previous line in the source file has // LAZY:
	const match = line.match(/^([^:]+):(\d+):/);
	if (!match) continue;
	const [, file, lineNum] = match;
	try {
		const prevLine = execSync(`sed -n '${Number(lineNum) - 1}p' "${file}"`, { encoding: "utf-8" }).trim();
		if (!prevLine.includes("// LAZY:")) bad.push(line);
	} catch {
		bad.push(line);
	}
}

if (bad.length > 0) {
	console.error("Dynamic imports without `// LAZY:` marker:\n" + bad.join("\n"));
	process.exit(1);
}

console.log("All dynamic imports have `// LAZY:` marker.");
