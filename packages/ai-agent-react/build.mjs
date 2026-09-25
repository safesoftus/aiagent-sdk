// esbuild build script for @convoso/ai-agent-react.
//
//   node build.mjs            → dist/index.js (ESM; react + the core stay external,
//                               so the app has ONE core instance), then .d.ts via tsc
//   node build.mjs --tests    → dist-test/*.test.mjs; the core is aliased to its
//                               source (tests run before any build in CI)
import * as esbuild from "esbuild";
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
const core = join(root, "..", "ai-agent", "src");

if (process.argv.includes("--tests")) {
  const entries = readdirSync(join(root, "test"))
    .filter((f) => /\.test\.tsx?$/.test(f))
    .map((f) => join(root, "test", f));
  await esbuild.build({
    entryPoints: entries,
    outdir: join(root, "dist-test"),
    outExtension: { ".js": ".mjs" },
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    jsx: "automatic",
    external: ["node:*"],
    alias: {
      "@convoso/ai-agent/internal": join(core, "internal.ts"),
      "@convoso/ai-agent": join(core, "index.ts"),
    },
    // react / react-dom are CommonJS: give the ESM bundle a require().
    banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
    sourcemap: "inline",
  });
} else {
  await esbuild.build({
    entryPoints: [join(root, "src", "index.tsx")],
    outfile: join(root, "dist", "index.js"),
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "es2020",
    jsx: "automatic",
    external: ["react", "react/jsx-runtime", "@convoso/ai-agent", "@convoso/ai-agent/internal"],
    minify: true,
    legalComments: "none",
    logLevel: "info",
  });
  const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");
  execFileSync(process.execPath, [tsc, "-p", join(root, "tsconfig.build.json")], { stdio: "inherit" });
}
