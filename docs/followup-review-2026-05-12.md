# Follow-up Review — pi-crew (2026-05-12, round 2)

Tác giả: Droid (Factory) | Liên quan: `docs/followup-plan-2026-05-12.md`, commit `926e6ee`.

Review lại sau khi commit `926e6ee` đã apply các fix B1–B9 + A1–A2 từ `followup-plan-2026-05-12.md`.

## Tóm tắt kết quả

- `npm run typecheck` → Passed
- `npm run test:unit` → **1411 tests / 1408 pass / 0 fail / 3 skip** (trước: 1389/1400 với 8 fail bash-on-Windows)
- `npm run check:lazy-imports` → **FAIL trên Windows** (chi tiết bên dưới)

## Trạng thái từng item

| # | Item | Trạng thái | Ghi chú |
|---|---|---|---|
| B1 | bash portability | ✅ Done | `resolveShellForScript` + `resolveBashCmd` trong `src/utils/resolve-shell.ts`. Áp dụng `post-checks.ts` + `iteration-hooks.ts`. 8 test fail trước đây pass. |
| B2 | `worktree-manager.test.ts` | ⚠️ Partial | Có 3 test (branch recovery, reuse, clean leader). Thiếu test `linkNodeModulesIfPresent` reject file. |
| B3 | `artifact-store.test.ts` | ✅ Done | Hash integrity + path traversal + nested dirs. |
| B4 | lock parity test | ✅ Done | 2 test mới: stale recovery sync+async, active lock throws. |
| B5 | setup-hook env filter | ⚠️ Partial | `sanitizeEnvSecrets` đã apply. Dùng deny-list `SECRET_KEY_PATTERN` thay vì allow-list như plan đề xuất. |
| B6 | worktree checked-out hint | ✅ Done | try/catch + actionable error message. |
| B7 | LAZY marker | ✅ Done | Marker tại `team-tool.ts:58`. |
| B8 | redaction roundtrip | ✅ Done | 3 test (api_key, bearer, on-disk). |
| B9 | CI grep-check | ❌ Broken on Windows | Script dùng `sed`, fail trên Windows. |
| A1 | branchExists remote-tracking | ✅ Done | Trả `{ local, remoteOnly }`. |
| A2 | jiti fallback robust | ✅ Done | 3 candidates: `lib/jiti-register.mjs`, `register.mjs`, `dist/register.mjs`. |
| A3 | test alias cleanup | ⏭️ Skipped | Plan ghi "không khẩn cấp". |

---

## Vấn đề cần xử lý tiếp

### C1 — (Medium, ~10 phút) `scripts/check-lazy-imports.mjs` không chạy được trên Windows

**File:** `scripts/check-lazy-imports.mjs`

**Vấn đề:**
- Script dùng `execSync("sed -n '...' ...")` để đọc dòng trước → `sed` không có trên Windows mặc định.
- Khi sed fail, mỗi line đi vào `catch` block → `bad.push(line)` → false positive 13 mục.
- `npm run ci` sẽ luôn fail trên Windows dev local.

**Fix đề xuất:** dùng Node thuần thay sed.

```js
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const out = execSync(`git grep -nE "await import\\(" -- "src/**/*.ts"`, { encoding: "utf-8" });
const bad = [];
const fileCache = new Map();

for (const line of out.split("\n").filter(Boolean)) {
	if (line.includes("// LAZY:")) continue;
	const m = line.match(/^([^:]+):(\d+):/);
	if (!m) continue;
	const [, file, lineNum] = m;
	if (!fileCache.has(file)) fileCache.set(file, readFileSync(file, "utf-8").split(/\r?\n/));
	const lines = fileCache.get(file);
	const prevLine = lines[Number(lineNum) - 2] ?? "";
	if (!prevLine.includes("// LAZY:")) bad.push(line);
}

if (bad.length) {
	console.error("Dynamic imports without `// LAZY:` marker:\n" + bad.join("\n"));
	process.exit(1);
}
console.log("All dynamic imports have `// LAZY:` marker.");
```

**Test:** chạy `npm run check:lazy-imports` trên cả Linux và Windows → cả 2 expect "All dynamic imports have `// LAZY:` marker."

---

### C2 — (Medium, ~20 phút) `sanitizeEnvSecrets` dùng deny-list, không đạt mục tiêu defense-in-depth của plan B5

**File:** `src/utils/env-filter.ts`

**Hiện trạng:**
```ts
export function sanitizeEnvSecrets(env: NodeJS.ProcessEnv): Record<string, string> {
	const filtered: Record<string, string> = {};
	for (const [key, value] of Object.entries(env)) {
		if (value !== undefined && !SECRET_KEY_PATTERN.test(key)) filtered[key] = value;
	}
	return filtered;
}
```

