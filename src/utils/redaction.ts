/**
 * ReDoS-resistant pattern matching for secret detection.
 * Uses linear-time scan instead of complex regex to prevent catastrophic backtracking.
 */

// Pattern for PEM private keys (possessive quantifier prevents backtracking)
export const PEM_PRIVATE_KEY_PATTERN = /-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]+?-----END [A-Z ]+PRIVATE KEY-----/g;

// Linear-time secret key detection
export function isSecretKey(keyName: string): boolean {
	// Fast path: common secret key names
	const lower = keyName.toLowerCase();
	if (/^(token|apikey|api_key|password|secret|credential|authorization|privatekey|private_key)$/.test(lower)) {
		return true;
	}
	// Linear scan for prefix characters followed by keywords
	const prefixes = "_.-";
	const keywords = ["token", "api", "key", "password", "passwd", "secret", "credential", "authorization", "private"];
	
	for (let i = 0; i < keyName.length; i++) {
		if (prefixes.includes(keyName[i])) {
			const remaining = keyName.substring(i + 1).toLowerCase();
			for (const kw of keywords) {
				if (remaining.startsWith(kw)) {
					const afterKw = remaining.substring(kw.length);
					if (afterKw === "" || prefixes.includes(afterKw[0]) || /[a-zA-Z0-9]/.test(afterKw[0])) {
						return true;
					}
				}
			}
		}
	}
	return false;
}

// Linear-time Authorization header redaction
export function redactAuthHeader(line: string): string {
	const idx = line.toLowerCase().indexOf("authorization:");
	if (idx === -1) return line;
	
	// Find end of value (next newline or carriage return)
	let end = idx + 14; // length of "authorization:"
	while (end < line.length && line[end] !== "\r" && line[end] !== "\n") {
		end++;
	}
	
	return line.substring(0, end) + " ***" + (end < line.length ? line.substring(end) : "");
}

// Linear-time Bearer token redaction
export function redactBearerTokens(line: string): string {
	const upper = line.toUpperCase();
	const result: string[] = [];
	let i = 0;
	
	while (i < line.length) {
		if (upper.startsWith("BEARER ", i)) {
			let j = i + 7;
			let tokenLen = 0;
			// Count valid token characters (max 200 to prevent runaway)
			while (j < line.length && tokenLen < 200 && /[A-Za-z0-9._~+/-]/.test(line[j])) {
				j++;
				tokenLen++;
			}
			if (tokenLen >= 8) {
				result.push(line.substring(i, j) + "***");
				i = j;
				continue;
			}
		}
		result.push(line[i]);
		i++;
	}
	
	return result.join("");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	if (value instanceof Date || value instanceof RegExp || value instanceof Error || value instanceof Map || value instanceof Set) return false;
	return true;
}

export function redactSecretString(value: string): string {
	return value
		.replace(PEM_PRIVATE_KEY_PATTERN, "***")
		.replace(redactAuthHeader(value), "***")
		.replace(redactBearerTokens(value), "***");
}

export function redactSecrets(value: unknown, keyName = ""): unknown {
	if (keyName && isSecretKey(keyName)) return "***";
	if (typeof value === "string") return redactSecretString(value);
	if (Array.isArray(value)) return value.map((item) => redactSecrets(item));
	if (isRecord(value)) {
		const output: Record<string, unknown> = {};
		for (const [key, entry] of Object.entries(value)) output[key] = redactSecrets(entry, key);
		return output;
	}
	return value;
}

export function redactJsonLine(line: string): string {
	try {
		return JSON.stringify(redactSecrets(JSON.parse(line) as unknown));
	} catch {
		return redactSecretString(line);
	}
}