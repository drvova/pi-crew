import type { WorkflowConfig } from "./workflow-config.ts";

// Rough token estimates per role (input + output combined)
const ROLE_TOKEN_ESTIMATES: Record<string, number> = {
	explorer: 15000,
	planner: 20000,
	executor: 25000,
	reviewer: 12000,
	"security-reviewer": 12000,
	"test-engineer": 15000,
	analyst: 18000,
	writer: 15000,
	verifier: 10000,
	critic: 12000,
};

// Rough cost per 1K tokens (USD) — using a mid-range model price
const COST_PER_1K_TOKENS = 0.003;

export interface CostEstimate {
	totalTokens: number;
	estimatedCostUSD: number;
	perStep: Array<{ stepId: string; role: string; tokens: number }>;
}

export function estimateWorkflowCost(workflow: WorkflowConfig): CostEstimate {
	const perStep = workflow.steps.map((step) => {
		const tokens = ROLE_TOKEN_ESTIMATES[step.role] ?? 15000; // default 15K
		return { stepId: step.id, role: step.role, tokens };
	});
	const totalTokens = perStep.reduce((sum, s) => sum + s.tokens, 0);
	const estimatedCostUSD = (totalTokens / 1000) * COST_PER_1K_TOKENS;
	return { totalTokens, estimatedCostUSD, perStep };
}
