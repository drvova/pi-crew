import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeEnvSecrets } from "../../src/utils/env-filter.ts";

test("default deny-list strips secret-like keys", () => {
	const result = sanitizeEnvSecrets({
		PATH: "/usr/bin",
		HOME: "/home/user",
		OPENAI_API_KEY: "sk-secret",
		MY_TOKEN: "tok-secret",
		NORMAL_VAR: "ok",
	});
	assert.equal(result.PATH, "/usr/bin");
	assert.equal(result.HOME, "/home/user");
	assert.equal(result.NORMAL_VAR, "ok");
	assert.equal(result.OPENAI_API_KEY, undefined);
	assert.equal(result.MY_TOKEN, undefined);
});

test("allow-list only passes through matched keys", () => {
	const result = sanitizeEnvSecrets(
		{
			PATH: "/usr/bin",
			HOME: "/home/user",
			SECRET: "hidden",
			PI_HOME: "/pi",
		},
		{ allowList: ["PATH", "HOME", "PI_*"] },
	);
	assert.equal(result.PATH, "/usr/bin");
	assert.equal(result.HOME, "/home/user");
	assert.equal(result.PI_HOME, "/pi");
	assert.equal(result.SECRET, undefined);
});

test("allow-list glob PI_* does not match PIPELINE", () => {
	const result = sanitizeEnvSecrets(
		{
			PI_HOME: "/pi",
			PIPELINE: "ci",
		},
		{ allowList: ["PI_*"] },
	);
	assert.equal(result.PI_HOME, "/pi");
	assert.equal(result.PIPELINE, undefined);
});