**Vấn đề:**
- Deny-list chỉ chặn key matching `SECRET_KEY_PATTERN`. Biến có tên không khớp (vd. `DB_PASS`, `MY_KEY_FOO`, `INTERNAL_TOKEN_LEGACY`) sẽ rò sang setup hook.
- Plan B5 nguyên thuỷ đề xuất allow-list `["PATH", "HOME", "USERPROFILE", "TEMP", "TMP", "LANG", "PI_*"]` → an toàn hơn nhiều cho user-provided hooks.

**Fix đề xuất:** thêm overload với allow-list, giữ deny-list mặc định cho `buildChildPiSpawnOptions` (backward-compat).

```ts
export interface SanitizeOptions {
	allowList?: string[];   // glob-like, hỗ trợ * cuối (vd. "PI_*")
}

export function sanitizeEnvSecrets(env: NodeJS.ProcessEnv, options?: SanitizeOptions): Record<string, string> {
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
```

**Apply tại `worktree-manager.ts:runSetupHook`:**

```ts
env: sanitizeEnvSecrets(process.env, {
	allowList: ["PATH", "HOME", "USERPROFILE", "TEMP", "TMP", "TMPDIR", "LANG", "LC_ALL", "PI_*"],
}),
```

**Test cần thêm:** `test/unit/env-filter.test.ts`:
- Allow-list pass-through cho key match + reject còn lại.
- Glob `PI_*` match `PI_HOME`, `PI_CREW_X` nhưng không match `PIPELINE`.
- Default deny-list giữ behaviour cũ.

---

### C3 — (Low, ~10 phút) `resolveShellForScript` chưa xử lý đúng `.cmd/.bat` trên Windows

**File:** `src/utils/resolve-shell.ts`

**Hiện trạng:**
```ts
if (scriptPath.endsWith(".cmd") || scriptPath.endsWith(".bat")) {
	return { command: scriptPath, args: [] };
}
```

**Vấn đề:**
- Node ≥ 20 chặn spawn trực tiếp `.bat/.cmd` mà không có `shell: true` (CVE-2024-27980). Đường code `execFileSync/spawn` sẽ throw `EINVAL` hoặc `ENOENT`.
- Hệ quả: post-check / iteration-hook viết bằng `.cmd/.bat` sẽ fail âm thầm trên Node 20+.

**Fix đề xuất:**
```ts
if (scriptPath.endsWith(".cmd") || scriptPath.endsWith(".bat")) {
	return { command: process.env.ComSpec ?? "cmd.exe", args: ["/d", "/s", "/c", scriptPath] };
}
```

**Test cần thêm:** trong `test/unit/resolve-shell.test.ts` (tạo mới):
- Linux: `.sh` → `{ bash, [path] }`.
- Windows + `.ps1` → `{ powershell, ["-File", path] }`.
- Windows + `.cmd` → `{ cmd.exe, ["/d", "/s", "/c", path] }`.

---

### C4 — (Low, ~15 phút) Thiếu test `linkNodeModulesIfPresent` reject file source (BUG-006 regression guard)

**File:** `test/unit/worktree-manager.test.ts`

**Vấn đề:**
- Plan B2 yêu cầu test này nhưng commit chưa thêm. Nếu ai sửa lại `linkNodeModulesIfPresent` mà bỏ check `isDirectory()`, BUG-006 sẽ regression mà không bị test bắt.

**Fix đề xuất:** thêm 1 test (giả định `linkNodeModulesIfPresent` được export hoặc test gián tiếp qua `prepareTaskWorkspace` với `worktree.linkNodeModules=true`):

```ts
test("prepareTaskWorkspace skips linkNodeModules when source is a file", () => {
	const repo = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-wt-fn-"));
	initGitRepo(repo);
	// Place a FILE at node_modules instead of a directory
	fs.writeFileSync(path.join(repo, "node_modules"), "not a dir", "utf-8");
	// Write project config to enable linkNodeModules
	const cfgDir = path.join(repo, ".crew");
	fs.mkdirSync(cfgDir, { recursive: true });
	fs.writeFileSync(path.join(cfgDir, "config.json"), JSON.stringify({
		worktree: { linkNodeModules: true },
	}), "utf-8");
	const manifest = minimalManifest(repo, "run-fn");
	const task = minimalTask("task-fn", repo);
	const result = prepareTaskWorkspace(manifest, task);
	assert.equal(result.nodeModulesLinked, false);
	fs.rmSync(repo, { recursive: true, force: true });
});
```

---

### C5 — (Low, ~5 phút) `prepareTaskWorkspace` error message bị ảnh hưởng locale

