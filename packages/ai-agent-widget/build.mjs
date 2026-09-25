// esbuild build script for the <voso-widget> embed bundle.
//
//   node build.mjs            → dist/widget.js  (minified IIFE, same-host, committed)
//                               dist/index.js   (the npm / CDN IIFE, default API origin)
//   node build.mjs --tests    → dist-test/*.test.mjs (node --test consumables)
//
// The bundle must stay dependency-free: everything is authored in src/ and
// inlined. Shadow DOM provides style isolation; no CSS files are emitted.
import * as esbuild from "esbuild";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
// The production API — the npm / CDN bundle's default `server-url` (Q8).
const DEFAULT_ORIGIN = "https://aiagent-api.convoso.com";
const forTests = process.argv.includes("--tests");

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
    external: ["node:test", "node:assert"],
    sourcemap: "inline",
  });
} else {
  const bundle = {
    entryPoints: [join(root, "src", "index.ts")],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2020",
    minify: true,
    sourcemap: false,
    legalComments: "none",
    logLevel: "info",
  };
  // Same-host bundle, served by GET /widget.js (committed — E1 D2 asserts it).
  await esbuild.build({ ...bundle, outfile: join(root, "dist", "widget.js") });
  // npm / CDN bundle (E4 Q8): the API origin defaults to production, since the
  // script's own origin is the CDN. Built, not committed; published behind the
  // release gate.
  await esbuild.build({
    ...bundle,
    outfile: join(root, "dist", "index.js"),
    define: { __VOSO_WIDGET_DEFAULT_ORIGIN__: JSON.stringify(DEFAULT_ORIGIN) },
  });
}
