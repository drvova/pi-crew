# Optimization Plan — pi-crew v0.9.26 (verified, bench-first)

> Kế hoạch tối ưu hiệu năng đã **verify từng giả định trên code hiện tại** (v0.9.26).
> Khác với các review tĩnh trước, plan này phân loại đề xuất theo **độ chắc chắn của win**
> và **rủi ro correctness**, và bắt buộc **đo trước khi sửa** (bench-first) cho mọi item
> có nghi vấn về mức tác động.
>
> Nền tảng: `docs/perf/performance-review-2026-07.md` (F1–F21) + phần re-verify trong
> phiên review 2026-07-08. Mọi finding đã đối chiếu lại file:line bên dưới.

---

## 0. Nguyên tắc & tổng quan

### Nguyên tắc thực thi
1. **Bench-first**: mỗi item có nghi vấn về mức win (F1, F2, F3, F4) PHẢI có micro-bench trước/sau. Repo đã có harness `test/bench/*.bench.ts` + `npm run bench` + `npm run bench:check` (so với `test/bench/baseline.json`).
2. **Windows là môi trường nghiệm thu chính** — `fsync`/`stat`/`spawn` đắt hơn Linux nhiều lần; win phải hiện trên Windows.
3. **Không đánh đổi correctness lấy tốc độ**: các item chạm state/durability chỉ merge khi `npm test` (unit + integration) xanh, không riêng typecheck.
4. **Từng PR nhỏ, 1 finding/PR**, có rollback rõ ràng (feature flag hoặc config override khi có thể).

### Bảng phân loại (kết luận từ phần verify)

| Item | Win thực tế | Rủi ro | Phase | Ghi chú verify |
|---|---|---|---|---|
| **F17** resolve/cache discoverWorkflows | Cao (tới 5 Hz → ~0) | Thấp | 1 | `powerbar-publisher.ts:284` gọi qua coalescer 200ms; `discover-workflows.ts` **0 cache** |
| **F15** TTL discovery + cache teams/workflows | TB–Cao | Thấp | 1 | `discover-agents.ts:493` TTL=500ms; teams/workflows không cache |
| **F4** durability `best-effort` cho write informational | TB (Cao trên Windows) | Thấp | 1 | `atomic-write.ts:384,409-411` fsync data+dir vô điều kiện |
| **F9** ring-buffer rawTextEvents | Thấp–TB (run dài) | Thấp | 1 | `child-pi.ts:577,636` push không cap |
| **F2** gộp 3 stat liên tiếp → 1 | Thấp | Thấp | 2 | `state-helpers.ts:76-113`: 3 stat sync liên tiếp, không I/O giữa chúng = rác |
| **F3a** fsync chỉ terminal events | TB | TB | 2 | `event-log.ts:540-548` fsync mỗi event non-terminal |
| **F5** cache symlink check theo dirname | Thấp | Thấp | 2 | `atomic-write.ts:323,394` gọi 2×/write, không cache |
| **F1** generation counter per-stateRoot | Thấp (chỉ multi-run) | Thấp | 2 | `state-store.ts:132,645` global bump |
| **F12** finalDrain kết thúc sớm khi stdout im lặng | TB (chỉ ca child treo) | TB (kill sớm) | 3 | `child-pi.ts:1145-1185`: timer là MAX, clear khi child tự exit |
| **F3b** mở rộng buffering event-log | Cao nếu chạy được | **Cao (deadlock)** | 3 | `414b973` đã revert vì deadlock |
| **F6** mailbox delivery append-only | Cao | Cao (refactor) | 3 | `mailbox.ts:399-411` full rewrite + fsync/message |
| **In-memory task state** | Cao (dài hạn) | Cao | 3 | Loại bỏ read-modify-write của F1/F2/F4 |

> **Rút lại so với bản nháp trước**: "giảm `finalDrainMs` 5000→1500" (blind) bị loại — timer là timeout an toàn, clear khi child thoát sạch; giảm cứng = rủi ro SIGTERM sớm. Thay bằng F12 (early-exit-on-silence). "Bỏ CAS trong F2" bị loại — CAS bảo vệ writer best-effort không cầm lock (`async-notifier.ts:54`, `crash-recovery.ts:98/416/464`); chỉ gộp 3 stat thừa.