**File:** `src/worktree/worktree-manager.ts:127-140` (try/catch quanh `worktree add`)

**Vấn đề:**
- Regex `/already checked out/` chỉ match khi git chạy với English locale. Trên máy user có `LANG=vi_VN` hoặc Git for Windows với locale khác, message gốc khác → fallback throw error raw.

**Fix đề xuất:** force English locale cho git command nội bộ, hoặc mở rộng regex.

Option A (đơn giản hơn): mở rộng regex
```ts
if (/already checked out|is already used by worktree|đã được/i.test(msg)) { ... }
```

Option B (kiến nghị): force LANG=C trong helper `git()`:
```ts
function git(cwd: string, args: string[]): string {
	return execFileSync("git", args, {
		cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"],
		env: { ...process.env, LANG: "C", LC_ALL: "C" },
	}).trim();
}
```

Option B chuẩn hoá toàn bộ output git → cải thiện cả debugging.

---

### C6 — (Info, ~5 phút) `branchExists` remote-only tạo local từ HEAD, có thể "mất" commits của remote

**File:** `src/worktree/worktree-manager.ts:prepareTaskWorkspace`

**Hiện trạng:**
```ts
if (exists.local) {
	git(repoRoot, ["worktree", "add", worktreePath, branch]);
} else {
	git(repoRoot, ["worktree", "add", "-b", branch, worktreePath, "HEAD"]);  // ← cả remoteOnly và "không tồn tại" đều rơi vào đây
}
```

**Vấn đề:**
- Khi `remoteOnly === true`, plan A1 đề xuất tạo local từ HEAD để tránh divergent tracking. Code hiện tại làm đúng vậy, nhưng:
  - Người dùng push branch từ máy khác → expect worktree chứa code đó.
  - Không có log/warning → silent drop.

**Fix đề xuất:** emit info event/log khi rơi vào nhánh remoteOnly:
```ts
} else {
	if (exists.remoteOnly) {
		logInternalError("worktree.branchRemoteOnly", new Error(`Branch '${branch}' exists only on remote; creating local from HEAD instead of tracking remote.`), `branch=${branch}`);
	}
	git(repoRoot, ["worktree", "add", "-b", branch, worktreePath, "HEAD"]);
}
```

(Hoặc đẩy lên qua run event nếu có event bus thuận tiện.)

---

## Ưu tiên thực hiện

| # | Item | Severity | Effort | Khuyến nghị |
|---|---|---|---|---|
| 1 | C1 (lazy-imports cross-platform) | Medium | 10 phút | Sprint hiện tại — chặn CI fail trên Windows |
| 2 | C2 (allow-list env filter) | Medium | 20 phút | Sprint hiện tại — defense-in-depth |
| 3 | C3 (.cmd/.bat trên Node 20+) | Low | 10 phút | Sprint hiện tại — đảm bảo B1 thực sự portable |
| 4 | C4 (test linkNodeModules file source) | Low | 15 phút | Sprint hiện tại — đóng gap regression của B2 |
| 5 | C5 (git locale-safe error parsing) | Low | 5 phút | Sprint kế tiếp |
| 6 | C6 (warn khi remote-only branch) | Info | 5 phút | Sprint kế tiếp |

**Tổng effort:** ~65 phút cho batch hardening.

---

## Đề xuất commit batches

- **Batch 1 (must-fix CI):** C1 + C3 → 1 PR "scripts/cmd portability fix" (~20 phút).
- **Batch 2 (security/test):** C2 + C4 → 1 PR "env allow-list + worktree regression test" (~35 phút).
- **Batch 3 (polish):** C5 + C6 → 1 PR "git locale + remote-only branch hint" (~10 phút).

---

## Điểm tích cực sau review lần 3

- 8 bash-on-Windows test fail trước đây giờ pass 100%.
- DRY refactor `sanitizeEnvSecrets` (extract từ `child-pi.ts`) tốt.
- `worktree-manager` resume logic + actionable error rất hữu ích cho UX.
- Lock parity test cover cả 2 path sync/async (chính xác mục tiêu BUG-004).
- Artifact hash test verify đúng invariant `sha256(file) == contentHash`.
- `resolveJitiRegisterPath` giờ chịu được nhiều packaging layout của jiti.
- `branchExists` upgrade `{local, remoteOnly}` chính xác theo plan A1.

---

## Verification

```
npm run typecheck                  → Passed
npm run check:lazy-imports         → Fails on Windows (sed not found)
npm run test:unit                  → 1411 tests, 1408 pass, 0 fail, 3 skip (227s)
git show 926e6ee --stat            → 16 files changed, 797(+) 22(-)
```
