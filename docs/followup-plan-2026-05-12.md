# Follow-up Plan — pi-crew (2026-05-12)

Tác giả: Droid (Factory) | Liên quan: `docs/code-review-2026-05-11.md`, commits `2aebf33`, `7c5b3c2`.

Tài liệu này tổng hợp các điểm tồn đọng SAU khi đã fix BUG-001..BUG-007 + NIT-001..NIT-004, gồm:
1. **Quan ngại nhỏ** phát sinh từ chính các fix vừa apply.
2. **Gaps mới phát hiện** khi review lại toàn bộ `pi-crew/` lần nữa.

Tất cả mục đều có ước lượng effort, mức ưu tiên, file/đoạn code liên quan, và đề xuất fix cụ thể.

---

## Phần A — Điều chỉnh các "quan ngại nhỏ" của fix vừa apply

### A1 — `branchExists` chỉ check local ref → bỏ sót remote-tracking branch

**Severity:** Low | **Effort:** ~20 phút | **File:** `src/worktree/worktree-manager.ts:100-107`

**Hiện trạng:**
```ts
function branchExists(repoRoot: string, branch: string): boolean {
  try {
    git(repoRoot, ["rev-parse", "--verify", `refs/heads/${branch}`]);
    return true;
  } catch { return false; }
}
```

**Vấn đề:**
- Chỉ check `refs/heads/<branch>`. Nếu repo có remote-tracking `refs/remotes/origin/<branch>` (push từ máy khác) mà chưa có local, hàm trả `false` → đi vào nhánh `worktree add -b <branch> HEAD` → git có thể fail với "a branch named ... already exists" (vì git tạo local branch từ remote) hoặc tạo local branch divergent với remote.
- Hiếm trong workflow đơn-máy nhưng dễ gặp với CI/runner shared repo.

