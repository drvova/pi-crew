# Follow-up Review — pi-crew (2026-05-12, round 3)

Tác giả: Droid (Factory) | Liên quan: `docs/code-review-2026-05-11.md`, `docs/followup-plan-2026-05-12.md`, `docs/followup-review-2026-05-12.md`. HEAD: `5bee878`.

Đây là vòng review sau khi commit `5bee878` đã giải quyết C1–C6. Mục tiêu: rà soát các module chưa được soi kỹ (event-log, atomic-write, child-pi, redaction, sleep, hooks, cleanup) để tìm rủi ro còn lại.

## Tóm tắt kết quả

- `npm run typecheck` → Passed
- `npm run check:lazy-imports` → Passed
- `npm run test:unit` → **1418 tests / 1415 pass / 0 fail / 3 skip** (212s)

Codebase ở trạng thái ổn định. Các phát hiện dưới đây là **risk thấp** hoặc **defense-in-depth**, không phải bug khẩn.

---

## Phần A — Phát hiện mới

### D1 — `event-log.appendEvent` không lock, JSONL có thể interleave trên Windows

**Severity:** Medium | **Effort:** ~30 phút | **File:** `src/state/event-log.ts:148`

**Hiện trạng:**
```ts
fs.appendFileSync(eventsPath, `${JSON.stringify(redactSecrets(fullEvent))}\n`, "utf-8");
```

**Vấn đề:**
- `fs.appendFileSync` trên POSIX chỉ atomic cho write nhỏ hơn `PIPE_BUF` (~4 KiB). Event JSON đầy đủ (có data, metadata, transcripts) có thể vượt ngưỡng → interleave dòng giữa 2 process (parent + background-runner).
- Trên Windows, append KHÔNG atomic cho mọi kích thước; 2 process append cùng eventsPath có thể tạo dòng JSON xen lẫn → `JSON.parse(line)` ở `readEvents`/`scanSequence` throw và bỏ qua dòng.
- Hệ quả: mất event, sequence số tăng nhảy, "appended: false" được trả về trong path khác (size-limit) nhưng path bình thường không có hint.

**Trigger:** chạy `background-runner` song song với parent ghi event trên cùng `eventsPath` (vd. cancel + retry liên tục).

**Fix đề xuất:**
1. Wrap `appendEvent` trong `withRunLockSync(manifest, () => { ... })` — đảm bảo exclusive access.
2. Hoặc dùng `fs.openSync(..., O_APPEND | O_WRONLY)` + retry với advisory lock (`flock` POSIX, `LockFileEx` Windows — qua npm package `proper-lockfile`).
3. Phương án nhẹ nhất: chuyển sang `appendEventAsync` qua queue/serialize.

**Test cần thêm:** stress test ở `test/integration/`: 2 process append đồng thời 100 events mỗi bên → assert tổng số dòng parse OK = 200.

---

### D2 — `event-log.sequenceCache` Map leak theo số lượng runs

**Severity:** Low | **Effort:** ~10 phút | **File:** `src/state/event-log.ts:60`

**Hiện trạng:**
```ts
const sequenceCache = new Map<string, { size: number; mtimeMs: number; seq: number }>();
```

**Vấn đề:**
- Module-level map, không bao giờ evict. Mỗi `eventsPath` (1 per run) chiếm 1 entry. Long-running parent process (vd. live-session-runtime) duy trì nhiều ngày → cache có thể tới hàng nghìn entries.
- Memory không lớn (~100 bytes/entry) nhưng vô hạn.

**Fix đề xuất:** dùng LRU đơn giản (Map có max size, evict oldest khi vượt ngưỡng), hoặc clear sau khi run kết thúc:
```ts
export function evictSequenceCache(eventsPath: string): void {
	sequenceCache.delete(eventsPath);
}
// Call from updateRunStatus(..., "completed"/"failed"/"cancelled").
```

---

### D3 — `atomicWriteFileAsync` có fallback "matches" → sync không có (parity)

**Severity:** Low | **Effort:** ~15 phút | **File:** `src/state/atomic-write.ts:122-138`

**Hiện trạng:**
```ts
// async path:
try { await renameWithRetryAsync(...); }
catch (renameError) {
	const existing = await fs.promises.readFile(filePath, "utf-8");
	const matches = existing === content;
	if (matches) { /* cleanup temp, return success */ }
	throw renameError;
}

// sync path: chỉ throw, không có fallback "matches".
```

