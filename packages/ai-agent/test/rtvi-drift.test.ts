import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { OUTBOUND_TYPES, PASSTHROUGH, RTVI_TO_CALLBACK } from "../src/internal/rtvi-events";

// E4 plan §4.6: the RTVI → callback table is held against the server's own
// list (processors-rtvi `OutboundMessage::type_tag`) and the client's sends
// against the server's dispatch (`processor.rs` `handle`). Skips when the
// Rust tree is absent (the published package).

const rtvi = fileURLToPath(new URL("../../../vosopulse/crates/processors-rtvi/src/", import.meta.url));
const present = existsSync(`${rtvi}models.rs`);

function serverTags(): Set<string> {
  const models = readFileSync(`${rtvi}models.rs`, "utf8");
  const start = models.indexOf("pub fn type_tag(&self)");
  assert.ok(start >= 0, "type_tag not found in models.rs");
  const block = models.slice(start, models.indexOf("\n    }\n", start));
  return new Set([...block.matchAll(/=> "([a-z-]+)"/g)].map((m) => m[1]!));
}

test("rtvi drift: every mapped / passthrough tag is one the server emits", { skip: !present && "Rust tree absent" }, () => {
  const tags = serverTags();
  const ours = [...Object.keys(RTVI_TO_CALLBACK), ...PASSTHROUGH];
  assert.deepEqual(ours.filter((tag) => !tags.has(tag)), []);
});

test("rtvi drift: every server tag is mapped or passthrough", { skip: !present && "Rust tree absent" }, () => {
  const known = new Set<string>([...Object.keys(RTVI_TO_CALLBACK), ...PASSTHROUGH]);
  assert.deepEqual([...serverTags()].filter((tag) => !known.has(tag)), []);
});

test("rtvi drift: every type the client sends is dispatched by the server", { skip: !present && "Rust tree absent" }, () => {
  const processor = readFileSync(`${rtvi}processor.rs`, "utf8");
  const start = processor.indexOf("async fn handle(&self, message: Message)");
  assert.ok(start >= 0, "handle() not found in processor.rs");
  const block = processor.slice(start, processor.indexOf("\n    }\n", start));
  const dispatched = new Set([...block.matchAll(/"([a-z-]+)"(?:\s*\|\s*"[a-z-]+")*\s*=>/g)].flatMap((m) => [...m[0].matchAll(/"([a-z-]+)"/g)].map((x) => x[1]!)));
  assert.deepEqual(OUTBOUND_TYPES.filter((type) => !dispatched.has(type)), []);
});