---

## Phase 0 — Baseline đo lường (bench-first)

**Mục tiêu**: có số liệu trước/sau cho các item nghi vấn, tránh tối ưu nhầm chỗ.

### 0.1 Bench mới cần thêm (`test/bench/`)

Theo pattern hiện có (mỗi file in đúng 1 dòng JSON `{ name, ... }` trên stdout; đọc `BENCH_ITERS`):

1. **`discover-workflows.bench.ts`** — đo `discoverWorkflows(cwd)` lặp N lần trong 1 project có ≥8 builtin workflow.
   - Kịch bản A: gọi liên tiếp (đo cost thô hiện tại).
   - Kịch bản B: sau khi wire cache (Phase 1) — kỳ vọng p50 sụt >10×.
2. **`persist-single-task-update.bench.ts`** — dựng manifest + tasks.json giả (20–50 task), gọi `persistSingleTaskUpdate` N lần; đếm wall-time p50/p95. Dùng để nghiệm thu F2 (gộp stat) và F4 (coalesce đã có).
3. **`config-load.bench.ts`** *(nếu chưa có)* — `loadConfig(cwd)` N lần, cache hit vs cold (đã fix F16, dùng làm regression guard).

`atomic-write.bench.ts` và `event-append.bench.ts` **đã tồn tại** → mở rộng thêm biến thể `durability: best-effort` (F4) và `terminal vs non-terminal fsync` (F3a).

### 0.2 Quy trình đo
```bash
# Baseline (trước mọi thay đổi) — chạy trên Windows VÀ Linux
BENCH_ITERS=500 npm run bench
copy test\bench\results.json test\bench\baseline-2026-07-pre.json   # Windows
# Sau mỗi Phase:
npm run bench ; npm run bench:check      # so với baseline
```

### 0.3 Tiêu chí "đáng làm"
Một item chỉ tiếp tục nếu bench cho thấy **p50 hoặc p95 giảm ≥15%** trên Windows cho hot path liên quan, HOẶC nó chặn một class lỗi (memory leak F9). Nếu không đạt → hạ ưu tiên/hoãn.

---

## Phase 1 — High-confidence, low-risk wins

### F17 — Cache/resolve `discoverWorkflows` (win lớn nhất, rủi ro ~0)

**Vấn đề (verified)**: `src/ui/powerbar-publisher.ts:284` `buildStepsPayload` gọi `allWorkflows(discoverWorkflows(run.cwd))` mỗi lần render. Powerbar chạy qua `powerbarCoalescer` 200ms (`:342`) → tới **5 Hz** khi run active + có event. `discoverWorkflows` (`src/workflows/discover-workflows.ts:191`) **không cache**: mỗi call = `readWorkflowDir` × 3 root, mỗi root `readdirSync` **2 lần** (static `.workflow.md` + dynamic `.dwf.ts`) + `readFileSync` + regex-parse toàn bộ mỗi file `.workflow.md`.

**Fix (2 lớp, làm cả hai)**:

**(a) TTL cache trong `discover-workflows.ts`** — mirror `discover-agents.ts:493-556`:
```ts
// discover-workflows.ts
const WORKFLOW_DISCOVERY_TTL_MS = 5000;
const WORKFLOW_DISCOVERY_MAX_ENTRIES = 32;
interface CachedWorkflowEntry { result: WorkflowDiscoveryResult; expiresAt: number; dirStamp: string; }
const workflowCache = new Map<string, CachedWorkflowEntry>();

// stamp = mtime của 3 dir gốc; nếu dir đổi → invalidate sớm (rẻ hơn scan)
function dirStamp(cwd: string): string {
	const dirs = [
		path.join(packageRoot(), "workflows"),
		path.join(userPiRoot(), "workflows"),
		path.join(projectCrewRoot(cwd), "workflows"),
	];
	return dirs.map((d) => { try { return `${fs.statSync(d).mtimeMs}`; } catch { return "0"; } }).join("|");
}

export function invalidateWorkflowDiscoveryCache(cwd?: string): void {
	if (cwd) workflowCache.delete(cwd); else workflowCache.clear();
}

export function discoverWorkflows(cwd: string): WorkflowDiscoveryResult {
	if (!cwd || typeof cwd !== "string") return { builtin: [], user: [], project: [] };
	const now = Date.now();
	const stamp = dirStamp(cwd);
	const cached = workflowCache.get(cwd);
	if (cached && cached.expiresAt > now && cached.dirStamp === stamp) return cached.result;
	const result = { /* ...readWorkflowDir × 3 như cũ... */ };
	workflowCache.set(cwd, { result, expiresAt: now + WORKFLOW_DISCOVERY_TTL_MS, dirStamp: stamp });
	while (workflowCache.size > WORKFLOW_DISCOVERY_MAX_ENTRIES) {
		const oldest = workflowCache.keys().next().value; if (oldest) workflowCache.delete(oldest);
	}
	return result;
}
```
> `dirStamp` dùng 3 `statSync` (rẻ) thay cho ~6 `readdirSync` + N `readFileSync` + regex khi cache còn hạn.

**(b) Resolve-once trong powerbar** (bổ trợ, vì `run.workflow` bất biến trong 1 run): cache theo `run.runId → WorkflowConfig` trong module powerbar, xóa khi run vào terminal. Kể cả khi (a) đã đủ, lớp này bỏ luôn lookup `.find()` mỗi render.

**Files**: `src/workflows/discover-workflows.ts`, `src/ui/powerbar-publisher.ts`.
**Invalidation**: gọi `invalidateWorkflowDiscoveryCache()` tại các điểm create/update/delete workflow trong `src/extension/management.ts`.
**Tests**: `test/unit/discovery.test.ts` (đã có, count 9) + case mới: cache hit trả cùng ref; sửa file → `dirStamp` đổi → refetch; TTL hết → refetch.
**Bench**: `discover-workflows.bench.ts` p50 trước/sau (kỳ vọng >10×).
**Rollback**: `WORKFLOW_DISCOVERY_TTL_MS = 0` → hành vi như cũ.
**Acceptance**: powerbar không còn `readdirSync` workflow ở mỗi render khi run active (xác nhận qua bench + strace/Process Monitor tùy chọn); `discovery.test.ts` xanh.

---

### F15 — Nâng TTL agent + cache teams (đồng gốc F17)

**Vấn đề (verified)**: `src/agents/discover-agents.ts:493` `DISCOVERY_CACHE_TTL_MS = 500` → scheduler/recommend re-scan ~2×/s ở steady state. `discoverTeams` (`src/teams/discover-teams.ts`) không có cache.

**Fix**:
1. Nâng `DISCOVERY_CACHE_TTL_MS` 500 → **5000**, và bổ sung `dirStamp` (như F17) để không mất tính đúng khi user sửa agent giữa session (invalidate theo mtime dir thay vì chỉ TTL ngắn).
2. Thêm TTL cache + `dirStamp` cho `discoverTeams` (copy nguyên pattern F17).
3. Cân nhắc gom 3 discovery (agents/teams/workflows) vào 1 helper chung `src/utils/discovery-cache.ts<T>` để tránh lặp code (tùy chọn, không bắt buộc cho win).

**Files**: `src/agents/discover-agents.ts`, `src/teams/discover-teams.ts`, (tùy chọn) `src/utils/discovery-cache.ts`.
**Tests**: `discovery.test.ts` + case sửa file agent/team giữa TTL → cache invalidate qua dirStamp.
**Rủi ro**: TTL dài hơn → user sửa agent thấy hiệu lực chậm tối đa TTL nếu chỉ đổi nội dung file (mtime file đổi nhưng dir mtime KHÔNG luôn đổi trên mọi FS). → **Bắt buộc** invalidate rõ ràng ở management create/update/delete + `agents.reload` (đã có `invalidateAgentDiscoveryCache`).
**Rollback**: TTL về 500.

---

### F4 — Tham số `durability` cho write informational

