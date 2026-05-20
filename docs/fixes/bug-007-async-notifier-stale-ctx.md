# Bug #7: Async notifier "stale ctx detected; stopping notifier" — không restart

| Field | Value |
|---|---|
| **Severity** | 🔴 HIGH |
| **Status** | Root cause confirmed, fix pending |
| **Affected** | Tất cả pi-crew users sau khi Pi session restarts/compacts |
| **Symptom** | Sau restart/compact, notifier dừng hoàn toàn — không còn nhận notifications cho run completions |

## Mô tả

Sau khi Pi restart (hoặc /clear, /compact, session switch), xuất hiện error:
```
[pi-crew] async notifier stale ctx detected; stopping notifier.
```

Sau đó, pi-crew **không còn deliver notifications** cho run completions. Background runs hoàn thành nhưng user không được báo.

## Root cause

### Flow bình thường (mong đợi):

```
Pi session_start event
  → sessionGeneration++
  → currentCtx = newCtx
  → cleanupRuntime() (stop old notifier)
  → startAsyncRunNotifier(newCtx, ...)
  → New notifier hoạt động với newCtx ✅
```

### Flow bị lỗi:

```
1. Old notifier interval tick fires
2. isCurrent(generation) check → true (generation chưa increment)
3. ctx.ui.notify() called
4. Pi đã invalidate old ctx → throw Error("This extension ctx is stale...")
5. Catch block: message.includes("stale") → true
6. stopAsyncRunNotifier(state) → clearInterval(interval)
7. console.error("stale ctx detected; stopping notifier.")
8. ❌ Notifier stopped permanently
```

Vấn đề: **session_start handler** CHƯA kịp chạy để start new notifier.

### Tại sao session_start chưa chạy?

Khi Pi invalidate ctx, old notifier interval **vẫn đang chạy** (clearInterval chưa được gọi). Interval tick xảy ra **trước khi** `cleanupRuntime()` hoặc `session_start` handler chạy. Đây là **race condition** giữa:
- Old notifier's setInterval tick
- Pi's session shutdown/start event sequence

### Code location

**`/home/bom/source/my_pi/pi-crew/src/extension/async-notifier.ts`**, line 103-112:
```typescript
} catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("stale") || message.includes("session replacement") || message.includes("old ctx")) {
        console.error(`[pi-crew] async notifier stale ctx detected; stopping notifier.`);
        try { stopAsyncRunNotifier(state); } catch { /* ignore */ }
        return;  // ❌ Stops the interval, never restarts
    }
}
```

### Why it matters

- User restarts Pi → notifier dies → background runs complete silently
- User phải manually check `team status` để biết runs hoàn thành
- Ảnh hưởng UX nghiêm trọng: pi-crew "câm" sau restart

## Fix

### Option A: Silent swallow stale errors (recommended)

Thay vì stop notifier, chỉ **skip notification** này và chờ session_start restart notifier với new ctx:

```typescript
} catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("stale") || message.includes("session replacement") || message.includes("old ctx")) {
        // Don't stop — session_start will create a new notifier with the new ctx.
        // This old notifier's isCurrent guard will return false on next tick,
        // making it effectively dormant until cleaned up.
        return;
    }
    console.error(`[pi-crew] async notifier error: ${message}`);
}
```

Rationale: `isCurrent` guard sẽ return false sau khi `sessionGeneration++` → old notifier interval vẫn chạy nhưng không làm gì (silent). New notifier từ `session_start` sẽ hoạt động bình thường.

### Option B: Add explicit restart mechanism

Add `restartAsyncRunNotifier()` function và gọi từ `session_start` handler. Nhưng Option A đơn giản hơn và đủ.

## Key files

```
pi-crew/src/extension/async-notifier.ts  — startAsyncRunNotifier(), stopAsyncRunNotifier()
pi-crew/src/extension/register.ts         — session_start handler, isCurrent guard
```

## Pi SDK reference

Pi's `ExtensionRunner.invalidate()` sets `staleMessage` → `assertActive()` throws:
```
"This extension ctx is stale after session replacement or reload. 
Do not use a captured pi or command ctx after ctx.newSession(), 
ctx.fork(), ctx.switchSession(), or ctx.reload()."
```
