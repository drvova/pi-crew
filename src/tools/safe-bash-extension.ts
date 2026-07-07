/**
 * Safe Bash Extension for pi-crew
 * Wraps the built-in bash tool with dangerous command blocking.
 *
 * Delegates pattern matching to the core `safe-bash.ts` module which uses
 * linear-time string scanning (no ReDoS-vulnerable regex).
 *
 * Usage:
 * 1. Enable in config: { "tools": { "bash": { "safeMode": true } } }
 * 2. Or use via agent config: { "extensions": ["path/to/safe-bash-extension.ts"] }
 * 3. Or set env var: PI_CREW_SAFE_BASH=true
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createBashTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { checkCommand } from "./safe-bash.ts";

export default function safeBashExtension(pi: ExtensionAPI): void {
	const cwd = process.cwd();
	const bashTool = createBashTool(cwd);

	pi.registerTool({
		name: "safe_bash",
		label: "Safe Bash",
		description: "Execute a bash command safely. Blocks dangerous commands like `rm -rf /`, `sudo`, `curl | sh`, etc.",
		parameters: Type.Object({
			command: Type.String({ description: "Bash command to execute" }),
			/** Timeout in seconds (optional). Default: no timeout. If exceeded, the command is killed. */
			timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (optional)" })),
			description: Type.Optional(
				Type.String({
					description: "Description of what this command does (optional)",
				}),
			),
		}),
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const danger = checkCommand(params.command);
			if (danger) {
				return {
					details: {},
					content: [
						{
							type: "text" as const,
							text: `🚫 ${danger}\n\nCommand blocked by safety policy. If this is a false positive, ask the user for confirmation or use force: true with explicit user approval.`,
						},
					],
				};
			}
			// Safe - delegate to real bash tool
			return bashTool.execute(toolCallId, params, signal, onUpdate);
		},
	});
}