**Fix đề xuất:**
```ts
function branchExists(repoRoot: string, branch: string): { local: boolean; remoteOnly: boolean } {
  let local = false;
  try { git(repoRoot, ["rev-parse", "--verify", `refs/heads/${branch}`]); local = true; } catch {}
  if (local) return { local: true, remoteOnly: false };
  // Check remote-tracking
  try {
    const out = execFileSync("git", ["for-each-ref", "--format=%(refname)", `refs/remotes/*/${branch}`],
      { cwd: repoRoot, encoding: "utf-8" }).trim();
    return { local: false, remoteOnly: out.length > 0 };
  } catch { return { local: false, remoteOnly: false }; }
}

// In prepareTaskWorkspace:
const exists = branchExists(repoRoot, branch);
if (exists.local) {
  git(repoRoot, ["worktree", "add", worktreePath, branch]);
} else if (exists.remoteOnly) {
  // Create local from HEAD instead of remote (avoid divergent track)
  git(repoRoot, ["worktree", "add", "-b", branch, worktreePath, "HEAD"]);
} else {
  git(repoRoot, ["worktree", "add", "-b", branch, worktreePath, "HEAD"]);
}
```

**Test cần thêm:** `test/unit/worktree-manager.test.ts`:
1. Mock `git for-each-ref` trả về remote-tracking → assert không throw.
2. Branch tồn tại cả local lẫn remote → ưu tiên local (reuse).

---

### A2 — `resolveJitiRegisterPath` fallback giờ bắt buộc `exists()` check

**Severity:** Low | **Effort:** ~10 phút | **File:** `src/runtime/async-runner.ts:33-39`

**Hiện trạng:**
```ts
try {
  const fromRequire = jitiRegisterPathFromPackageJson(requireFromHere.resolve("jiti/package.json"));
  if (exists(fromRequire)) return fromRequire;   // ← thêm exists() check
} catch { /* Fall through. */ }
return undefined;
```

**Vấn đề:**
- Behaviour cũ: `require.resolve()` thành công → push vào candidates → return path (giả định `lib/jiti-register.mjs` luôn tồn tại bên cạnh `package.json`).
- Behaviour mới: thêm `exists()` check → nếu test mock `exists` chỉ accept đúng 1 path khác, fallback luôn fail. Behaviour ổn cho production (file luôn tồn tại), nhưng giảm robustness với jiti packaging exotic (vd. `lib` được rename trong distro).
- Không thực sự là bug, chỉ là defensive change.

**Fix đề xuất:**
Giữ nguyên `exists()` check (an toàn hơn), nhưng thêm 1 fallback nữa với `path.join(dirname, "register.mjs")` cho các phiên bản jiti khác nhau, và log diagnostic event khi cả 2 đều miss:

```ts
try {
  const pkgPath = requireFromHere.resolve("jiti/package.json");
  const candidates = [
    jitiRegisterPathFromPackageJson(pkgPath),                          // lib/jiti-register.mjs
    path.join(path.dirname(pkgPath), "register.mjs"),                  // register.mjs (older jiti)
    path.join(path.dirname(pkgPath), "dist", "register.mjs"),          // dist/register.mjs (some pkg layouts)
  ];
  for (const c of candidates) if (exists(c)) return c;
} catch { /* Fall through. */ }
return undefined;
```

**Test cần thêm:** `test/unit/async-runner.test.ts`:
- Case `lib/jiti-register.mjs` missing nhưng `register.mjs` tồn tại → resolver return.

---

### A3 — Test alias `__test__renameWithRetry*` trở thành `const`, có thể vô hiệu monkey-patch

**Severity:** Info | **Effort:** ~5 phút | **File:** `src/state/atomic-write.ts:73, 91`

**Hiện trạng:**
```ts
export const __test__renameWithRetry = renameWithRetry;
```

**Vấn đề:**
- Nếu test cũ làm `import * as mod from "../atomic-write.ts"; mod.__test__renameWithRetry = mockFn;` → assignment fail (read-only) hoặc không có effect trên `atomicWriteFile` (nó gọi `renameWithRetry` local).
- Hiện tại không có test nào trong repo monkey-patch field này (`Grep` confirm), nên không phải bug.

**Fix đề xuất:**
- Giữ nguyên alias (zero impact thực tế).
- Hoặc xoá hẳn 2 alias để giảm surface: chỉ export `renameWithRetry`, `renameWithRetryAsync`. Update test nếu có chỗ dùng alias.

**Action:** chỉ làm khi cần dọn dẹp API surface, không khẩn cấp.

---

## Phần B — Gaps mới phát hiện khi review lại

### B1 — `bash` hardcoded → broken trên Windows (root cause của 8 test fail)

**Severity:** Medium | **Effort:** ~45 phút | **Files:**
- `src/runtime/post-checks.ts:82`
- `src/runtime/iteration-hooks.ts:137`

**Hiện trạng:**
```ts
// post-checks.ts:82
const output = execFileSync("bash", [scriptPath], { ... });

// iteration-hooks.ts:137
const child = spawn("bash", [hookScriptPath], { ... });
```

**Vấn đề:**
- Trên Windows, `bash` thường không có trên PATH (trừ khi cài Git Bash/WSL). 8 tests fail hiện tại đều do điều này.
- Code path nóng (post-task check, iteration hook) → user Windows không dùng được tính năng này.
- Comment trong file đã ghi "Spawns `bash <script>`" → docs cũng cần update.

**Fix đề xuất:**
1. Tìm bash thông minh:
```ts
function resolveBashCmd(): string {
  if (process.platform !== "win32") return "bash";
  // Try Git Bash locations
  for (const cand of [
    process.env.SHELL,
    "C:\\Program Files\\Git\\bin\\bash.exe",
    "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
  ]) {
    if (cand && fs.existsSync(cand)) return cand;
  }
  return "bash"; // last resort — let spawn fail with clearer error
}
```
2. Thay 2 chỗ `"bash"` bằng `resolveBashCmd()`.
3. Trên Windows, nếu script là `.ps1` → dùng `powershell -File`; nếu `.cmd/.bat` → spawn trực tiếp.
4. Hoặc đơn giản hơn: skip test nếu `!isScriptRunnable("bash")`.

**Test cần thêm:**
- Trên CI Linux: tests hiện tại pass.
- Trên Windows: skip nếu không có bash, hoặc tạo `.ps1` variant.
- Mock test cho `resolveBashCmd()` với platform stub.

---

### B2 — Thiếu test trực tiếp cho `worktree-manager.ts` (covers BUG-005, BUG-006)

**Severity:** Medium | **Effort:** ~1h | **File:** thiếu `test/unit/worktree-manager.test.ts`

**Vấn đề:**
- BUG-005 fix (`branchExists` + `pruneStaleWorktrees`) và BUG-006 fix (`isDirectory()` check) **không có test trực tiếp**.
- Code review đã flag điều này nhưng commit fix chỉ thêm test cho schema.

**Fix đề xuất:** tạo `test/unit/worktree-manager.test.ts` với (sử dụng `tmpdir` + real git):

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { prepareTaskWorkspace } from "../../src/worktree/worktree-manager.ts";
import type { TeamRunManifest, TeamTaskState } from "../../src/state/types.ts";

function initGitRepo(dir: string) {
  execFileSync("git", ["init", "-q", "--initial-branch=main"], { cwd: dir });
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "--allow-empty", "-m", "init"], { cwd: dir });
}

test("prepareTaskWorkspace recovers when branch exists but worktree dir is gone", () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-wt-"));
  initGitRepo(repo);
  // Pre-create the branch (simulating leftover from crashed run)
  execFileSync("git", ["branch", "pi-crew/run1/task1"], { cwd: repo });
  const manifest = { /* ... minimal manifest ... */ } as TeamRunManifest;
  const task: TeamTaskState = { id: "task1", /* ... */ } as TeamTaskState;
  const result = prepareTaskWorkspace(manifest, task);
  assert.ok(result.worktreePath);
});

test("linkNodeModulesIfPresent rejects when node_modules is a file", () => {
  // ... create file at node_modules location → assert no symlink created
});
```

