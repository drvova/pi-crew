/**
 * Barrel re-exports for the compact-stages module.
 *
 * Callers import from `../../runtime/compact-stages/index.ts` (or just
 * `../../runtime/compact-stages/`) rather than reaching into individual
 * stage files, so internal refactors do not break the public surface.
 */
export { AnsiStripStage, ANSI_STRIP_STAGE } from "./ansi-strip-stage.ts";
export { BlankCollapseStage, BLANK_COLLAPSE_STAGE } from "./blank-collapse-stage.ts";
export { DeduplicateStage, DEDUPLICATE_STAGE } from "./deduplicate-stage.ts";
export { TruncationStage, type TruncationMarkerConfig } from "./truncation-stage.ts";
export { HeadSnapStage, type HeadSnapStageConfig } from "./head-snap-stage.ts";
export { TailCaptureStage, TAIL_CAPTURE_STREAM_STAGE, type TailCaptureStageConfig } from "./tail-capture-stage.ts";
