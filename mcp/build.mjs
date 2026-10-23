/* Build the p5-quiz-author core from the same TypeScript the browser uses.
 * Run: npm run mcp:build */
import { build } from "esbuild";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(ROOT, "mcp", ".build");
mkdirSync(OUT, { recursive: true });

await build({
  entryPoints: [join(ROOT, "mcp", "core-entry.ts")],
  outfile: join(OUT, "core.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  logLevel: "warning",
});
console.error("p5-quiz-author core built");
