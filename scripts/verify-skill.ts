#!/usr/bin/env node
/**
 * Skill Verification Script
 * 
 * Verifies that a skill has proper RED/GREEN gate enforcement, not just descriptions.
 * 
 * Usage:
 *   node scripts/verify-skill.ts skills/tdd-workflow/SKILL.md   # single skill
 *   node scripts/verify-skill.ts skills/                          # batch mode (all skills)
 */

import * as fs from "fs";
import * as path from "path";

interface Gate {
	type: "red" | "green";
	condition: string;
	check: string;
	failMessage: string;
}

interface VerificationResult {
	skillPath: string;
	skillName: string;
	hasTriggerSection: boolean;
	hasGates: boolean;
	gates: Gate[];
	hasAntiPatterns: boolean;
	hasEnforceableGates: boolean;
	isDescriptiveOnly: boolean;
	errors: string[];
	warnings: string[];
	passed: boolean;
}

const TRIGGER_PATTERNS = [
	/^#+\s*(When (to|should) Activate|Trigger|Conditions?|Use When|Apply When|Activation Criteria)/im,
	/(?:^|\n)##\s*(When (to|should) Activate|Trigger|Conditions?|Use When|Apply When|Activation Criteria)/im,
	/(?:^|\n)##\s*Activation/im,
	/^#+\s*Triggers?\s*\n/im,
	/^Use this skill (when|whenever|if)/im,
	/^Triggers?:/im,
	/description:.*Triggers?:/i,
];

const ANTI_PATTERN_PATTERNS = [
	/(?:^|\n)##\s*Anti-?patterns?\s*\n/im,
	/(?:^|\n)##\s*What (NOT|not) (to|to do)|Don't|DO NOT/im,
	/(?:^|\n)##\s*Pitfalls?\s*\n/im,
	/(?:^|\n)##\s*Common Mistakes?\s*\n/im,
	/(?:^|\n)##\s*Avoid\s*\n/im,
];

const GATE_MARKER_PATTERNS = [
	/(?:^|\n)##\s*(RED|GREEN)[\s_-]*(GATE|Gates?)\s*\n/im,
	/(?:^|\n)###\s*(RED|GREEN)[\s_-]*(GATE|Gates?)\s*\n/im,
	/(?:^|\n)(RED|GREEN)[\s_-]*(GATE|Gates?):/im,
	/(?:^|\n)##\s*Gate\s*\n/im,
];

const PASS_FAIL_PATTERNS = [
	/(?:^|\n)###\s*(PASS|FAIL|RED|GREEN)/im,
	/(?:^|\n)\|\s*(PASS|FAIL|RED|GREEN)\s*\|/im,
	/(?:^|\n)_\(PASS\)|_\(FAIL\)/im,
	/(?:^|\n)\*\*PASS\*\*|\*\*FAIL\*\*/im,
	/(?:^|\n)(?:✓|✗|✅|❌)\s*(PASS|FAIL|pass|fail)/im,
];

/**
 * Find if content matches trigger patterns
 */
function hasTriggerSection(content: string): boolean {
	return TRIGGER_PATTERNS.some((pattern) => pattern.test(content));
}

/**
 * Find if content matches anti-pattern patterns
 */
function hasAntiPatternSection(content: string): boolean {
	return ANTI_PATTERN_PATTERNS.some((pattern) => pattern.test(content));
}

/**
 * Check if content has RED/GREEN gate structure
 */