**Vấn đề:**
- Async path "tha thứ" cho race condition (file đã được ghi đúng content bởi process khác). Sync path thì throw cứng.
- Ngữ nghĩa khác nhau → khó debug khi có ai dùng sync với race.
- Trường hợp này hiếm (cùng content), nhưng asymmetry là code smell.

**Fix đề xuất:** thêm cùng fallback cho sync, hoặc xoá fallback khỏi async (chọn 1 quy ước nhất quán):
```ts
} catch (renameError) {
	try {
		const existing = fs.readFileSync(filePath, "utf-8");
		if (existing === content) {
			try { fs.rmSync(tempPath, { force: true }); } catch { /* best-effort */ }
			return;
		}
	} catch { /* fall through */ }
	throw renameError;
}
```

---

### D4 — `withRunLock` (async) chờ deadline cho active lock, `withRunLockSync` throw ngay

**Severity:** Low | **Effort:** ~10 phút | **File:** `src/state/locks.ts:91-110`

**Hiện trạng:**
- Sync: `if (!isLockStale(...)) throw ...` → fail fast cho active lock.
- Async: chỉ check stale trong `readLockStateAsync`, không throw cho active → loop chờ tới deadline (`staleMs * 2`, thường 60s).

**Vấn đề:**
- Test `withRunLockSync throws immediately on active (non-stale) lock` đã chứng minh sync throw ngay.
- Async sẽ hang ~60s rồi mới throw → trải nghiệm cancel/retry chậm.
- BUG-004 (round 1) đặt mục tiêu unify sync ↔ async, nhưng vẫn còn asymmetry semantic này.

**Fix đề xuất:** thống nhất theo 1 trong 2:
- Sync: thêm short wait + retry tương tự async (chờ tối đa 1-2s rồi throw).
- Async: throw ngay khi lock không stale (giống sync) — thường tốt hơn vì caller có thể tự retry với context cao hơn.

```ts
async function acquireLockWithRetryAsync(filePath: string, staleMs: number): Promise<void> {
	let attempt = 0;
	const deadline = Date.now() + staleMs * 2;
	while (true) {
		try { writeLockFile(filePath); return; }
		catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code !== "EEXIST") throw error;
			if (Date.now() > deadline) throw new Error(`Run '${path.basename(filePath)}' is locked.`);
			if (!isLockStale(filePath, staleMs)) {
				throw new Error(`Run '${path.basename(filePath)}' is locked by another operation.`);
			}
			try { fs.rmSync(filePath, { force: true }); } catch { /* race */ }
			await sleep(Math.min(250, 25 * 2 ** attempt));
			attempt++;
		}
	}
}
```

**Test cần thêm:** mirror test sync — `withRunLock async throws immediately on active (non-stale) lock`.

---

### D5 — `sleep.ts` dùng `require()` trong ES module

**Severity:** Low (style) | **Effort:** ~5 phút | **File:** `src/utils/sleep.ts:18`

**Hiện trạng:**
```ts
const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
```

**Vấn đề:**
- Project là ESM (`"type": "module"`). `require` chỉ work qua strip-types backward-compat — chưa chuẩn.
- AGENTS.md: "Avoid dynamic inline imports, EXCEPT at documented lazy-load boundaries to defer heavy runtime cost (mark with `// LAZY: <reason>`)". `require` ở đây không có marker.
- `child_process` không nặng — top-level import OK.

**Fix đề xuất:**
```ts
import { execFileSync } from "node:child_process";
// ...
execFileSync("sleep", [(ms / 1000).toFixed(3)], { timeout: ms + 1000, stdio: "pipe" });
```

---

### D6 — `iteration-hooks.runIterationHook` chưa filter env như post-checks

**Severity:** Low | **Effort:** ~5 phút | **File:** `src/runtime/iteration-hooks.ts:140`

**Hiện trạng:**
```ts
env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: process.env.HOME ?? "/tmp", USER: process.env.USER, LANG: process.env.LANG, PI_CREW_HOOK: "1" },
```

**Vấn đề:**
- Đã restrict thủ công, OK với Linux. Nhưng trên Windows thiếu `USERPROFILE`, `TEMP`, `TMP`, `ComSpec`, `SystemRoot` → script `.cmd/.ps1` có thể fail.
- Post-checks.ts có cùng pattern (line 82) — không nhất quán với worktree-manager.runSetupHook đã chuyển sang `sanitizeEnvSecrets(..., { allowList: [...] })`.

