export { claudeAdapter } from "./claude-adapter.ts";
export { codexAdapter } from "./codex-adapter.ts";
export { cursorAdapter } from "./cursor-adapter.ts";
export { generateToolExport, resourcesToExportContent } from "./export-util.ts";
export { adapterRegistry, createAdapterRegistry } from "./registry.ts";
export type { AdapterRegistry, ExportAdapter, ExportContent } from "./types.ts";

import { claudeAdapter } from "./claude-adapter.ts";
import { codexAdapter } from "./codex-adapter.ts";
import { cursorAdapter } from "./cursor-adapter.ts";
import { adapterRegistry } from "./registry.ts";

adapterRegistry.register(claudeAdapter);
adapterRegistry.register(cursorAdapter);
adapterRegistry.register(codexAdapter);
