import type { ResourceSource } from "../agents/agent-config.ts";

export interface WorkflowStep {
	id: string;
	role: string;
	task: string;
	dependsOn?: string[];
	parallelGroup?: string;
	output?: string | false;
	reads?: string[] | false;
	model?: string;
	/** Additional skills for this step; false disables role-default injected skills for this step. */
	skills?: string[] | false;
	progress?: boolean;
	worktree?: boolean;
	verify?: boolean;
	/** Per-step files to overlay into the worktree (in addition to global worktree.seedPaths).
	 * Useful when only certain steps need access to local drafts or scripts. */
	seedPaths?: string[];
}

export interface WorkflowConfig {
	name: string;
	description: string;
	source: ResourceSource;
	filePath: string;
	steps: WorkflowStep[];
	maxConcurrency?: number;
}
