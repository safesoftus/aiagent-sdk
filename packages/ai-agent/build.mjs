// esbuild build script for @convoso/ai-agent.
//
//   node build.mjs            → dist/index.js, dist/internal.js, dist/index.react-native.js (ESM, shared chunks),
//                               dist/lib.iife.js (browser global `ConvosoAiAgent`), then .d.ts via tsc
//   node build.mjs --tests    → dist-test/*.test.mjs (node --test consumables)
//
// Zero runtime dependencies: everything under src/ is bundled.
import * as esbuild from "esbuild";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
const forTests = process.argv.includes("--tests");
// `client-ready.about.library_version` / `source_info.version` — injected so
// the bundle never embeds package.json.
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const define = { __AI_AGENT_VERSION__: JSON.stringify(version) };

if (forTests) {
  const entries = readdirSync(join(root, "test"))
    .filter((f) => f.endsWith(".test.ts"))
    .map((f) => join(root, "test", f));
  await esbuild.build({
    entryPoints: entries,
    outdir: join(root, "dist-test"),
    outExtension: { ".js": ".mjs" },
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    external: ["node:*"],
    sourcemap: "inline",
    define,
  });
} else {
  const common = { bundle: true, target: "es2020", platform: "neutral", legalComments: "none", logLevel: "info", define };
  // ONE split build for the three ESM entries (the React Native entry is the
  // same code; `platform.ts` is set by the RN package): shared chunks keep ONE
  // copy of the module state (`setPlatform`, `setSourceInfo`), so a setter
  // reached through `/internal` is the one `Conversation` reads (E4 P2).
  await esbuild.build({
    ...common,
    entryPoints: {
      index: join(root, "src", "index.ts"),
      internal: join(root, "src", "internal.ts"),
      "index.react-native": join(root, "src", "index.ts"),
    },
    outdir: join(root, "dist"),
    format: "esm",
    splitting: true,
    chunkNames: "chunks/[name]-[hash]",
    minify: true,
  });
  await esbuild.build({
    ...common,
    entryPoints: [join(root, "src", "index.ts")],
    outfile: join(root, "dist", "lib.iife.js"),
    format: "iife",
    globalName: "ConvosoAiAgent",
    platform: "browser",
    minify: true,
  });
  const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");
  execFileSync(process.execPath, [tsc, "-p", join(root, "tsconfig.build.json")], { stdio: "inherit" });
}