**Vấn đề (verified)**: `src/state/atomic-write.ts:322` `atomicWriteFile` fsync data (`:384`) + parent dir (`:409-411`) **vô điều kiện**. Đắt trên Windows. Nhiều write là informational (mất ≤50ms cuối khi crash chấp nhận được vì đã có crash-recovery).

**Fix**: thêm options, mặc định giữ `full` (không đổi hành vi hiện tại):
```ts
export type WriteDurability = "full" | "best-effort";
export function atomicWriteFile(
	filePath: string, content: string,
	opts?: { expectedHash?: string; durability?: WriteDurability },
): void {
	const durability = opts?.durability ?? "full";
	// ...write temp...
	if (durability === "full") { fs.fsyncSync(fd); }         // :384
	fs.closeSync(fd);
	// rename...
	if (durability === "full") { /* fsync parent dir :409-411 */ }
}
```
> Giữ chữ ký cũ `atomicWriteFile(path, content, expectedHash?)` tương thích ngược: nhận cả `string` (expectedHash) lẫn object. `atomicWriteJson`/`atomicWriteJsonCoalesced` thêm passthrough `durability`.

**Callers chuyển sang `best-effort`** (chỉ nơi mất 1 write cuối khi crash là an toàn, recovery tự sửa):
- `src/state/mailbox.ts:411` `writeDeliveryState` cho message **informational** (giữ `full` cho reply/terminal) — liên quan F6.
- `src/runtime/crew-agent-records.ts` — agent **progress/status** không-terminal (giữ `full` cho completed/failed/cancelled).
- **Xác minh trước khi đụng**: `persistSequence` (`event-log.ts:299`) — kiểm tra cơ chế ghi `.seq`; nếu qua `atomicWriteFile`, cho `best-effort` (sidecar tụt hậu được recovery-scan sửa). Nếu ghi kiểu khác thì bỏ qua ở item này (thuộc F3a).

**KHÔNG đổi (giữ `full`)**: manifest final, tasks.json terminal write, mọi terminal event.
**Tests**: bổ sung `atomic-write.bench.ts` biến thể best-effort; unit test đảm bảo `best-effort` vẫn tạo file atomic (rename) và không throw khi FS không hỗ trợ dir fsync.
**Rủi ro**: mất tối đa 1 write informational cuối khi hard-crash/power-loss — chấp nhận được (crash-recovery + event-reconstructor bù). **Không** áp cho terminal/manifest.
**Rollback**: đổi caller về `durability: "full"` hoặc bỏ options.
**Lưu ý phạm vi**: `saveRunTasksCoalesced` đã amortize fsync tasks.json (cửa sổ 50ms), nên win F4 giờ tập trung ở **mailbox + agent status + sidecar**, không phải "mọi write".

---

### F9 — Ring buffer cho `rawTextEvents` / `intermediateFindings`

**Vấn đề (verified)**: `src/runtime/child-pi.ts:577` `rawTextEvents: string[] = []`, push tại `:636` **không cap** ("RAW (uncapped)"); consumer chỉ dùng entry cuối (`getRawFinalText()` `:608`). `intermediateFindings` (`:583`) push-only, chỉ trim khi đọc (`slice(-MAX_INTERMEDIATE_DIGEST_LINES)` `:620`). Run dài/verbose × N worker song song → memory tăng tuyến tính.

**Fix**: cap ngay khi push (giữ N entry cuối).
```ts
private static readonly MAX_RAW_EVENTS = 8;       // getRawFinalText chỉ cần entry cuối
private static readonly MAX_FINDINGS = 64;        // đọc slice(-MAX_INTERMEDIATE_DIGEST_LINES)

private pushRaw(items: string[]): void {
	this.rawTextEvents.push(...items);
	const over = this.rawTextEvents.length - ChildPiLineObserver.MAX_RAW_EVENTS;
	if (over > 0) this.rawTextEvents.splice(0, over);
}
```
Áp tương tự cho `intermediateFindings` (giữ ≥ `MAX_INTERMEDIATE_DIGEST_LINES` để không đổi output digest).