**Fix đề xuất:** áp dụng `sanitizeEnvSecrets` với allowList, đồng nhất 3 chỗ (post-checks, iteration-hooks, setup-hook):
```ts
import { sanitizeEnvSecrets } from "../utils/env-filter.ts";
const HOOK_ENV_ALLOW = ["PATH", "HOME", "USER", "USERPROFILE", "TEMP", "TMP", "TMPDIR", "LANG", "LC_ALL", "ComSpec", "SystemRoot", "PI_*"];
// ...
env: { ...sanitizeEnvSecrets(process.env, { allowList: HOOK_ENV_ALLOW }), PI_CREW_HOOK: "1" },
```

**Lợi ích:**
- 1 nguồn truth cho whitelist env hook.
- Hỗ trợ Windows .cmd/.ps1 (USERPROFILE/TEMP cần thiết).
- Tránh lặp code.

---

### D7 — `cleanup.ts` git helper không force locale (consistency với worktree-manager)

**Severity:** Info | **Effort:** ~2 phút | **File:** `src/worktree/cleanup.ts:15`

**Hiện trạng:**
```ts
function git(cwd: string, args: string[]): string {
	return execFileSync("git", args, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
```

**Vấn đề:**
- `worktree-manager.ts` đã force `LANG: "C", LC_ALL: "C"` (C5 round 2). `cleanup.ts` chưa.
- Không gây bug hiện tại vì cleanup không parse error string; nhưng tương lai nếu thêm error parsing thì lại miss.
- `branch-freshness.ts` cũng cùng vấn đề.

**Fix đề xuất:** extract `git()` helper vào `src/utils/git-helper.ts` chung, dùng ở cả 3 file:
```ts
// src/utils/git-exec.ts
import { execFileSync } from "node:child_process";
export function gitExec(cwd: string, args: string[]): string {
	return execFileSync("git", args, {
		cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"],
		env: { ...process.env, LANG: "C", LC_ALL: "C" },
	}).trim();
}
```

---

### D8 — `redaction.PEM_PRIVATE_KEY_PATTERN` không giới hạn độ dài → tiềm năng ReDoS thấp

**Severity:** Info | **Effort:** ~5 phút | **File:** `src/utils/redaction.ts:7`

**Hiện trạng:**
```ts
const PEM_PRIVATE_KEY_PATTERN = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;
```

**Vấn đề:**
- Lazy `[\s\S]*?` an toàn về ReDoS, nhưng nếu input có 1 BEGIN mà không có END → backtrack tới hết string. Với JSONL transcript dài (10+ MB), regex sẽ scan toàn bộ.
- Không phải ReDoS thực sự (linear), nhưng có thể chậm.

**Fix đề xuất:** thêm hard limit 64KB cho block PEM (PEM thực tế ~3KB):
```ts
const PEM_PRIVATE_KEY_PATTERN = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]{0,65536}?-----END [A-Z ]*PRIVATE KEY-----/g;
```

Trade-off: PEM > 64KB không được redact đầy đủ. Hiếm trong thực tế.

---

### D9 — `subagent-manager.persistedSubagentPath` không validate `id` → path traversal tiềm năng

**Severity:** Low | **Effort:** ~5 phút | **File:** `src/runtime/subagent-manager.ts:58`

**Hiện trạng:**
```ts
function persistedSubagentPath(cwd: string, id: string): string {
	return path.join(projectCrewRoot(cwd), DEFAULT_PATHS.state.subagentsSubdir, `${id}.json`);
}
```

**Vấn đề:**
- `id` đang được sinh nội bộ (`agent_${Date.now().toString(36)}_${counter.toString(36)}`) → an toàn.
- Nhưng `readPersistedSubagentRecord(cwd, id)` được gọi với `id` từ external source (vd. `get_subagent_result` tool param). Nếu validation tool param thiếu, `id = "../../../etc/passwd"` có thể đọc file ngoài state dir.

