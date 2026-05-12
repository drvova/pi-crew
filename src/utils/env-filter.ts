import { SECRET_KEY_PATTERN } from "./redaction.ts";

/**
 * Strip env vars whose keys look like secrets before passing to child processes.
 * Preserves PATH, HOME, USER, LANG, and PI_* variables by default.
 */
export function sanitizeEnvSecrets(env: NodeJS.ProcessEnv): Record<string, string> {
	const filtered: Record<string, string> = {};
	for (const [key, value] of Object.entries(env)) {
		if (value !== undefined && !SECRET_KEY_PATTERN.test(key)) filtered[key] = value;
	}
	return filtered;
}