**Files**: `src/runtime/child-pi.ts`.
**Tests**: `test/unit/child-pi-*.test.ts` — push > cap vẫn trả đúng `getRawFinalText()` (entry cuối) và `getIntermediateFindings()` (tail không đổi).
**Rủi ro**: nếu có consumer nào đọc `rawTextEvents` không phải entry cuối (grep xác nhận không có) → an toàn.
**Bench**: không cần bench tốc độ; chứng minh bằng test bound length. Tùy chọn: đo RSS trước/sau trên run giả 10k fragment.
**Rollback**: nâng cap rất lớn.

---

## Phase 2 — Correctness-sensitive, measured wins

### F2 — Gộp 3 `statSync` thừa trong `persistSingleTaskUpdate`

**Vấn đề (verified)**: `src/runtime/task-runner/state-helpers.ts:76-113`, trong mỗi attempt có **3 `fs.statSync` liên tiếp** (`currentMtime` :76, `recheckMtime` :92, `preWriteMtime` :107) mà **giữa chúng không có I/O/await nào** (code sync) → luôn trả cùng mtime. 2 trong 3 là rác. Gọi ~5×/task qua `checkpointTask`.

> **KHÔNG bỏ CAS**: `saveRunTasks` không tự lock; các writer best-effort (`async-notifier.ts:54`, `crash-recovery.ts:98/416/464`) ghi tasks.json **không cầm run.lock**. CAS mtime là lớp bảo vệ chống chúng. Chỉ loại bỏ stat lặp thừa.

**Fix**: 1 `statSync` sau khi merge, ngay trước `saveRunTasksCoalesced`, so với `baseMtime`:
```ts
return withRunLockSync(manifest, () => {
	for (let attempt = 0; attempt < 100; attempt++) {
		flushPendingAtomicWrites();
		const latest = loadRunManifestById(manifest.cwd, manifest.runId)?.tasks ?? fallbackTasks;
		merged = updateTask(latest, taskWithCheckpoint);
		let currentMtime = 0;
		try { currentMtime = fs.statSync(manifest.tasksPath).mtimeMs; } catch { currentMtime = 0; }
		if (currentMtime !== baseMtime) { baseMtime = currentMtime; continue; } // 1 stat/attempt
		break;
	}
	if (merged === undefined) throw new Error("persistSingleTaskUpdate: failed to converge");
	saveRunTasksCoalesced(manifest, merged);
	return merged;
});
```

**Cân nhắc bổ sung (đo rồi mới quyết)**: `flushPendingAtomicWrites()` ở đầu mỗi attempt **triệt tiêu coalescing giữa các task** (mọi persist đều force-flush). Nếu bench cho thấy đây là chi phí lớn, xét: chỉ flush khi phát hiện mtime đã đổi (đọc lần đầu không flush; nếu miss CAS thì flush + retry). Đây là thay đổi tinh vi → chỉ làm nếu bench chứng minh, kèm integration test race.

**Files**: `src/runtime/task-runner/state-helpers.ts`.
**Tests**: **bắt buộc** giữ `test/unit/*persist*`/race tests xanh (2 task hoàn tất song song không clobber nhau); thêm case: unlocked writer thay đổi tasks.json giữa attempt → CAS bắt được và re-merge.
**Bench**: `persist-single-task-update.bench.ts` p50 trước/sau.
**Rủi ro**: thấp nếu chỉ gộp stat; **trung bình** nếu đụng `flushPendingAtomicWrites` (có thể mở lại stale-read window → cần race test).
**Rollback**: revert về 3-stat.

---

### F3a — fsync chỉ cho terminal events (tách khỏi buffering)

**Vấn đề (verified)**: `src/state/event-log.ts` — `appendEventAsync` (:540-548) và sync path (:818-832) fsync + `persistSequence` **mỗi event**, kể cả non-terminal. `appendEventBuffered` cho `task.progress` đã batch, nhưng phần lớn event khác vẫn per-fsync.

