import { SECRET_KEY_PATTERN } from "./redaction.ts";

export interface SanitizeEnvOptions {
	/** Allow-list of env var names to preserve. Supports trailing glob, e.g. `"PI_*"`. */
	allowList?: string[];
}

/**
 * Strip env vars whose keys look like secrets before passing to child processes.
 *
 * Default mode (no allowList): deny-list using SECRET_KEY_PATTERN.
 * When allowList is provided, only keys matching the allow-list are preserved.
 */
export function sanitizeEnvSecrets(env: NodeJS.ProcessEnv, options?: SanitizeEnvOptions): Record<string, string> {
	const filtered: Record<string, string> = {};
	if (options?.allowList && options.allowList.length > 0) {
		const matchers = options.allowList.map((p) => {
			if (p.endsWith("*")) return (k: string) => k.startsWith(p.slice(0, -1));
			return (k: string) => k === p;
		});
		for (const [key, value] of Object.entries(env)) {
			if (value !== undefined && matchers.some((fn) => fn(key))) filtered[key] = value;
		}
		return filtered;
	}
	for (const [key, value] of Object.entries(env)) {
		if (value !== undefined && !SECRET_KEY_PATTERN.test(key)) filtered[key] = value;
	}
	return filtered;
}
