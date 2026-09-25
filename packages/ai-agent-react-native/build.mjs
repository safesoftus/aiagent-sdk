// esbuild build script for @convoso/ai-agent-react-native.
//
//   node build.mjs            → dist/index.js (ESM; react, react-native-webrtc,
//                               the incall manager and the @convoso packages stay
//                               external — the app has ONE core instance), then .d.ts
//   node build.mjs --tests    → dist-test/*.test.mjs; react-native-webrtc and the
//                               incall manager are replaced by test stubs, the
//                               @convoso packages aliased to their sources
import * as esbuild from "esbuild";
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
const packages = join(root, "..");

if (process.argv.includes("--tests")) {
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
    jsx: "automatic",
    external: ["node:*"],
    alias: {
      "react-native-webrtc": join(root, "test", "stubs", "react-native-webrtc.ts"),
      "react-native-incall-manager": join(root, "test", "stubs", "react-native-incall-manager.ts"),
      "@convoso/ai-agent/internal": join(packages, "ai-agent", "src", "internal.ts"),
      "@convoso/ai-agent-react": join(packages, "ai-agent-react", "src", "index.tsx"),
      "@convoso/ai-agent": join(packages, "ai-agent", "src", "index.ts"),
    },
    banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
    sourcemap: "inline",
  });
} else {
  await esbuild.build({
    entryPoints: [join(root, "src", "index.ts")],
    outfile: join(root, "dist", "index.js"),
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "es2020",
    external: [
      "react",
      "react-native",
      "react-native-webrtc",
      "react-native-incall-manager",
      "@convoso/ai-agent",
      "@convoso/ai-agent/internal",
      "@convoso/ai-agent-react",
    ],
    minify: true,
    legalComments: "none",
    logLevel: "info",
  });
  const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");
  execFileSync(process.execPath, [tsc, "-p", join(root, "tsconfig.build.json")], { stdio: "inherit" });
}
