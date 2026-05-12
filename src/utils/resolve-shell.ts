import * as fs from "node:fs";

/**
 * Resolve the bash executable path, with Windows fallbacks for Git Bash.
 */
export function resolveBashCmd(): string {
	if (process.platform !== "win32") return "bash";
	const candidates = [
		process.env.SHELL,
		"C:\\Program Files\\Git\\bin\\bash.exe",
		"C:\\Program Files (x86)\\Git\\bin\\bash.exe",
	];
	for (const cand of candidates) {
		if (cand && fs.existsSync(cand)) return cand;
	}
	return "bash";
}

/**
 * Choose the right shell command and arguments for a script path.
 * On Windows, powershell (.ps1) and batch (.cmd/.bat) run natively.
 */
export function resolveShellForScript(scriptPath: string): { command: string; args: string[] } {
	if (process.platform === "win32") {
		if (scriptPath.endsWith(".ps1")) {
			return { command: "powershell", args: ["-File", scriptPath] };
		}
		if (scriptPath.endsWith(".cmd") || scriptPath.endsWith(".bat")) {
			// Node >= 20 blocks direct spawn of .bat/.cmd without shell (CVE-2024-27980)
			return { command: process.env.ComSpec ?? "cmd.exe", args: ["/d", "/s", "/c", scriptPath] };
		}
	}
	return { command: resolveBashCmd(), args: [scriptPath] };
}