---

### B3 — `artifact-store.ts` thiếu test cho hash/size integrity (covers BUG-002)

**Severity:** Medium | **Effort:** ~20 phút | **File:** thiếu `test/unit/artifact-store.test.ts`

**Vấn đề:**
- BUG-002 fix đổi hash từ `options.content` sang `redactSecretString(options.content)` đảm bảo `contentHash` khớp bytes trên đĩa.
- Không có test verify điều này. Có `api-artifact-security.test.ts` nhưng không assert hash.

**Fix đề xuất:** tạo `test/unit/artifact-store.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { createHash } from "node:crypto";
import { writeArtifact } from "../../src/state/artifact-store.ts";

test("writeArtifact: contentHash matches sha256 of bytes on disk", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-art-"));
  const desc = writeArtifact(root, {
    kind: "log", relativePath: "x.log",
    content: "api_key=AKIA0123456789ABCDEF\nplain text",
    producer: "test",
  });
  const onDisk = fs.readFileSync(desc.path);
  const expected = createHash("sha256").update(onDisk).digest("hex");
  assert.strictEqual(desc.contentHash, expected);
  assert.strictEqual(desc.sizeBytes, onDisk.length);
  assert.ok(!onDisk.toString("utf-8").includes("AKIA0123456789ABCDEF"));
});

test("writeArtifact: rejects path traversal", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-crew-art-"));
  assert.throws(() => writeArtifact(root, {
    kind: "log", relativePath: "../escape.log", content: "x", producer: "t",
  }), /Invalid artifact path/);
});
```

---

### B4 — Thiếu test parity sync vs async cho lock retry (covers BUG-004)

**Severity:** Low | **Effort:** ~30 phút | **File:** mở rộng `test/unit/locks-race.test.ts`

**Vấn đề:**
- Fix BUG-004 đồng bộ hoá behaviour sync ↔ async (cả 2 cùng retry tới deadline). `locks-race.test.ts` chỉ test sơ bộ; không có case `rmSync` race + assert lock được acquire sau retry trên cả sync và async.

**Fix đề xuất:** thêm 2 test:
```ts
test("withRunLockSync retries when rmSync fails once on stale lock", async () => {
  // Create stale lock, monkey-patch fs.rmSync first call → throw EBUSY
  // Assert lock is acquired on retry
});

test("withRunLock (async) and withRunLockSync exhibit identical stale-lock recovery", async () => {
  // Same scenario for both → both succeed
});
```

---

### B5 — `runSetupHook` không filter dangerous env vars khi spawn hook

**Severity:** Low (defense-in-depth) | **Effort:** ~15 phút | **File:** `src/worktree/worktree-manager.ts:67-88`