**Fix**: fsync có điều kiện — chỉ khi `TERMINAL_EVENT_TYPES.has(type)` (hoặc có `fingerprint`). Non-terminal: append + persistSequence, KHÔNG fsync.
```ts
const isTerminal = TERMINAL_EVENT_TYPES.has(fullEvent.type);
await fs.promises.appendFile(eventsPath, line, { encoding: "utf-8", flag: "a" });
if (isTerminal) {
	const fd = await fs.promises.open(eventsPath, "r+");
	try { await fd.sync(); } finally { await fd.close(); }
}
persistSequence(eventsPath, seq);  // sidecar: nếu tụt hậu, recovery-scan tự sửa
```

**Cơ sở an toàn**: fsync ở đây đóng crash-window append↔persistSequence (chống seq reuse). Với non-terminal: nếu crash mất cả dòng append lẫn seq → nhất quán (recovery scan `event-reconstructor.ts` xử lý dòng cuối lỗi/thiếu). Chỉ mất event informational cuối — chấp nhận được. Terminal events (run/task completed/failed…) vẫn durable tuyệt đối.

**Files**: `src/state/event-log.ts` (cả `appendEvent` sync và `appendEventAsync`).
**Tests**: `event-log-*.test.ts` — terminal event vẫn fsync (mock `fsyncSync`/`fd.sync` đếm lời gọi: chỉ gọi cho terminal); crash-recovery test đọc lại log sau khi mất dòng non-terminal cuối vẫn reconstruct đúng trạng thái terminal.
**Bench**: `event-append.bench.ts` — thêm scenario terminal vs non-terminal; kỳ vọng non-terminal p50 giảm mạnh trên Windows.
**Rủi ro**: TB — thay đổi durability. Chạy đủ integration + crash-recovery suite.
**Rollback**: đổi điều kiện thành `true` (fsync mọi event).

---

### F5 — Cache kết quả `isSymlinkSafePath` theo dirname

**Vấn đề (verified)**: `src/state/atomic-write.ts:43` `isSymlinkSafePath` walk toàn ancestor chain (lstat mỗi cấp tới root); gọi **2×/write** (:323 initial, :394 retry). Thư mục cha của state root không đổi trong suốt run.

**Fix**: cache theo `path.dirname(filePath)` trong process, TTL ngắn (vd 30s) hoặc bounded LRU. Chỉ re-validate khi ghi vào dirname mới:
```ts
const symlinkSafeCache = new Map<string, { safe: boolean; at: number }>();
const SYMLINK_CACHE_TTL_MS = 30_000;
function isDirTreeSafeCached(filePath: string): boolean {
	const dir = path.dirname(filePath);
	const hit = symlinkSafeCache.get(dir);
	if (hit && Date.now() - hit.at < SYMLINK_CACHE_TTL_MS) return hit.safe;
	const safe = isSymlinkSafePath(filePath); // vẫn validate cả filePath (file có thể là symlink mới)
	symlinkSafeCache.set(dir, { safe, at: Date.now() });
	return safe;
}
```
> Lưu ý: cache theo **dir** (ancestor chain), nhưng `filePath` cuối (chính file đích) vẫn phải lstat mỗi lần vì file có thể bị thay bằng symlink giữa các write. Fix chỉ bỏ phần walk ancestor lặp lại, không bỏ check file đích. → refactor `isSymlinkSafePath` tách "check ancestor dirs" (cache-able) khỏi "check target" (luôn chạy).

**Files**: `src/state/atomic-write.ts`.
**Tests**: giữ security tests symlink hiện có xanh; thêm case: sau khi cache dir an toàn, đổi 1 ancestor thành symlink → trong TTL vẫn có thể miss (chấp nhận, TTL ngắn) — cân nhắc invalidate khi rename/create dir.
**Rủi ro**: **security-sensitive**. TTL ngắn + vẫn check target mỗi lần. Cần review bởi security-auditor droid.
**Rollback**: TTL = 0.

---

### F1 — Generation counter per-stateRoot (win nhỏ, chỉ multi-run)

**Vấn đề (verified)**: `src/state/state-store.ts:75` `manifestCacheGeneration` global; `invalidateRunCache` (:130-132) vừa `delete(stateRoot)` vừa `generation++`. Cache hit yêu cầu `cached.generation === manifestCacheGeneration` (:645,:761). → write của run A làm miss cache của run B.

