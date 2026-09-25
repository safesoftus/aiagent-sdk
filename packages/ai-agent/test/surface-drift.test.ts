import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import * as publicApi from "../src/index";
import * as internalApi from "../src/internal";
import allow from "./surface-allowlist.json";

// E4 Q12 HARD CONDITION — the published @convoso/ai-agent exposes ONLY the
// WebRTC features the widget has today (+ the vendor-parity façade), never
// a staff-only capability. Three checks against the checked-in allow-list:
//   1. the exact export names of the public and the /internal entry;
//   2. no staff-only token anywhere under src/ (dashboard auth / tenant,
//      supervisor, takeover, whisper, live monitor, receive-only listen-in,
//      an import of the private internal package), except the listed lines;
//   3. every RTVI envelope type the core sends is in the widget's list.
// A failure names the offending export / file:line. Wave 2 keeps this green;
// a list grows only with an owner-ruled reason in the same commit.

const srcRoot = fileURLToPath(new URL("../src/", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith(".ts") ? [path] : [];
  });
}

const files = sourceFiles(srcRoot).map((path) => ({
  path: relative(srcRoot, path).split("\\").join("/"),
  text: readFileSync(path, "utf8"),
}));

test("surface: the public entry exports exactly the allow-listed names", () => {
  assert.deepEqual(Object.keys(publicApi).sort(), [...allow.public].sort());
});

test("surface: the /internal entry exports exactly the widget's transport names", () => {
  assert.deepEqual(Object.keys(internalApi).sort(), [...allow.internal].sort());
});

test("surface: no staff-only capability anywhere in the core's sources", () => {
  const allowed = allow.allowedLines as Record<string, Array<{ file: string; pattern: string }>>;
  const leaks: string[] = [];
  for (const { path, text } of files) {
    text.split("\n").forEach((line, index) => {
      for (const token of allow.forbiddenTokens) {
        if (!line.includes(token)) continue;
        const ok = (allowed[token] ?? []).some(
          (rule) => rule.file === path && new RegExp(rule.pattern).test(line),
        );
        if (!ok) leaks.push(`${path}:${index + 1} carries "${token}": ${line.trim()}`);
      }
    });
  }
  assert.deepEqual(leaks, [], `admin-only capability leaked into @convoso/ai-agent:\n${leaks.join("\n")}`);
});

test("surface: every outbound RTVI envelope type is one the widget sends", () => {
  const sent = new Set<string>();
  for (const { text } of files) {
    for (const match of text.matchAll(/label:\s*"rtvi-ai",\s*type:\s*"([^"]+)"/g)) sent.add(match[1]!);
  }
  const extra = [...sent].filter((type) => !allow.outboundRtviTypes.includes(type));
  assert.deepEqual(extra, [], `outbound types outside the widget's list: ${extra.join(", ")}`);
  assert.ok(sent.has("client-ready") && sent.has("send-text"), "the scan found the widget's envelopes");
});