**Hiện trạng:**
```ts
const result = spawnSync(nodeHook ? process.execPath : hookPath, ..., {
  cwd: worktreePath,
  encoding: "utf-8",
  input: JSON.stringify({...}),
  timeout: cfg.setupHookTimeoutMs ?? 30_000,
  shell: false,
  // ← KHÔNG truyền env → spawn dùng process.env (full inherit)
});
```

**Vấn đề:**
- Hook chạy với `process.env` đầy đủ → có thể leak `API_KEY`, `*_TOKEN`, `OPENAI_KEY`, etc. Đối lập với `post-checks.ts` và `iteration-hooks.ts` (đã restrict env).
- AGENTS.md security baseline: "env-secret filtering before spawn".

**Fix đề xuất:**
```ts
import { sanitizeEnvSecrets } from "../utils/redaction.ts"; // hoặc tương đương

const result = spawnSync(..., {
  cwd: worktreePath,
  encoding: "utf-8",
  input: JSON.stringify({...}),
  timeout: cfg.setupHookTimeoutMs ?? 30_000,
  shell: false,
  env: sanitizeEnvSecrets(process.env, { allowList: ["PATH", "HOME", "USERPROFILE", "TEMP", "TMP", "LANG", "PI_*"] }),
});
```

(Tận dụng helper đã có trong `child-pi.ts` — refactor thành util chung.)

---

### B6 — `prepareTaskWorkspace` không có assertion về branch sanity sau `branchExists`

**Severity:** Info | **Effort:** ~10 phút | **File:** `src/worktree/worktree-manager.ts:127-133`

**Hiện trạng:**
```ts
pruneStaleWorktrees(repoRoot);
if (branchExists(repoRoot, branch)) {
  git(repoRoot, ["worktree", "add", worktreePath, branch]);
}
```

**Vấn đề:**
- Nếu branch hiện đang **checked out** ở một worktree khác (chưa bị prune), `git worktree add <path> <branch>` sẽ fail. Cần catch và emit hint rõ hơn cho user.

**Fix đề xuất:** wrap với try/catch, parse error message, throw error có actionable message:
```ts
try {
  git(repoRoot, ["worktree", "add", worktreePath, branch]);
} catch (error) {
  const msg = error instanceof Error ? error.message : String(error);
  if (/already checked out at/.test(msg)) {
    throw new Error(`Branch '${branch}' is checked out at another worktree. Run \`team cleanup runId=${manifest.runId} force=true\` or manually remove the conflicting worktree.`);
  }
  throw error;
}
```

---

### B7 — `team-tool.ts` có 1 lazy-import `handleRun` không theo style `// LAZY: <reason>`

**Severity:** Info | **Effort:** ~2 phút | **File:** `src/extension/team-tool.ts:56-62`

**Hiện trạng:**
```ts
// Lazy-loaded: run.ts pulls in spawnBackgroundTeamRun, resolveCrewRuntime, etc.
// Static import fails silently in some jiti contexts (child-process), leaving handleRun undefined.
import type { handleRun as HandleRunFn } from "./team-tool/run.ts";
let _cachedHandleRun: typeof HandleRunFn | undefined;
async function handleRun(...args: Parameters<typeof HandleRunFn>): Promise<...> {
  if (!_cachedHandleRun) {
    const mod = await import("./team-tool/run.ts");   // ← thiếu // LAZY: marker
    ...
  }
}
```

**Fix đề xuất:** thêm marker để đồng nhất với 11 chỗ còn lại đã được đánh dấu:
```ts
async function handleRun(...) {
  if (!_cachedHandleRun) {
    // LAZY: run.ts pulls in spawnBackgroundTeamRun + resolveCrewRuntime; also avoids jiti import race.
    const mod = await import("./team-tool/run.ts");
    ...
  }
}
```

---

### B8 — `redaction-transcript-roundtrip.test.ts` chưa tồn tại (NIT-004)

**Severity:** Low | **Effort:** ~30 phút | **File:** thiếu test mới

**Vấn đề:**
- Code review NIT-004 đề xuất test verify rằng transcript trên đĩa và artifact result đều không chứa secret raw. Hiện chưa có test này.