> **Kỳ vọng thực tế**: với 1 run active, cache của chính run đó đã bị invalidate bởi mtime/size đổi mỗi lần nó tự ghi; generation global chỉ gây false-miss THÊM cho **run khác**. Win chỉ hiện khi có **nhiều run đồng thời** đọc manifest của nhau (status poll, reconcile). Không kỳ vọng win ở single-run.

**Fix**: `Map<stateRoot, number>` thay global; bump chỉ generation của stateRoot bị invalidate. Giữ generation (đừng bỏ hẳn) vì nó phòng ca **mtime granularity thô** (FS phân giải 1–2s + size trùng).
```ts
const genByRoot = new Map<string, number>();
function genOf(root: string): number { return genByRoot.get(root) ?? 0; }
function invalidateRunCache(stateRoot: string): void {
	manifestCache.delete(stateRoot);
	genByRoot.set(stateRoot, genOf(stateRoot) + 1);
}
// hit check: cached.generation === genOf(stateRoot)
// setManifestCache: entry.generation = genOf(stateRoot)
```

**Files**: `src/state/state-store.ts`.
**Tests**: `test/unit/state-store*.test.ts` — write run A không làm miss cache run B; write run A vẫn làm miss cache run A.
**Bench**: `snapshot-cache.bench.ts` / thêm scenario 2-run: hit-rate trước/sau.
**Rủi ro**: thấp. **Chỉ làm nếu** bench multi-run chứng minh win (nếu không, để nguyên — tránh thêm bề mặt bug cho win ~0).
**Rollback**: về global counter.

---

## Phase 3 — Deferred / high-risk / big refactor

### F12 — finalDrain kết thúc sớm khi stdout im lặng (KHÔNG giảm cứng)

**Vấn đề (verified)**: `src/runtime/child-pi.ts:1145-1185` — sau final assistant event, arm `finalDrainTimer(finalDrainMs=5000)`; **clear ngay khi `childExited`/`settled`**. Vậy 5s chỉ tốn khi child **treo** sau final message. Giảm cứng `finalDrainMs` = rủi ro SIGTERM child đang flush.

**Fix**: thêm "silence early-exit" — theo dõi timestamp dòng stdout cuối; nếu sau final assistant event mà stdout im lặng > `finalDrainQuietMs` (vd 800ms) VÀ đã nhận `message_end`/stopReason=stop, thì kết thúc drain sớm (SIGTERM) thay vì chờ đủ 5s. Giữ `finalDrainMs=5000` làm trần tuyệt đối.
```ts
// khi arm finalDrainTimer, đồng thời set 1 interval nhẹ (200ms, unref) kiểm tra:
//   now - lastStdoutMonotonicMs > finalDrainQuietMs && sawMessageEndStop  → drain sớm
```
> Chỉ cải thiện đúng ca child-treo-nhưng-đã-xong; không đụng ca child thoát sạch (vốn đã ~0 cost).

**Files**: `src/config/defaults.ts` (thêm `finalDrainQuietMs`), `src/runtime/child-pi.ts`.
**Rủi ro**: TB — nếu phát hiện "xong" sai (child còn tool trailing) → cắt sớm. Cần điều kiện chặt (`message_end` + stopReason=stop + im lặng đủ lâu).
**Bench/nghiệm thu**: cần đo trên workflow thật (child-process mode) — **out-of-scope cho micro-bench**; đo end-to-end `time` 1 run `fast-fix` trước/sau.
**Rollback**: `finalDrainQuietMs` = `finalDrainMs` (vô hiệu early-exit).

---

### F3b — Mở rộng buffering event-log (chờ RCA deadlock)

**Vấn đề**: mở rộng `appendEventBuffered` cho thêm event non-terminal sẽ giảm mạnh syscall, NHƯNG `414b973` đã **revert buffering `appendEventAsync` vì deadlock**.

