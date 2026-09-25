import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG, mergeConfig } from "../src/config";
import {
  attributeOverrides,
  DISPLAY_ATTRIBUTES,
  expandAction,
  inboundAction,
  mapTextContents,
  overlayAttributes,
  parseBool,
  VENDOR_TEXT_RENAMES,
} from "../src/attributes";
import { WIDGET_TEXT_KEYS } from "../src/text-defaults";

// E4 §4.8 — the vendor's element attributes on <voso-widget> (Q9, Q22, Q25,
// Q30). Pure rules; the element wires them (widget.ts).

const reader = (attrs: Record<string, string>) => (name: string) => attrs[name] ?? null;
const noDebug = () => {};

test("attrs: no attribute → the config is unchanged (today's rendering)", () => {
  const cfg = mergeConfig({ resize_button_enabled: false, variant: "full" });
  assert.deepEqual(overlayAttributes(cfg, reader({}), noDebug), cfg);
  assert.equal(DEFAULT_CONFIG.show_agent_status, true);
  assert.equal(DEFAULT_CONFIG.show_avatar_when_collapsed, true);
  assert.equal(DEFAULT_CONFIG.show_language_selector_on_trigger, false);
});

test("attrs (Q9): show-agent-status overlays the config after mergeConfig", () => {
  const cfg = overlayAttributes(mergeConfig({}), reader({ "show-agent-status": "false" }), noDebug);
  assert.equal(cfg.show_agent_status, false);
});

test("attrs (Q9): show-resize-button overrides the server's resize toggle both ways", () => {
  assert.equal(overlayAttributes(mergeConfig({ resize_button_enabled: true }), reader({ "show-resize-button": "false" }), noDebug).resize_button_enabled, false);
  assert.equal(overlayAttributes(mergeConfig({ resize_button_enabled: false }), reader({ "show-resize-button": "true" }), noDebug).resize_button_enabled, true);
});

test("attrs (Q9): show-language-selector-on-trigger turns the collapsed selector on", () => {
  const cfg = overlayAttributes(mergeConfig({}), reader({ "show-language-selector-on-trigger": "true" }), noDebug);
  assert.equal(cfg.show_language_selector_on_trigger, true);
});

test("attrs (Q9): show-avatar-when-collapsed=false hides the launcher avatar", () => {
  const cfg = overlayAttributes(mergeConfig({}), reader({ "show-avatar-when-collapsed": "false" }), noDebug);
  assert.equal(cfg.show_avatar_when_collapsed, false);
});

test("attrs (Q9): exactly the four ruled display attributes, each a boolean config key", () => {
  assert.deepEqual(
    DISPLAY_ATTRIBUTES.map(([name]) => name),
    ["show-agent-status", "show-resize-button", "show-language-selector-on-trigger", "show-avatar-when-collapsed"],
  );
  for (const [, key] of DISPLAY_ATTRIBUTES) assert.equal(typeof DEFAULT_CONFIG[key], "boolean", key);
  assert.equal(parseBool("yes"), undefined, "only true / false count");
});

test("attrs: variant / placement / terms-key overlay; invalid values are ignored", () => {
  const cfg = overlayAttributes(
    mergeConfig({}),
    reader({ variant: "tiny", placement: "top-left", "terms-key": "acme_terms_v2" }),
    noDebug,
  );
  assert.equal(cfg.variant, "tiny");
  assert.equal(cfg.placement, "top-left");
  assert.equal(cfg.terms.local_storage_key, "acme_terms_v2");
  const bad = overlayAttributes(mergeConfig({}), reader({ variant: "huge", placement: "middle" }), noDebug);
  assert.equal(bad.variant, DEFAULT_CONFIG.variant);
  assert.equal(bad.placement, DEFAULT_CONFIG.placement);
});

test("attrs (Q25): text-contents maps vendor keys onto ours; unknown keys go to debug", () => {
  const debug: Array<Record<string, unknown>> = [];
  const text = mapTextContents(
    JSON.stringify({ start_call: "Call us", queue_waiting_status: "Please hold", rich_content_button: "x", end_call: 5 }),
    (e) => debug.push(e),
  );
  assert.deepEqual(text, { start_call: "Call us", queued_status: "Please hold" });
  assert.deepEqual(debug, [{ type: "unmapped_text_contents_key", key: "rich_content_button" }]);
  const invalid: Array<Record<string, unknown>> = [];
  assert.deepEqual(mapTextContents("not json", (e) => invalid.push(e)), {});
  assert.deepEqual(invalid, [{ type: "invalid_text_contents" }]);
});

test("attrs (Q25 drift): every mapped target is one of WIDGET_TEXT_KEYS", () => {
  const ours = new Set<string>(WIDGET_TEXT_KEYS);
  for (const [vendor, target] of Object.entries(VENDOR_TEXT_RENAMES)) {
    assert.ok(ours.has(target), `${vendor} → ${target} is not a WIDGET_TEXT_KEYS entry`);
    assert.ok(!ours.has(vendor), `${vendor} is already our key — the rename would shadow it`);
  }
});

test("attrs: override-* attributes → our flat keys; the explicit overrides object wins elsewhere", () => {
  assert.deepEqual(
    attributeOverrides(
      reader({
        "override-first-message": "Hi Dana",
        "override-language": "es",
        "override-prompt": "Be brief",
        "override-llm": "gpt-x",
        "override-voice-id": "v1",
        "override-speed": "1.1",
        "override-stability": "0.4",
        "override-similarity-boost": "0.7",
        "override-text-only": "true",
      }),
    ),
    {
      first_message: "Hi Dana",
      language: "es",
      system_prompt: "Be brief",
      llm: "gpt-x",
      voice: "v1",
      voice_speed: 1.1,
      voice_stability: 0.4,
      voice_similarity: 0.7,
      text_only: true,
    },
  );
  assert.equal(attributeOverrides(reader({ "override-speed": "fast" })), null, "a bad number is dropped");
  assert.equal(attributeOverrides(reader({})), null);
});

test("events (Q22): nothing is forwarded without allow-events=\"true\"", () => {
  for (const type of ["voso-widget:user-message", "voso-widget:user-activity", "voso-widget:contextual-update"]) {
    assert.equal(inboundAction(type, null, { message: "hi" }), null, type);
    assert.equal(inboundAction(type, "false", { message: "hi" }), null, type);
  }
});

test("events (Q22): user-message forwards a non-blank message", () => {
  assert.deepEqual(inboundAction("voso-widget:user-message", "true", { message: " hi " }), { kind: "user-message", message: "hi" });
  assert.equal(inboundAction("voso-widget:user-message", "true", { message: "  " }), null);
});

test("events (Q22): user-activity needs no payload", () => {
  assert.deepEqual(inboundAction("voso-widget:user-activity", "true", undefined), { kind: "user-activity" });
});

test("events (Q22): contextual-update forwards the message", () => {
  assert.deepEqual(inboundAction("voso-widget:contextual-update", "true", { message: "Plan: gold" }), {
    kind: "contextual-update",
    message: "Plan: gold",
  });
  assert.equal(inboundAction("voso-widget:other", "true", { message: "x" }), null);
});

test("events (Q30): expand / collapse / toggle, never collapsing an always-expanded widget", () => {
  assert.equal(expandAction("expand", false, true), true);
  assert.equal(expandAction("collapse", true, true), false);
  assert.equal(expandAction("collapse", true, false), null);
  assert.equal(expandAction("toggle", false, true), true);
  assert.equal(expandAction("toggle", true, true), false);
  assert.equal(expandAction("toggle", true, false), null);
  assert.equal(expandAction("open", false, true), null);
});