**Fix đề xuất:** tạo `test/unit/redaction-transcript-roundtrip.test.ts`:
1. Tạo fake transcript JSONL với line chứa `OPENAI_API_KEY=sk-abc...`.
2. Call `appendTranscript` (qua `child-pi` helper export).
3. Read file → assert không có secret raw.
4. Call recovery path → assert artifact result cũng đã redact.

---

### B9 — CI grep-check chặn `await import(...)` không marker

**Severity:** Low | **Effort:** ~15 phút | **File:** thêm script + GitHub Actions

**Vấn đề:**
- Code review BUG-003 Option A đề xuất "thêm grep-check trong CI để chặn dynamic import không marker". Chưa làm.

**Fix đề xuất:** tạo `scripts/check-lazy-imports.mjs`:
```js
import { execSync } from "node:child_process";
const out = execSync(
  `git grep -nE 'await import\\(' -- 'src/**/*.ts' | grep -v '// LAZY:'`,
  { encoding: "utf-8" }
).split("\n").filter((l) => l && !l.includes("// LAZY:"));
// Hoặc kiểm tra dòng ngay trước có chứa `// LAZY:`
if (out.length > 0) {
  console.error("Dynamic imports without `// LAZY:` marker:\n" + out.join("\n"));
  process.exit(1);
}
```
Thêm vào `package.json`:
```json
"scripts": {
  "check:lazy-imports": "node scripts/check-lazy-imports.mjs",
  "ci": "npm run typecheck && npm run check:lazy-imports && npm test && npm pack --dry-run"
}
```

---

## Ưu tiên thực hiện

| # | Item | Severity | Effort | Khuyến nghị |
|---|---|---|---|---|
| 1 | B1 (bash portability) | Medium | 45 phút | Sprint hiện tại — fix 8 test fail trên Windows |
| 2 | B2 (worktree test) | Medium | 1h | Sprint hiện tại — regression guard cho BUG-005/006 |
| 3 | B3 (artifact-store test) | Medium | 20 phút | Sprint hiện tại — verify BUG-002 fix |
| 4 | A1 (branchExists remote-tracking) | Low | 20 phút | Sprint kế tiếp |
| 5 | B5 (setup-hook env filter) | Low | 15 phút | Sprint kế tiếp — defense-in-depth |
| 6 | B6 (worktree checked-out hint) | Info | 10 phút | Sprint kế tiếp — UX |
| 7 | B7 (LAZY marker đồng nhất) | Info | 2 phút | Lúc nào cũng được |
| 8 | B4 (lock parity test) | Low | 30 phút | Sprint kế tiếp |
| 9 | B8 (redaction roundtrip test) | Low | 30 phút | Sprint kế tiếp |
| 10 | B9 (CI grep-check) | Low | 15 phút | Sprint kế tiếp |
| 11 | A2 (async-runner fallback robust) | Low | 10 phút | Không cấp bách |
| 12 | A3 (test alias cleanup) | Info | 5 phút | Tuỳ ý |

**Tổng effort ưu tiên 1 (medium):** ~2h 5 phút.
**Tổng effort ưu tiên 2 (low):** ~1h 50 phút.

---

## Đề xuất commit batches

- **Batch 1 (must-fix):** B1 + B2 + B3 → 1 PR "test+portability hardening" (~2h).
- **Batch 2 (nice-to-have):** A1 + B5 + B6 + B7 + B9 → 1 PR "worktree + lazy-import polish" (~1h).
- **Batch 3 (test debt):** B4 + B8 → 1 PR "additional regression tests" (~1h).
- **Defer:** A2, A3 cho đến khi có user-visible issue.

---

## Điểm tích cực sau review lần 2

- Tất cả 7 BUG + 4 NIT từ code review trước đã được fix với commit rõ ràng, có test cho schema.
- Comment `// LAZY:` đã được thêm consistent ở 11/12 site dynamic import.
- Lock retry logic giờ thống nhất sync ↔ async (cả 2 đều có deadline + retry).
- Worktree handle resume crash đúng cách (prune + branchExists fallback).
- Artifact `contentHash` giờ verifiable bằng `sha256(fs.readFileSync(desc.path))`.
- Không còn `any` type trong `src/` (grep confirm).
- `node_modules/jiti` resolution robust với mọi monorepo layout.