**Fix đề xuất:** validate `id` matches `^[a-z0-9_]+$`:
```ts
function isValidSubagentId(id: string): boolean {
	return /^[a-z0-9_]+$/i.test(id) && id.length <= 128;
}
function persistedSubagentPath(cwd: string, id: string): string {
	if (!isValidSubagentId(id)) throw new Error(`Invalid subagent id: ${id}`);
	return path.join(projectCrewRoot(cwd), DEFAULT_PATHS.state.subagentsSubdir, `${id}.json`);
}
```

Kiểm tra schema tool `get_subagent_result` để xem có sanitize id chưa; nếu có thì D9 chỉ là defense-in-depth.

---

## Ưu tiên thực hiện

| # | Item | Severity | Effort | Khuyến nghị |
|---|---|---|---|---|
| 1 | D1 (event-log concurrent append) | Medium | 30 phút | Sprint hiện tại — chống event loss/corruption |
| 2 | D6 (hook env allowList nhất quán) | Low | 5 phút | Sprint hiện tại — đồng bộ với setup-hook fix |
| 3 | D4 (async lock fail-fast cho active) | Low | 10 phút | Sprint hiện tại — UX cancel/retry |
| 4 | D9 (subagent id validate) | Low | 5 phút | Sprint hiện tại — defense-in-depth |
| 5 | D2 (sequenceCache eviction) | Low | 10 phút | Sprint kế tiếp |
| 6 | D3 (atomic-write sync/async parity) | Low | 15 phút | Sprint kế tiếp |
| 7 | D5 (sleep.ts ESM require) | Low | 5 phút | Sprint kế tiếp |
| 8 | D7 (git helper consolidate) | Info | 2 phút | Lúc nào cũng được |
| 9 | D8 (PEM regex limit) | Info | 5 phút | Lúc nào cũng được |

**Tổng effort priority 1 (must-fix):** ~50 phút.
**Tổng effort priority 2 (nice-to-have):** ~37 phút.

---

## Đề xuất commit batches

- **Batch 1 (correctness/security):** D1 + D9 + D4 → 1 PR "event-log lock + subagent id guard + async lock parity" (~45 phút).
- **Batch 2 (hardening):** D6 + D7 + D2 → 1 PR "hook env allowList consolidation + git helper extract + cache eviction" (~20 phút).
- **Batch 3 (polish):** D3 + D5 + D8 → 1 PR "atomic-write parity + ESM cleanup + redaction limit" (~25 phút).

---

## Điểm tích cực sau round 3

- Tất cả C1–C6 (round 2) đã fix đúng theo spec.
- 1418 tests pass (so với 1411 round trước → +7 test mới), 0 fail.
- `npm run check:lazy-imports` đã chạy được trên Windows (sau khi loại bỏ `sed`).
- `sanitizeEnvSecrets` có cả deny-list (default) và allow-list mode → flexibility tốt.
- `resolveShellForScript` xử lý đúng `.bat/.cmd` chống CVE-2024-27980.
- `parent-guard` polling tốt cho cross-platform (POSIX + Windows).
- Redaction pipeline đa lớp (key-name + inline-substring + auth-header + bearer + PEM).
- Atomic-write có O_EXCL + O_NOFOLLOW + post-open `isFile()` verify.
- Subagent records persisted dưới redaction filter.
- Background runner có `parent-guard` + cleanup tempdir + final-drain timer.

---

## Vùng KHÔNG có vấn đề nghiêm trọng (đã rà)

- `src/schema/team-tool-schema.ts` — TypeBox schema có đủ literal "retry", strict additionalProperties.
- `src/state/artifact-store.ts` — path traversal blocking 2 lớp (`resolveInside` + `resolveRealContainedPath`), hash post-redaction.
- `src/state/atomic-write.ts` — symlink-safe, O_EXCL, fd-based stat verification.
- `src/worktree/worktree-manager.ts` — branchExists local+remote, prune stale, env filter, locale-safe error parse.
- `src/runtime/async-runner.ts` — jiti + strip-types fallback, đa candidate path.
- `src/runtime/child-pi.ts` — env sanitize, redacted transcript, post-exit stdio guard, hard kill timer.
- `src/runtime/parent-guard.ts` — kill(pid,0) cross-platform, unref'd interval.

---

## Verification

```
npm run typecheck            → Passed
npm run check:lazy-imports   → All dynamic imports have `// LAZY:` marker.
npm run test:unit            → 1418 tests, 1415 pass, 0 fail, 3 skip (212s)
HEAD                         → 5bee878 (fix: address followup-review C1-C6)
```
