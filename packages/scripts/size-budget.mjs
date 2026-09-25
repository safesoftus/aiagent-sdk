// Size budget for the published bundles (E4 plan §4.2 / §5). Run after
// `npm run build`: fails when a bundle outgrows its budget.
import { statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const budgets = [
  // The core, minified (≤ 35 KB). The ESM entries share chunks since E4 P2,
  // so the self-contained IIFE is the whole-core measure.
  ["packages/ai-agent/dist/lib.iife.js", 35_840],
  // The widget: 100 KB (owner ruling 2026-09-23; plan §5).
  ["packages/ai-agent-widget/dist/widget.js", 102_400],
];

let failed = false;
for (const [path, limit] of budgets) {
  let size;
  try {
    size = statSync(join(root, path)).size;
  } catch {
    console.log(`size: ${path} not built yet — skipped`);
    continue;
  }
  const ok = size <= limit;
  console.log(`size: ${path} ${size} B / ${limit} B ${ok ? "ok" : "OVER BUDGET"}`);
  failed ||= !ok;
}
process.exit(failed ? 1 : 0);
