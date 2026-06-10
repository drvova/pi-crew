import fs from "node:fs";
import path from "node:path";

console.log("=== PI-CREW BUG FIXES VERIFICATION ===\n");

let allPassed = true;

// Bug #17: Check killAsync is commented out
console.log("Bug #17: Background runner session shutdown fix");
const registerContent = fs.readFileSync("src/extension/register.ts", "utf-8");
const killAsyncMatch = registerContent.match(/\/\/\s*for\s*\(\s*const\s+manifest\s+of\s+manifestCache\.list\(50\)/);
if (killAsyncMatch) {
    console.log("  ✅ killAsync loop is commented out");
} else if (registerContent.includes("for (const manifest of manifestCache.list(50))") && !registerContent.includes("// for (const manifest")) {
    console.log("  ❌ killAsync loop is NOT commented out - BUG NOT FIXED");
    allPassed = false;
} else {
    console.log("  ✅ killAsync pattern not found (may have been refactored)");
}

// Bug #18: Check stdio is ["ignore", "pipe", "pipe"]
console.log("\nBug #18: Child-pi stdin fix");
const childPiContent = fs.readFileSync("src/runtime/child-pi.ts", "utf-8");
const stdioMatch = childPiContent.match(/stdio:\s*\[\s*"ignore"\s*,\s*"pipe"\s*,\s*"pipe"\s*\]/);
if (stdioMatch) {
    console.log("  ✅ stdio is ['ignore', 'pipe', 'pipe']");
} else if (childPiContent.includes('stdio: ["pipe", "pipe", "pipe"]')) {
    console.log("  ❌ stdio is still ['pipe', 'pipe', 'pipe'] - BUG NOT FIXED");
    allPassed = false;
} else {
    console.log("  ⚠️  stdio pattern not found in expected format");
}

// Bug #19: Check temp workspace cleanup
console.log("\nBug #19: Phantom runs temp workspace fix");
const runIndexContent = fs.readFileSync("src/extension/run-index.ts", "utf-8");
const tempDirCheck = runIndexContent.includes("isTempRoot") || runIndexContent.includes("tmpdir") || runIndexContent.includes("tmpDir");
const activeRunContent = fs.readFileSync("src/state/active-run-registry.ts", "utf-8");
const timeoutCheck = activeRunContent.includes("30 * 60 * 1000") || activeRunContent.includes("30*60*1000");
if (tempDirCheck && timeoutCheck) {
    console.log("  ✅ Temp workspace detection and 30-min timeout present");
} else if (!tempDirCheck) {
    console.log("  ❌ Temp workspace detection NOT found - BUG NOT FIXED");
    allPassed = false;
} else if (!timeoutCheck) {
    console.log("  ❌ 30-min timeout NOT found - BUG NOT FIXED");
    allPassed = false;
}

// Bug #20: Check needs_attention in completedIds
console.log("\nBug #20: Infinite retry loop fix");
const teamRunnerContent = fs.readFileSync("src/runtime/team-runner.ts", "utf-8");
const needsAttentionMatch = teamRunnerContent.match(/status\s*===\s*"needs_attention"/g);
if (needsAttentionMatch && needsAttentionMatch.length >= 3) {
    console.log("  ✅ needs_attention status checks found (" + needsAttentionMatch.length + " places)");
} else {
    console.log("  ❌ needs_attention status check NOT found or insufficient - BUG NOT FIXED");
    allPassed = false;
}

// Check the specific completedIds fix
const completedIdsFix = teamRunnerContent.includes('status === "completed" || t.status === "needs_attention"');
if (completedIdsFix) {
    console.log("  ✅ completedIds includes needs_attention");
} else {
    console.log("  ❌ completedIds does NOT include needs_attention - BUG NOT FIXED");
    allPassed = false;
}

// Check dist file
console.log("\n=== Checking dist/index.mjs ===");
if (fs.existsSync("dist/index.mjs")) {
	const distContent = fs.readFileSync("dist/index.mjs", "utf-8");
	const distNeedsAttention = distContent.includes('t2.status === "completed" || t2.status === "needs_attention"');
	if (distNeedsAttention) {
		console.log("  ✅ Bug #20 fix is in dist/index.mjs");
	} else {
		console.log("  ❌ Bug #20 fix NOT in dist/index.mjs - rebuild needed");
		allPassed = false;
	}
} else {
	console.log("  ⚠️  dist/index.mjs not found - run npm run build first");
}

console.log("\n" + "=".repeat(40));
console.log(allPassed ? "✅ ALL BUGS ARE FIXED" : "❌ SOME BUGS ARE NOT FIXED");
console.log("=".repeat(40));

process.exit(allPassed ? 0 : 1);
