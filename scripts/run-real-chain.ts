/**
 * Real end-to-end chain execution test.
 *
 * Runs two ACTUAL team runs sequentially via the chain feature, with step 2's
 * worker receiving step 1's handoff context (including output text). Prints
 * both step runIds for inspection.
 *
 * Usage: npx tsx scripts/run-real-chain.ts
 */
import { handleRun } from "../src/extension/team-tool/run.ts";
import type { TeamContext } from "../src/extension/team-tool/context.ts";

const chain = '"Say the numbers 1, 2, 3" -> "What was the last number in the previous step? Add 2 to it."';
const ctx: TeamContext = { cwd: process.cwd() };

console.log("[run-real-chain] Executing chain:", chain);
console.log("[run-real-chain] Working directory:", process.cwd());
console.log("[run-real-chain] This will spawn REAL team runs. Please wait...\n");

const result = await handleRun(
	{ action: "run", chain },
	ctx,
);

console.log("\n=== CHAIN RESULT (details) ===");
console.log(JSON.stringify(result.details, null, 2));

const text = result.content?.[0];
if (text && "text" in text) {
	console.log("\n=== SUMMARY ===");
	console.log(text.text);
}

// Extract runIds for easy inspection.
const runIds = (result.details as { data?: { runIds?: string[] } }).data?.runIds;
if (runIds && runIds.length > 0) {
	console.log("\n=== STEP RUN IDS ===");
	for (let i = 0; i < runIds.length; i++) {
		console.log(`Step ${i + 1}: ${runIds[i]}`);
	}
} else {
	console.log("\n[run-real-chain] WARNING: no runIds found in result.");
}