function extractGates(content: string): Gate[] {
	const gates: Gate[] = [];
	
	// Check for explicit gate sections
	const gateSectionMatch = content.match(/(?:^|\n)(?:##|###)\s*(RED|GREEN)[\s_-]*(GATE|Gates?)[^\n]*\n([\s\S]*?)(?=\n##|\n###|$)/gi);
	
	if (gateSectionMatch) {
		for (const match of gateSectionMatch) {
			const typeMatch = match.match(/(RED|GREEN)/i);
			if (typeMatch) {
				const type = typeMatch[1].toLowerCase() as "red" | "green";
				
				// Look for condition/check/fail patterns within gate section
				const conditionMatch = match.match(/condition[:\s]+([^\n]+)/i);
				const checkMatch = match.match(/check[:\s]+([^\n]+)/i);
				const failMatch = match.match(/(?:fail|message)[:\s]+([^\n]+)/i);
				
				if (conditionMatch || checkMatch) {
					gates.push({
						type,
						condition: conditionMatch ? conditionMatch[1] : "implicit",
						check: checkMatch ? checkMatch[1] : "see description",
						failMessage: failMatch ? failMatch[1] : "",
					});
				}
			}
		}
	}
	
	// Also look for decision matrices or check lists
	const decisionMatrixMatch = content.match(/(?:^|\n)##\s*Decision\s*Matrix[^\n]*\n([\s\S]*?)(?=\n##|\n###|$)/gi);
	if (decisionMatrixMatch) {
		for (const block of decisionMatrixMatch) {
			// Match full markdown table rows: lines starting and ending with |
			const rowMatches = block.match(/(?:^|\n)\|.*?\|/g);
			if (rowMatches && rowMatches.length > 1) {
				// Skip header row (first match), process data rows
				for (const rowLine of rowMatches.slice(1)) {
					const cells = rowLine.split("|").filter((c) => c.trim());
					if (cells.length >= 2) {
						const passIndicator = /pass|green|✅|✓|yes/i.test(cells.join(""));
						const failIndicator = /fail|red|❌|✗|no/i.test(cells.join(""));
						if (passIndicator || failIndicator) {
							gates.push({
								type: passIndicator ? "green" : "red",
								condition: cells[0]?.trim() || "unknown",
								check: "see matrix",
								failMessage: cells[cells.length - 1]?.trim() || "",
							});
						}
					}
				}
			}
		}
	}
	
	// Look for explicit pass/fail checks
	for (const pattern of PASS_FAIL_PATTERNS) {
		// Use exec in a loop to get match positions, so each occurrence gets its own context.
		const re = new RegExp(pattern.source, "gi");
		let m: RegExpExecArray | null;
		while ((m = re.exec(content)) !== null) {
			const match = m[0];
			const pos = m.index;
			const contextWindow = content.substring(
				Math.max(0, pos - 200),
				pos + match.length + 200,
			);

			if (
				/check|verify|validate|test|pass|fail|criteria|condition/i.test(contextWindow) &&
				!/best practice|recommend|suggest/i.test(contextWindow)
			) {
				gates.push({
					type: /pass|green/i.test(match) ? "green" : "red",
					condition: "explicit criteria in text",
					check: "see context",
					failMessage: "",
				});
			}
		}
	}
	
	return gates;
}

/**
 * Determine if skill is purely descriptive without enforcement
 */
function isDescriptiveOnly(content: string): boolean {
	const descriptiveIndicators = [
		/best\s+practices?\s*(only|only\s+descriptive)?/i,
		/recommendations?\s+only/i,
		/guidelines?\s+only/i,
		/no\s+(enforcement|validation|checks?)/i,
		/purely\s+descriptive/i,
		/descriptive\s+only/i,
		/\[\s*TODO.*enforce/i,
	];
	
	const hasDescriptiveOnly = descriptiveIndicators.some((pattern) =>
		pattern.test(content)
	);
	
	// Also check if all bullets are in "should" form without "must" or "shall"
	const shouldCount = (content.match(/\bshould\b/gi) || []).length;
	const mustCount = (content.match(/\bmust\b/gi) || []).length;
	const shallCount = (content.match(/\bshall\b/gi) || []).length;
	
	return hasDescriptiveOnly || (shouldCount > 10 && mustCount === 0 && shallCount === 0);
}

/**
 * Verify a single skill file
 */
function verifySkill(skillPath: string): VerificationResult {
	const result: VerificationResult = {
		skillPath,
		skillName: path.basename(path.dirname(skillPath)),
		hasTriggerSection: false,
		hasGates: false,
		gates: [],
		hasAntiPatterns: false,
		hasEnforceableGates: false,
		isDescriptiveOnly: false,
		errors: [],
		warnings: [],
		passed: false,
	};
	
	try {
		const content = fs.readFileSync(skillPath, "utf-8");
		
		// Check for trigger section
		result.hasTriggerSection = hasTriggerSection(content);
		if (!result.hasTriggerSection) {
			result.warnings.push("No trigger section found (When to Activate, Trigger, etc.)");
		}
		
		// Check for anti-patterns
		result.hasAntiPatterns = hasAntiPatternSection(content);
		if (!result.hasAntiPatterns) {
			result.warnings.push("No anti-patterns section found");
		}
		
		// Extract gates
		result.gates = extractGates(content);
		result.hasGates = result.gates.length > 0;
		
		if (!result.hasGates) {
			result.errors.push("No RED/GREEN gate found - only descriptive text");
		}
		
		// Check if purely descriptive
		result.isDescriptiveOnly = isDescriptiveOnly(content);
		if (result.isDescriptiveOnly) {
			result.warnings.push("Skill appears to be purely descriptive without enforcement");
		}
		
		// Determine if has enforceable gates
		result.hasEnforceableGates = result.hasGates && !result.isDescriptiveOnly;
		
		// Determine pass/fail
		result.passed = result.hasTriggerSection && result.hasEnforceableGates;
		
	} catch (err) {
		result.errors.push(`Failed to read skill: ${err}`);
	}
	
	return result;
}

/**
 * Format verification result for console output
 */
function formatResult(result: VerificationResult): string {
	const lines: string[] = [];
	
	lines.push(`=== Skill: ${result.skillName} ===`);
	
	if (result.hasTriggerSection) {
		lines.push("✅ Has trigger section");
	} else {
		lines.push("⚠️  No trigger section found");
	}
	
	if (result.hasGates) {
		for (const gate of result.gates.slice(0, 3)) {
			const label = gate.type.toUpperCase();
			const check = gate.check && gate.check !== "see description" ? ` (check: ${gate.check})` : "";
			lines.push(`✅ Has ${label} gate: "${gate.condition}"${check}`);
		}
		if (result.gates.length > 3) {
			lines.push(`   ... and ${result.gates.length - 3} more gates`);
		}
	} else {
		lines.push("⚠️  No RED/GREEN gate found - only descriptive text");
	}
	
	if (result.hasAntiPatterns) {
		lines.push("✅ Has anti-patterns");
	} else {
		lines.push("⚠️  No anti-patterns section");
	}
	
	if (result.warnings.length > 0) {
		for (const warning of result.warnings) {
			lines.push(`⚠️  ${warning}`);
		}
	}
	
	if (result.errors.length > 0) {
		for (const error of result.errors) {
			lines.push(`❌ ${error}`);
		}
	}
	
	if (result.passed) {
		lines.push("✅ PASS - Skill has enforceable gates");
	} else {
		lines.push("❌ FAIL - Skill lacks enforceable gates");
	}
	
	return lines.join("\n");
}

/**
 * Get all SKILL.md files in a directory
 */
function getAllSkillFiles(dirPath: string): string[] {
	const skills: string[] = [];
	
	if (!fs.existsSync(dirPath)) {
		return skills;
	}
	
	const entries = fs.readdirSync(dirPath, { withFileTypes: true });
	
	for (const entry of entries) {
		const fullPath = path.join(dirPath, entry.name);
		if (entry.isDirectory()) {
			const skillFile = path.join(fullPath, "SKILL.md");
			if (fs.existsSync(skillFile)) {
				skills.push(skillFile);
			} else {
				// Recursively search subdirectories
				skills.push(...getAllSkillFiles(fullPath));
			}
		}
	}
	
	return skills;
}

/**
 * Main entry point
 */
async function main() {
	const args = process.argv.slice(2);
	
	if (args.length === 0) {
		console.error("Usage: node scripts/verify-skill.ts <skill-path> [skill-path2 ...]");
		console.error("       node scripts/verify-skill.ts skills/   # batch mode");
		process.exit(1);
	}
	
	const results: VerificationResult[] = [];
	const exitCodeBase = 2; // warnings
	
	// Handle batch mode
	if (args.length === 1 && fs.statSync(args[0]).isDirectory()) {
		const skillFiles = getAllSkillFiles(args[0]);
		console.log(`Checking ${skillFiles.length} skills in batch mode...\n`);
		
		for (const skillFile of skillFiles) {
			const result = verifySkill(skillFile);
			results.push(result);
			console.log(formatResult(result));
			console.log("");
		}
	} else {
		// Single or multiple skill files
		for (const arg of args) {
			if (!fs.existsSync(arg)) {
				console.error(`Error: File not found: ${arg}`);
				continue;
			}
			
			if (fs.statSync(arg).isDirectory()) {
				const skillFiles = getAllSkillFiles(arg);
				for (const skillFile of skillFiles) {
					const result = verifySkill(skillFile);
					results.push(result);
					console.log(formatResult(result));
					console.log("");
				}
			} else if (arg.endsWith("SKILL.md") || arg.endsWith(".md")) {
				const result = verifySkill(arg);
				results.push(result);
				console.log(formatResult(result));
				console.log("");
			}
		}
	}
	
	// Summary
	const passed = results.filter((r) => r.passed).length;
	const failed = results.filter((r) => !r.passed && r.errors.length > 0).length;
	const warningsOnly = results.filter(
		(r) => r.passed || (r.warnings.length > 0 && r.errors.length === 0)
	).length;
	
	console.log("=== Summary ===");
	console.log(`Total: ${results.length}`);
	console.log(`Passed: ${passed}`);
	console.log(`Failed: ${failed}`);
	console.log(`Warnings only: ${warningsOnly}`);
	
	// Determine exit code
	let exitCode = 0;
	if (failed > 0) {
		exitCode = 1; // failures
	} else if (warningsOnly > 0 && passed > 0) {
		exitCode = exitCodeBase; // warnings only
	}
	
	process.exit(exitCode);
}

main().catch((err) => {
	console.error("Fatal error:", err);
	process.exit(1);
});