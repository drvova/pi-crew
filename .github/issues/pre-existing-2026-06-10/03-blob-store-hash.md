# Issue 03: blob-store hash deduplication

**Status**: pre-existing
**Severity**: Low
**Component**: `src/state/blob-store.ts`
**Test count**: 2 failing

## Summary

Two blob-store tests fail. The exact error messages and conditions need to be re-verified, but the test names suggest issues with content-addressable storage (CAS) deduplication by hash.

## Failing tests

| Test | File | Line |
|---|---|---|
| `writeBlob deduplicates by hash` | `test/unit/blob-store.test.ts` | :780 |
| `readBlob returns content by hash` | `test/unit/blob-store.test.ts` | :1304 |

## Likely root cause

`src/state/blob-store.ts` may be:
- Computing hash on raw bytes vs. canonicalized content (whitespace, key ordering).
- Failing to handle concurrent writes that race on the same hash key.
- Reading from a different storage backend than the one writing.

## Suggested investigation

1. Run the failing tests in isolation with verbose output:
   ```bash
   cd /home/bom/source/my_pi/pi-crew
   node --test --test-timeout=10000 test/unit/blob-store.test.ts
   ```
2. Capture the actual error message (likely `assert.equal` mismatch on hash or content).
3. Check if `src/state/blob-store.ts` uses `crypto.createHash` with the same algorithm and encoding in both `writeBlob` and `readBlob`.

## Related

- `src/state/blob-store.ts`
- `test/unit/blob-store.test.ts`

## History

Pre-existing. Not analyzed in depth in prior reviews — would benefit from a focused triage.
