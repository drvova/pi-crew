/**
 * hello.dwf.ts — Minimal reference dynamic-workflow script (P2).
 *
 * Usage: place under `.crew/workflows/hello.dwf.ts`, then
 *   team action='run' workflow='hello' goal='Greet the user warmly.'
 *
 * Demonstrates the WorkflowCtx surface: one ctx.agent() call + ctx.setResult().
 * See 07-PLAN.md v3 §3.1 and 00-SPEC.md §3.2.
 */
import type { WorkflowCtx } from "../src/runtime/dynamic-workflow-context.ts";

export default async function (ctx: WorkflowCtx): Promise<void> {
	const greeting = await ctx.agent({
		role: "executor",
		prompt: `Compose a single-line warm greeting. Context: ${ctx.goal ?? "(no goal)"}`,
		maxTurns: 2,
	});
	// Only ctx.setResult() reaches the main context.
	ctx.setResult("results/greeting.txt", { ok: greeting.ok, model: "executor" });
	// Note: in this trivial example the artifact path is illustrative; production scripts
	// would use ctx.agent()'s returned artifactPath. Here we just surface the agent's text
	// via the summary (runDynamicWorkflow reads the final artifact or falls back).
	void greeting;
}