**Điều kiện tiên quyết**: RCA deadlock (nghi: buffer flush timer + lock re-entrancy giữa `flushEventLogBuffer` và `withEventLogLockSync`; hoặc `beforeExit` drain tạo floating promise). Chỉ triển khai sau khi:
1. Có test tái hiện deadlock (`event-log-leak.test.ts` H1/H3 đang "cancelled under --test-force-exit" — điều tra trước).
2. Chứng minh no-lost-event khi kill process trong buffer window (integration crash test).

**Rủi ro**: Cao. **Không đụng** cho tới khi F3a đã ship (F3a cho phần lớn win mà không cần buffering).

---

### F6 — Mailbox delivery-state append-only + compaction

**Vấn đề (verified)**: `src/state/mailbox.ts:399-411` `writeDeliveryState` `atomicWriteFile` **toàn bộ** `delivery.json` pretty-printed mỗi message; nay kèm fsync data+dir (F4). Read path `updateMailboxMessageReply` quét mọi mailbox file (full read + full rewrite).

**Fix (refactor)**: chuyển delivery-state sang **append-only JSONL** (mỗi delivery/ack 1 dòng) + compaction định kỳ (giống events.jsonl). Read = tail + reconstruct; write = append 1 dòng (rẻ). Giữ `delivery.json` snapshot chỉ khi compact.
**Bước trung gian rẻ hơn (làm trước nếu chưa refactor)**: (a) áp F4 `best-effort` cho delivery write informational; (b) coalesce delivery write theo message-burst; (c) cache danh sách archive theo mtime dir (bỏ `readdirSync` mỗi đọc).
**Rủi ro**: Cao (đổi format state có consumer: `run-snapshot-cache.ts:484`, group-join). Cần migration + đọc-ngược tương thích.
**Phase**: sau khi Phase 1–2 ổn định.

---

### In-memory task state (write-through) — dài hạn

**Ý tưởng**: giữ task graph in-memory per active run là nguồn sự thật; disk chỉ là bản persist (coalesced/async). Loại bỏ hoàn toàn vòng read-modify-write của F1/F2/F4 cho run đang chạy.
**Rủi ro**: Cao (đụng mọi reader cross-process: status/cancel/reconcile phải đọc disk, còn run process dùng memory → cần cơ chế đồng bộ/invalidate rõ). Chỉ làm sau khi có in-memory reader thống nhất + integration test crash đầy đủ.
**Phase**: nghiên cứu riêng (ADR mới), không gộp vào đợt này.

---

## Thứ tự thực thi & phụ thuộc

```
Phase 0 (bench baseline)  ──►  Phase 1  ──►  Phase 2  ──►  Phase 3
  bench mới                    F17, F15      F2, F3a       F12
  baseline Win+Linux          F4, F9        F5, F1        F3b (sau RCA)
                                                          F6, in-memory
```

- **F17 trước F15** (F17 tạo pattern cache dùng lại cho F15).
- **F4 trước F6** (F6 dùng `best-effort` từ F4).
- **F3a trước F3b** (F3a lấy phần lớn win, F3b rủi ro cao chờ RCA).
- **F2 độc lập**, làm sớm trong Phase 2.

## Nghiệm thu tổng (mỗi PR)
```bash
npm run typecheck
npm run lint
npm test                      # unit + integration (bắt buộc cho item chạm state)
npm run check:lazy-imports
npm run bench ; npm run bench:check   # so baseline; không regress
```
- Item chạm durability/state (F2, F3a, F4, F5, F1, F6): **bắt buộc** integration + crash-recovery suite xanh, không chỉ unit.
- Item security (F5): review bởi `security-auditor` droid trước merge.

## Ước lượng tác động (định tính, chờ bench xác nhận)
- **Phase 1**: bỏ scan discovery 5 Hz của powerbar (F17) — win rõ nhất, đo được ngay; giảm CPU nền; giảm fsync mailbox/agent (F4); chặn memory leak run dài (F9).
- **Phase 2**: giảm syscall trên đường ghi state/event trong run active (F2 gộp stat, F3a fsync-terminal-only); F1/F5 win nhỏ (chỉ làm nếu bench chứng minh).
- **Phase 3**: hết latency dư ca child-treo (F12); giảm mạnh IO mailbox (F6); nền tảng dài hạn (in-memory).
