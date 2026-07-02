/**
 * team-runner-artifacts.ts — small shared utilities for team-runner artifacts.
 * Extracted to avoid a circular import between team-runner.ts and sub-modules
 * that need `mergeArtifacts`.
 */
import type { ArtifactDescriptor } from "../state/types.ts";

/** Deduplicate artifacts by path; later occurrences win. */
export function mergeArtifacts(items: ArtifactDescriptor[]): ArtifactDescriptor[] {
	const byPath = new Map<string, ArtifactDescriptor>();
	for (const item of items) byPath.set(item.path, item);
	return [...byPath.values()];
}
