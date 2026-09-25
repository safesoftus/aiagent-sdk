// test/attributes.test.ts
import test from "node:test";
import assert from "node:assert/strict";

// src/link-policy.ts
var DEFAULT_LINK_POLICY = {
  allow_all: false,
  allowed_hosts: [],
  include_www_variants: true,
  allow_http: false
};

// src/config.ts
var DEFAULT_COLORS = {
  base: "#ffffff",
  base_hover: "#f9fafb",
  base_active: "#f3f4f6",
  base_border: "#e5e7eb",
  base_subtle: "#6b7280",
  base_primary: "#000000",
  base_error: "#ef4444",
  accent: "#000000",
  accent_hover: "#1f2937",
  accent_active: "#374151",
  accent_border: "#4b5563",
  accent_subtle: "#6b7280",
  accent_primary: "#ffffff"
};
var DEFAULT_RADII = {
  overlay_padding: 32,
  button_radius: 18,
  input_radius: 18,
  bubble_radius: 15,
  sheet_radius: 24,
  compact_sheet_radius: 30,
  dropdown_sheet_radius: 24
};
var DEFAULT_CONFIG = {
  agent_name: "AI Agent",
  variant: "compact",
  placement: "bottom-right",
  expanded_behavior: "starts_collapsed",
  collapsible: true,
  syntax_theme: "auto",
  avatar: { kind: "orb", color_1: "#7959ff", color_2: "#9b7aff" },
  colors: DEFAULT_COLORS,
  radii: DEFAULT_RADII,
  terms: { enabled: false, content: "", local_storage_key: "" },
  link_policy: DEFAULT_LINK_POLICY,
  languages: [],
  text: {},
  voice_enabled: true,
  text_enabled: true,
  send_text_while_on_call: true,
  transcript_enabled: true,
  language_dropdown_enabled: true,
  mute_button_enabled: true,
  show_conversation_id: true,
  hide_audio_tags: false,
  action_indicator_enabled: true,
  resize_button_enabled: true,
  feedback_enabled: true,
  show_agent_status: true,
  show_language_selector_on_trigger: false,
  show_avatar_when_collapsed: true
};
function mergeConfig(partial) {
  if (!partial) return DEFAULT_CONFIG;
  return {
    ...DEFAULT_CONFIG,
    ...partial,
    text_enabled: true,
    avatar: partial.avatar ?? DEFAULT_CONFIG.avatar,
    colors: { ...DEFAULT_COLORS, ...partial.colors ?? {} },
    radii: { ...DEFAULT_RADII, ...partial.radii ?? {} },
    terms: { ...DEFAULT_CONFIG.terms, ...partial.terms ?? {} },
    link_policy: { ...DEFAULT_LINK_POLICY, ...partial.link_policy ?? {} },
    languages: partial.languages ?? [],
    text: partial.text ?? {}
  };
}

// src/text-defaults.ts
var WIDGET_TEXT_DEFAULTS = {
  main_label: "Need help?",
  start_call: "Start a call",
  start_chat: "Start a chat",
  new_call: "New call",
  end_call: "End",
  mute_microphone: "Mute microphone",
  change_language: "Change language",
  collapse: "Collapse",
  expand: "Expand",
  copied: "Copied!",
  accept_terms: "Accept",
  dismiss_terms: "Cancel",
  listening_status: "Listening",
  speaking_status: "Talk to interrupt",
  connecting_status: "Connecting",
  chatting_status: "Chatting with AI Agent",
  input_label: "Text message input",
  input_placeholder: "Send a message",
  input_placeholder_text_only: "Send a message",
  input_placeholder_new_conversation: "Start a new conversation",
  user_ended_conversation: "You ended the conversation",
  agent_ended_conversation: "The agent ended the conversation",
  conversation_id: "Conversation ID",
  error_occurred: "An error occurred",
  copy_id: "Copy ID",
  initiate_feedback: "How was this conversation?",
  request_follow_up_feedback: "Tell us more",
  thanks_for_feedback: "Thank you for your feedback!",
  thanks_for_feedback_details: "Your feedback helps us improve our service and better assist you.",
  follow_up_feedback_placeholder: "Tell us more about your experience...",
  submit: "Submit",
  go_back: "Go back",
  send_message: "Send",
  text_mode: "Switch to text mode",
  voice_mode: "Switch to voice mode",
  switched_to_text_mode: "Switched to text mode",
  switched_to_voice_mode: "Switched to voice mode",
  copy: "Copy",
  download: "Download",
  wrap: "Wrap",
  agent_working: "Working...",
  agent_done: "Completed",
  agent_error: "Error occurred",
  attach_file: "Attach file",
  remove_file: "Remove file",
  file_upload_error: "Failed to upload file.",
  file_type_unsupported: "Unsupported file type. Accepted types:",
  file_too_large: "File size exceeds the maximum limit.",
  file_limit_reached: "Maximum number of files for this conversation reached.",
  typing_indicator: "Agent is typing ...",
  // Agent-integration E7 §4.3 (VOSO-760): the caller waits in the agent's
  // queue (vendor widget ≥ 0.17.0 shows a waiting line and disables input).
  queued_status: "Waiting for an available agent\u2026",
  queue_timed_out: "No agent became available \u2014 please try again later"
};
var WIDGET_TEXT_KEYS = Object.keys(
  WIDGET_TEXT_DEFAULTS
);

// src/attributes.ts
function parseBool(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  return void 0;
}
var DISPLAY_ATTRIBUTES = [
  ["show-agent-status", "show_agent_status"],
  ["show-resize-button", "resize_button_enabled"],
  ["show-language-selector-on-trigger", "show_language_selector_on_trigger"],
  ["show-avatar-when-collapsed", "show_avatar_when_collapsed"]
];
var VARIANTS = ["tiny", "compact", "full"];
var PLACEMENTS = [
  "top-left",
  "top",
  "top-right",
  "bottom-left",
  "bottom",
  "bottom-right"
];
var VENDOR_TEXT_RENAMES = {
  queue_waiting_status: "queued_status"
};
var OUR_TEXT_KEYS = new Set(WIDGET_TEXT_KEYS);
function mapTextContents(raw, debug) {
  if (!raw) return {};
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    debug({ type: "invalid_text_contents" });
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    debug({ type: "invalid_text_contents" });
    return {};
  }
  const out = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== "string") continue;
    const target = OUR_TEXT_KEYS.has(key) ? key : VENDOR_TEXT_RENAMES[key];
    if (target) out[target] = value;
    else debug({ type: "unmapped_text_contents_key", key });
  }
  return out;
}
function overlayAttributes(cfg, attr, debug) {
  const out = { ...cfg };
  for (const [name, key] of DISPLAY_ATTRIBUTES) {
    const value = parseBool(attr(name));
    if (value !== void 0) out[key] = value;
  }
  const variant = attr("variant");
  if (variant && VARIANTS.includes(variant)) out.variant = variant;
  const placement = attr("placement");
  if (placement && PLACEMENTS.includes(placement)) {
    out.placement = placement;
  }
  const termsKey = attr("terms-key");
  if (termsKey) out.terms = { ...out.terms, local_storage_key: termsKey };
  const text = mapTextContents(attr("text-contents"), debug);
  if (Object.keys(text).length > 0) out.text = { ...out.text, ...text };
  return out;
}
var OVERRIDE_ATTRIBUTES = [
  ["override-prompt", "system_prompt", "string"],
  ["override-llm", "llm", "string"],
  ["override-first-message", "first_message", "string"],
  ["override-language", "language", "string"],
  ["override-voice-id", "voice", "string"],
  ["override-speed", "voice_speed", "number"],
  ["override-stability", "voice_stability", "number"],
  ["override-similarity-boost", "voice_similarity", "number"],
  ["override-text-only", "text_only", "boolean"]
];
function attributeOverrides(attr) {
  const out = {};
  for (const [name, key, kind] of OVERRIDE_ATTRIBUTES) {
    const raw = attr(name);
    if (raw === null || raw === "") continue;
    if (kind === "number") {
      const value = Number(raw);
      if (Number.isFinite(value)) out[key] = value;
    } else if (kind === "boolean") {
      const value = parseBool(raw);
      if (value !== void 0) out[key] = value;
    } else {
      out[key] = raw;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}
function expandAction(action, expanded, collapsible) {
  if (action === "expand") return true;
  if (action === "collapse") return collapsible ? false : null;
  if (action === "toggle") return expanded ? collapsible ? false : null : true;
  return null;
}
function inboundAction(type, allowEvents, detail) {
  if (allowEvents !== "true") return null;
  const raw = detail?.message;
  const message = typeof raw === "string" ? raw.trim() : "";
  switch (type) {
    case "voso-widget:user-message":
      return message ? { kind: "user-message", message } : null;
    case "voso-widget:user-activity":
      return { kind: "user-activity" };
    case "voso-widget:contextual-update":
      return message ? { kind: "contextual-update", message } : null;
    default:
      return null;
  }
}

// test/attributes.test.ts
var reader = (attrs) => (name) => attrs[name] ?? null;
var noDebug = () => {
};
test("attrs: no attribute \u2192 the config is unchanged (today's rendering)", () => {
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
    ["show-agent-status", "show-resize-button", "show-language-selector-on-trigger", "show-avatar-when-collapsed"]
  );
  for (const [, key] of DISPLAY_ATTRIBUTES) assert.equal(typeof DEFAULT_CONFIG[key], "boolean", key);
  assert.equal(parseBool("yes"), void 0, "only true / false count");
});
test("attrs: variant / placement / terms-key overlay; invalid values are ignored", () => {
  const cfg = overlayAttributes(
    mergeConfig({}),
    reader({ variant: "tiny", placement: "top-left", "terms-key": "acme_terms_v2" }),
    noDebug
  );
  assert.equal(cfg.variant, "tiny");
  assert.equal(cfg.placement, "top-left");
  assert.equal(cfg.terms.local_storage_key, "acme_terms_v2");
  const bad = overlayAttributes(mergeConfig({}), reader({ variant: "huge", placement: "middle" }), noDebug);
  assert.equal(bad.variant, DEFAULT_CONFIG.variant);
  assert.equal(bad.placement, DEFAULT_CONFIG.placement);
});
test("attrs (Q25): text-contents maps vendor keys onto ours; unknown keys go to debug", () => {
  const debug = [];
  const text = mapTextContents(
    JSON.stringify({ start_call: "Call us", queue_waiting_status: "Please hold", rich_content_button: "x", end_call: 5 }),
    (e) => debug.push(e)
  );
  assert.deepEqual(text, { start_call: "Call us", queued_status: "Please hold" });
  assert.deepEqual(debug, [{ type: "unmapped_text_contents_key", key: "rich_content_button" }]);
  const invalid = [];
  assert.deepEqual(mapTextContents("not json", (e) => invalid.push(e)), {});
  assert.deepEqual(invalid, [{ type: "invalid_text_contents" }]);
});
test("attrs (Q25 drift): every mapped target is one of WIDGET_TEXT_KEYS", () => {
  const ours = new Set(WIDGET_TEXT_KEYS);
  for (const [vendor, target] of Object.entries(VENDOR_TEXT_RENAMES)) {
    assert.ok(ours.has(target), `${vendor} \u2192 ${target} is not a WIDGET_TEXT_KEYS entry`);
    assert.ok(!ours.has(vendor), `${vendor} is already our key \u2014 the rename would shadow it`);
  }
});
test("attrs: override-* attributes \u2192 our flat keys; the explicit overrides object wins elsewhere", () => {
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
        "override-text-only": "true"
      })
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
      text_only: true
    }
  );
  assert.equal(attributeOverrides(reader({ "override-speed": "fast" })), null, "a bad number is dropped");
  assert.equal(attributeOverrides(reader({})), null);
});
test('events (Q22): nothing is forwarded without allow-events="true"', () => {
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
  assert.deepEqual(inboundAction("voso-widget:user-activity", "true", void 0), { kind: "user-activity" });
});
test("events (Q22): contextual-update forwards the message", () => {
  assert.deepEqual(inboundAction("voso-widget:contextual-update", "true", { message: "Plan: gold" }), {
    kind: "contextual-update",
    message: "Plan: gold"
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vdGVzdC9hdHRyaWJ1dGVzLnRlc3QudHMiLCAiLi4vc3JjL2xpbmstcG9saWN5LnRzIiwgIi4uL3NyYy9jb25maWcudHMiLCAiLi4vc3JjL3RleHQtZGVmYXVsdHMudHMiLCAiLi4vc3JjL2F0dHJpYnV0ZXMudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImltcG9ydCB0ZXN0IGZyb20gXCJub2RlOnRlc3RcIjtcbmltcG9ydCBhc3NlcnQgZnJvbSBcIm5vZGU6YXNzZXJ0L3N0cmljdFwiO1xuaW1wb3J0IHsgREVGQVVMVF9DT05GSUcsIG1lcmdlQ29uZmlnIH0gZnJvbSBcIi4uL3NyYy9jb25maWdcIjtcbmltcG9ydCB7XG4gIGF0dHJpYnV0ZU92ZXJyaWRlcyxcbiAgRElTUExBWV9BVFRSSUJVVEVTLFxuICBleHBhbmRBY3Rpb24sXG4gIGluYm91bmRBY3Rpb24sXG4gIG1hcFRleHRDb250ZW50cyxcbiAgb3ZlcmxheUF0dHJpYnV0ZXMsXG4gIHBhcnNlQm9vbCxcbiAgVkVORE9SX1RFWFRfUkVOQU1FUyxcbn0gZnJvbSBcIi4uL3NyYy9hdHRyaWJ1dGVzXCI7XG5pbXBvcnQgeyBXSURHRVRfVEVYVF9LRVlTIH0gZnJvbSBcIi4uL3NyYy90ZXh0LWRlZmF1bHRzXCI7XG5cbi8vIEU0IFx1MDBBNzQuOCBcdTIwMTQgdGhlIHZlbmRvcidzIGVsZW1lbnQgYXR0cmlidXRlcyBvbiA8dm9zby13aWRnZXQ+IChROSwgUTIyLCBRMjUsXG4vLyBRMzApLiBQdXJlIHJ1bGVzOyB0aGUgZWxlbWVudCB3aXJlcyB0aGVtICh3aWRnZXQudHMpLlxuXG5jb25zdCByZWFkZXIgPSAoYXR0cnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4pID0+IChuYW1lOiBzdHJpbmcpID0+IGF0dHJzW25hbWVdID8/IG51bGw7XG5jb25zdCBub0RlYnVnID0gKCkgPT4ge307XG5cbnRlc3QoXCJhdHRyczogbm8gYXR0cmlidXRlIFx1MjE5MiB0aGUgY29uZmlnIGlzIHVuY2hhbmdlZCAodG9kYXkncyByZW5kZXJpbmcpXCIsICgpID0+IHtcbiAgY29uc3QgY2ZnID0gbWVyZ2VDb25maWcoeyByZXNpemVfYnV0dG9uX2VuYWJsZWQ6IGZhbHNlLCB2YXJpYW50OiBcImZ1bGxcIiB9KTtcbiAgYXNzZXJ0LmRlZXBFcXVhbChvdmVybGF5QXR0cmlidXRlcyhjZmcsIHJlYWRlcih7fSksIG5vRGVidWcpLCBjZmcpO1xuICBhc3NlcnQuZXF1YWwoREVGQVVMVF9DT05GSUcuc2hvd19hZ2VudF9zdGF0dXMsIHRydWUpO1xuICBhc3NlcnQuZXF1YWwoREVGQVVMVF9DT05GSUcuc2hvd19hdmF0YXJfd2hlbl9jb2xsYXBzZWQsIHRydWUpO1xuICBhc3NlcnQuZXF1YWwoREVGQVVMVF9DT05GSUcuc2hvd19sYW5ndWFnZV9zZWxlY3Rvcl9vbl90cmlnZ2VyLCBmYWxzZSk7XG59KTtcblxudGVzdChcImF0dHJzIChROSk6IHNob3ctYWdlbnQtc3RhdHVzIG92ZXJsYXlzIHRoZSBjb25maWcgYWZ0ZXIgbWVyZ2VDb25maWdcIiwgKCkgPT4ge1xuICBjb25zdCBjZmcgPSBvdmVybGF5QXR0cmlidXRlcyhtZXJnZUNvbmZpZyh7fSksIHJlYWRlcih7IFwic2hvdy1hZ2VudC1zdGF0dXNcIjogXCJmYWxzZVwiIH0pLCBub0RlYnVnKTtcbiAgYXNzZXJ0LmVxdWFsKGNmZy5zaG93X2FnZW50X3N0YXR1cywgZmFsc2UpO1xufSk7XG5cbnRlc3QoXCJhdHRycyAoUTkpOiBzaG93LXJlc2l6ZS1idXR0b24gb3ZlcnJpZGVzIHRoZSBzZXJ2ZXIncyByZXNpemUgdG9nZ2xlIGJvdGggd2F5c1wiLCAoKSA9PiB7XG4gIGFzc2VydC5lcXVhbChvdmVybGF5QXR0cmlidXRlcyhtZXJnZUNvbmZpZyh7IHJlc2l6ZV9idXR0b25fZW5hYmxlZDogdHJ1ZSB9KSwgcmVhZGVyKHsgXCJzaG93LXJlc2l6ZS1idXR0b25cIjogXCJmYWxzZVwiIH0pLCBub0RlYnVnKS5yZXNpemVfYnV0dG9uX2VuYWJsZWQsIGZhbHNlKTtcbiAgYXNzZXJ0LmVxdWFsKG92ZXJsYXlBdHRyaWJ1dGVzKG1lcmdlQ29uZmlnKHsgcmVzaXplX2J1dHRvbl9lbmFibGVkOiBmYWxzZSB9KSwgcmVhZGVyKHsgXCJzaG93LXJlc2l6ZS1idXR0b25cIjogXCJ0cnVlXCIgfSksIG5vRGVidWcpLnJlc2l6ZV9idXR0b25fZW5hYmxlZCwgdHJ1ZSk7XG59KTtcblxudGVzdChcImF0dHJzIChROSk6IHNob3ctbGFuZ3VhZ2Utc2VsZWN0b3Itb24tdHJpZ2dlciB0dXJucyB0aGUgY29sbGFwc2VkIHNlbGVjdG9yIG9uXCIsICgpID0+IHtcbiAgY29uc3QgY2ZnID0gb3ZlcmxheUF0dHJpYnV0ZXMobWVyZ2VDb25maWcoe30pLCByZWFkZXIoeyBcInNob3ctbGFuZ3VhZ2Utc2VsZWN0b3Itb24tdHJpZ2dlclwiOiBcInRydWVcIiB9KSwgbm9EZWJ1Zyk7XG4gIGFzc2VydC5lcXVhbChjZmcuc2hvd19sYW5ndWFnZV9zZWxlY3Rvcl9vbl90cmlnZ2VyLCB0cnVlKTtcbn0pO1xuXG50ZXN0KFwiYXR0cnMgKFE5KTogc2hvdy1hdmF0YXItd2hlbi1jb2xsYXBzZWQ9ZmFsc2UgaGlkZXMgdGhlIGxhdW5jaGVyIGF2YXRhclwiLCAoKSA9PiB7XG4gIGNvbnN0IGNmZyA9IG92ZXJsYXlBdHRyaWJ1dGVzKG1lcmdlQ29uZmlnKHt9KSwgcmVhZGVyKHsgXCJzaG93LWF2YXRhci13aGVuLWNvbGxhcHNlZFwiOiBcImZhbHNlXCIgfSksIG5vRGVidWcpO1xuICBhc3NlcnQuZXF1YWwoY2ZnLnNob3dfYXZhdGFyX3doZW5fY29sbGFwc2VkLCBmYWxzZSk7XG59KTtcblxudGVzdChcImF0dHJzIChROSk6IGV4YWN0bHkgdGhlIGZvdXIgcnVsZWQgZGlzcGxheSBhdHRyaWJ1dGVzLCBlYWNoIGEgYm9vbGVhbiBjb25maWcga2V5XCIsICgpID0+IHtcbiAgYXNzZXJ0LmRlZXBFcXVhbChcbiAgICBESVNQTEFZX0FUVFJJQlVURVMubWFwKChbbmFtZV0pID0+IG5hbWUpLFxuICAgIFtcInNob3ctYWdlbnQtc3RhdHVzXCIsIFwic2hvdy1yZXNpemUtYnV0dG9uXCIsIFwic2hvdy1sYW5ndWFnZS1zZWxlY3Rvci1vbi10cmlnZ2VyXCIsIFwic2hvdy1hdmF0YXItd2hlbi1jb2xsYXBzZWRcIl0sXG4gICk7XG4gIGZvciAoY29uc3QgWywga2V5XSBvZiBESVNQTEFZX0FUVFJJQlVURVMpIGFzc2VydC5lcXVhbCh0eXBlb2YgREVGQVVMVF9DT05GSUdba2V5XSwgXCJib29sZWFuXCIsIGtleSk7XG4gIGFzc2VydC5lcXVhbChwYXJzZUJvb2woXCJ5ZXNcIiksIHVuZGVmaW5lZCwgXCJvbmx5IHRydWUgLyBmYWxzZSBjb3VudFwiKTtcbn0pO1xuXG50ZXN0KFwiYXR0cnM6IHZhcmlhbnQgLyBwbGFjZW1lbnQgLyB0ZXJtcy1rZXkgb3ZlcmxheTsgaW52YWxpZCB2YWx1ZXMgYXJlIGlnbm9yZWRcIiwgKCkgPT4ge1xuICBjb25zdCBjZmcgPSBvdmVybGF5QXR0cmlidXRlcyhcbiAgICBtZXJnZUNvbmZpZyh7fSksXG4gICAgcmVhZGVyKHsgdmFyaWFudDogXCJ0aW55XCIsIHBsYWNlbWVudDogXCJ0b3AtbGVmdFwiLCBcInRlcm1zLWtleVwiOiBcImFjbWVfdGVybXNfdjJcIiB9KSxcbiAgICBub0RlYnVnLFxuICApO1xuICBhc3NlcnQuZXF1YWwoY2ZnLnZhcmlhbnQsIFwidGlueVwiKTtcbiAgYXNzZXJ0LmVxdWFsKGNmZy5wbGFjZW1lbnQsIFwidG9wLWxlZnRcIik7XG4gIGFzc2VydC5lcXVhbChjZmcudGVybXMubG9jYWxfc3RvcmFnZV9rZXksIFwiYWNtZV90ZXJtc192MlwiKTtcbiAgY29uc3QgYmFkID0gb3ZlcmxheUF0dHJpYnV0ZXMobWVyZ2VDb25maWcoe30pLCByZWFkZXIoeyB2YXJpYW50OiBcImh1Z2VcIiwgcGxhY2VtZW50OiBcIm1pZGRsZVwiIH0pLCBub0RlYnVnKTtcbiAgYXNzZXJ0LmVxdWFsKGJhZC52YXJpYW50LCBERUZBVUxUX0NPTkZJRy52YXJpYW50KTtcbiAgYXNzZXJ0LmVxdWFsKGJhZC5wbGFjZW1lbnQsIERFRkFVTFRfQ09ORklHLnBsYWNlbWVudCk7XG59KTtcblxudGVzdChcImF0dHJzIChRMjUpOiB0ZXh0LWNvbnRlbnRzIG1hcHMgdmVuZG9yIGtleXMgb250byBvdXJzOyB1bmtub3duIGtleXMgZ28gdG8gZGVidWdcIiwgKCkgPT4ge1xuICBjb25zdCBkZWJ1ZzogQXJyYXk8UmVjb3JkPHN0cmluZywgdW5rbm93bj4+ID0gW107XG4gIGNvbnN0IHRleHQgPSBtYXBUZXh0Q29udGVudHMoXG4gICAgSlNPTi5zdHJpbmdpZnkoeyBzdGFydF9jYWxsOiBcIkNhbGwgdXNcIiwgcXVldWVfd2FpdGluZ19zdGF0dXM6IFwiUGxlYXNlIGhvbGRcIiwgcmljaF9jb250ZW50X2J1dHRvbjogXCJ4XCIsIGVuZF9jYWxsOiA1IH0pLFxuICAgIChlKSA9PiBkZWJ1Zy5wdXNoKGUpLFxuICApO1xuICBhc3NlcnQuZGVlcEVxdWFsKHRleHQsIHsgc3RhcnRfY2FsbDogXCJDYWxsIHVzXCIsIHF1ZXVlZF9zdGF0dXM6IFwiUGxlYXNlIGhvbGRcIiB9KTtcbiAgYXNzZXJ0LmRlZXBFcXVhbChkZWJ1ZywgW3sgdHlwZTogXCJ1bm1hcHBlZF90ZXh0X2NvbnRlbnRzX2tleVwiLCBrZXk6IFwicmljaF9jb250ZW50X2J1dHRvblwiIH1dKTtcbiAgY29uc3QgaW52YWxpZDogQXJyYXk8UmVjb3JkPHN0cmluZywgdW5rbm93bj4+ID0gW107XG4gIGFzc2VydC5kZWVwRXF1YWwobWFwVGV4dENvbnRlbnRzKFwibm90IGpzb25cIiwgKGUpID0+IGludmFsaWQucHVzaChlKSksIHt9KTtcbiAgYXNzZXJ0LmRlZXBFcXVhbChpbnZhbGlkLCBbeyB0eXBlOiBcImludmFsaWRfdGV4dF9jb250ZW50c1wiIH1dKTtcbn0pO1xuXG50ZXN0KFwiYXR0cnMgKFEyNSBkcmlmdCk6IGV2ZXJ5IG1hcHBlZCB0YXJnZXQgaXMgb25lIG9mIFdJREdFVF9URVhUX0tFWVNcIiwgKCkgPT4ge1xuICBjb25zdCBvdXJzID0gbmV3IFNldDxzdHJpbmc+KFdJREdFVF9URVhUX0tFWVMpO1xuICBmb3IgKGNvbnN0IFt2ZW5kb3IsIHRhcmdldF0gb2YgT2JqZWN0LmVudHJpZXMoVkVORE9SX1RFWFRfUkVOQU1FUykpIHtcbiAgICBhc3NlcnQub2sob3Vycy5oYXModGFyZ2V0KSwgYCR7dmVuZG9yfSBcdTIxOTIgJHt0YXJnZXR9IGlzIG5vdCBhIFdJREdFVF9URVhUX0tFWVMgZW50cnlgKTtcbiAgICBhc3NlcnQub2soIW91cnMuaGFzKHZlbmRvciksIGAke3ZlbmRvcn0gaXMgYWxyZWFkeSBvdXIga2V5IFx1MjAxNCB0aGUgcmVuYW1lIHdvdWxkIHNoYWRvdyBpdGApO1xuICB9XG59KTtcblxudGVzdChcImF0dHJzOiBvdmVycmlkZS0qIGF0dHJpYnV0ZXMgXHUyMTkyIG91ciBmbGF0IGtleXM7IHRoZSBleHBsaWNpdCBvdmVycmlkZXMgb2JqZWN0IHdpbnMgZWxzZXdoZXJlXCIsICgpID0+IHtcbiAgYXNzZXJ0LmRlZXBFcXVhbChcbiAgICBhdHRyaWJ1dGVPdmVycmlkZXMoXG4gICAgICByZWFkZXIoe1xuICAgICAgICBcIm92ZXJyaWRlLWZpcnN0LW1lc3NhZ2VcIjogXCJIaSBEYW5hXCIsXG4gICAgICAgIFwib3ZlcnJpZGUtbGFuZ3VhZ2VcIjogXCJlc1wiLFxuICAgICAgICBcIm92ZXJyaWRlLXByb21wdFwiOiBcIkJlIGJyaWVmXCIsXG4gICAgICAgIFwib3ZlcnJpZGUtbGxtXCI6IFwiZ3B0LXhcIixcbiAgICAgICAgXCJvdmVycmlkZS12b2ljZS1pZFwiOiBcInYxXCIsXG4gICAgICAgIFwib3ZlcnJpZGUtc3BlZWRcIjogXCIxLjFcIixcbiAgICAgICAgXCJvdmVycmlkZS1zdGFiaWxpdHlcIjogXCIwLjRcIixcbiAgICAgICAgXCJvdmVycmlkZS1zaW1pbGFyaXR5LWJvb3N0XCI6IFwiMC43XCIsXG4gICAgICAgIFwib3ZlcnJpZGUtdGV4dC1vbmx5XCI6IFwidHJ1ZVwiLFxuICAgICAgfSksXG4gICAgKSxcbiAgICB7XG4gICAgICBmaXJzdF9tZXNzYWdlOiBcIkhpIERhbmFcIixcbiAgICAgIGxhbmd1YWdlOiBcImVzXCIsXG4gICAgICBzeXN0ZW1fcHJvbXB0OiBcIkJlIGJyaWVmXCIsXG4gICAgICBsbG06IFwiZ3B0LXhcIixcbiAgICAgIHZvaWNlOiBcInYxXCIsXG4gICAgICB2b2ljZV9zcGVlZDogMS4xLFxuICAgICAgdm9pY2Vfc3RhYmlsaXR5OiAwLjQsXG4gICAgICB2b2ljZV9zaW1pbGFyaXR5OiAwLjcsXG4gICAgICB0ZXh0X29ubHk6IHRydWUsXG4gICAgfSxcbiAgKTtcbiAgYXNzZXJ0LmVxdWFsKGF0dHJpYnV0ZU92ZXJyaWRlcyhyZWFkZXIoeyBcIm92ZXJyaWRlLXNwZWVkXCI6IFwiZmFzdFwiIH0pKSwgbnVsbCwgXCJhIGJhZCBudW1iZXIgaXMgZHJvcHBlZFwiKTtcbiAgYXNzZXJ0LmVxdWFsKGF0dHJpYnV0ZU92ZXJyaWRlcyhyZWFkZXIoe30pKSwgbnVsbCk7XG59KTtcblxudGVzdChcImV2ZW50cyAoUTIyKTogbm90aGluZyBpcyBmb3J3YXJkZWQgd2l0aG91dCBhbGxvdy1ldmVudHM9XFxcInRydWVcXFwiXCIsICgpID0+IHtcbiAgZm9yIChjb25zdCB0eXBlIG9mIFtcInZvc28td2lkZ2V0OnVzZXItbWVzc2FnZVwiLCBcInZvc28td2lkZ2V0OnVzZXItYWN0aXZpdHlcIiwgXCJ2b3NvLXdpZGdldDpjb250ZXh0dWFsLXVwZGF0ZVwiXSkge1xuICAgIGFzc2VydC5lcXVhbChpbmJvdW5kQWN0aW9uKHR5cGUsIG51bGwsIHsgbWVzc2FnZTogXCJoaVwiIH0pLCBudWxsLCB0eXBlKTtcbiAgICBhc3NlcnQuZXF1YWwoaW5ib3VuZEFjdGlvbih0eXBlLCBcImZhbHNlXCIsIHsgbWVzc2FnZTogXCJoaVwiIH0pLCBudWxsLCB0eXBlKTtcbiAgfVxufSk7XG5cbnRlc3QoXCJldmVudHMgKFEyMik6IHVzZXItbWVzc2FnZSBmb3J3YXJkcyBhIG5vbi1ibGFuayBtZXNzYWdlXCIsICgpID0+IHtcbiAgYXNzZXJ0LmRlZXBFcXVhbChpbmJvdW5kQWN0aW9uKFwidm9zby13aWRnZXQ6dXNlci1tZXNzYWdlXCIsIFwidHJ1ZVwiLCB7IG1lc3NhZ2U6IFwiIGhpIFwiIH0pLCB7IGtpbmQ6IFwidXNlci1tZXNzYWdlXCIsIG1lc3NhZ2U6IFwiaGlcIiB9KTtcbiAgYXNzZXJ0LmVxdWFsKGluYm91bmRBY3Rpb24oXCJ2b3NvLXdpZGdldDp1c2VyLW1lc3NhZ2VcIiwgXCJ0cnVlXCIsIHsgbWVzc2FnZTogXCIgIFwiIH0pLCBudWxsKTtcbn0pO1xuXG50ZXN0KFwiZXZlbnRzIChRMjIpOiB1c2VyLWFjdGl2aXR5IG5lZWRzIG5vIHBheWxvYWRcIiwgKCkgPT4ge1xuICBhc3NlcnQuZGVlcEVxdWFsKGluYm91bmRBY3Rpb24oXCJ2b3NvLXdpZGdldDp1c2VyLWFjdGl2aXR5XCIsIFwidHJ1ZVwiLCB1bmRlZmluZWQpLCB7IGtpbmQ6IFwidXNlci1hY3Rpdml0eVwiIH0pO1xufSk7XG5cbnRlc3QoXCJldmVudHMgKFEyMik6IGNvbnRleHR1YWwtdXBkYXRlIGZvcndhcmRzIHRoZSBtZXNzYWdlXCIsICgpID0+IHtcbiAgYXNzZXJ0LmRlZXBFcXVhbChpbmJvdW5kQWN0aW9uKFwidm9zby13aWRnZXQ6Y29udGV4dHVhbC11cGRhdGVcIiwgXCJ0cnVlXCIsIHsgbWVzc2FnZTogXCJQbGFuOiBnb2xkXCIgfSksIHtcbiAgICBraW5kOiBcImNvbnRleHR1YWwtdXBkYXRlXCIsXG4gICAgbWVzc2FnZTogXCJQbGFuOiBnb2xkXCIsXG4gIH0pO1xuICBhc3NlcnQuZXF1YWwoaW5ib3VuZEFjdGlvbihcInZvc28td2lkZ2V0Om90aGVyXCIsIFwidHJ1ZVwiLCB7IG1lc3NhZ2U6IFwieFwiIH0pLCBudWxsKTtcbn0pO1xuXG50ZXN0KFwiZXZlbnRzIChRMzApOiBleHBhbmQgLyBjb2xsYXBzZSAvIHRvZ2dsZSwgbmV2ZXIgY29sbGFwc2luZyBhbiBhbHdheXMtZXhwYW5kZWQgd2lkZ2V0XCIsICgpID0+IHtcbiAgYXNzZXJ0LmVxdWFsKGV4cGFuZEFjdGlvbihcImV4cGFuZFwiLCBmYWxzZSwgdHJ1ZSksIHRydWUpO1xuICBhc3NlcnQuZXF1YWwoZXhwYW5kQWN0aW9uKFwiY29sbGFwc2VcIiwgdHJ1ZSwgdHJ1ZSksIGZhbHNlKTtcbiAgYXNzZXJ0LmVxdWFsKGV4cGFuZEFjdGlvbihcImNvbGxhcHNlXCIsIHRydWUsIGZhbHNlKSwgbnVsbCk7XG4gIGFzc2VydC5lcXVhbChleHBhbmRBY3Rpb24oXCJ0b2dnbGVcIiwgZmFsc2UsIHRydWUpLCB0cnVlKTtcbiAgYXNzZXJ0LmVxdWFsKGV4cGFuZEFjdGlvbihcInRvZ2dsZVwiLCB0cnVlLCB0cnVlKSwgZmFsc2UpO1xuICBhc3NlcnQuZXF1YWwoZXhwYW5kQWN0aW9uKFwidG9nZ2xlXCIsIHRydWUsIGZhbHNlKSwgbnVsbCk7XG4gIGFzc2VydC5lcXVhbChleHBhbmRBY3Rpb24oXCJvcGVuXCIsIGZhbHNlLCB0cnVlKSwgbnVsbCk7XG59KTtcbiIsICIvLyBNYXJrZG93biBsaW5rIHBvbGljeSBcdTIwMTQgbWlycm9ycyB0aGUgYmFja2VuZC12YWxpZGF0ZWQgd2lkZ2V0IGNvbmZpZyBydWxlcy5cbi8vXG4vLyBDb250cmFjdCAoYmFja2VuZC1hdXRob3JpdGF0aXZlLCBlbmZvcmNlZCBhZ2FpbiBoZXJlIGF0IHJlbmRlciB0aW1lKTpcbi8vICAgKiBgamF2YXNjcmlwdDpgIChhbmQgZXZlcnkgbm9uLWh0dHAocykgc2NoZW1lKSBpcyBBTFdBWVMgYmxvY2tlZC5cbi8vICAgKiBgaHR0cDpgIGlzIGFsbG93ZWQgb25seSB3aGVuIGBhbGxvd19odHRwYCBpcyBvbiAoZGVmYXVsdCBodHRwcy1vbmx5KS5cbi8vICAgKiBgYWxsb3dfYWxsYCBwZXJtaXRzIGFueSBob3N0IChzY2hlbWUgcnVsZXMgc3RpbGwgYXBwbHkpLlxuLy8gICAqIE90aGVyd2lzZSB0aGUgVVJMJ3MgaG9zdG5hbWUgbXVzdCBtYXRjaCBhbiBhbGxvd2xpc3QgZW50cnkuIEVudHJpZXMgYXJlXG4vLyAgICAgaG9zdG5hbWVzIHdpdGggYW4gb3B0aW9uYWwgYDpwb3J0YC4gQW4gZW50cnkgd2l0aG91dCBhIHBvcnQgbWF0Y2hlcyBhbnlcbi8vICAgICBwb3J0OyBhbiBlbnRyeSB3aXRoIGEgcG9ydCByZXF1aXJlcyB0aGF0IGV4YWN0IHBvcnQuXG4vLyAgICogYGluY2x1ZGVfd3d3X3ZhcmlhbnRzYCBtYWtlcyBgZXhhbXBsZS5jb21gIFx1MjFDNCBgd3d3LmV4YW1wbGUuY29tYFxuLy8gICAgIGludGVyY2hhbmdlYWJsZSBpbiBib3RoIGRpcmVjdGlvbnMuXG5cbmV4cG9ydCBpbnRlcmZhY2UgTGlua1BvbGljeSB7XG4gIGFsbG93X2FsbDogYm9vbGVhbjtcbiAgYWxsb3dlZF9ob3N0czogc3RyaW5nW107XG4gIGluY2x1ZGVfd3d3X3ZhcmlhbnRzOiBib29sZWFuO1xuICBhbGxvd19odHRwOiBib29sZWFuO1xufVxuXG5leHBvcnQgY29uc3QgREVGQVVMVF9MSU5LX1BPTElDWTogTGlua1BvbGljeSA9IHtcbiAgYWxsb3dfYWxsOiBmYWxzZSxcbiAgYWxsb3dlZF9ob3N0czogW10sXG4gIGluY2x1ZGVfd3d3X3ZhcmlhbnRzOiB0cnVlLFxuICBhbGxvd19odHRwOiBmYWxzZSxcbn07XG5cbmZ1bmN0aW9uIHNwbGl0SG9zdFBvcnQoZW50cnk6IHN0cmluZyk6IHsgaG9zdDogc3RyaW5nOyBwb3J0OiBzdHJpbmcgfCBudWxsIH0ge1xuICBjb25zdCBpZHggPSBlbnRyeS5sYXN0SW5kZXhPZihcIjpcIik7XG4gIC8vIEEgbG9uZSBjb2xvbiBvciBJUHY2LXN0eWxlIGVudHJpZXMgYXJlIG5vdCBzdXBwb3J0ZWQgYnkgdGhlIGJhY2tlbmRcbiAgLy8gaG9zdG5hbWUgcnVsZSwgc28gYSBzaW1wbGUgc3BsaXQgaXMgc3VmZmljaWVudCBoZXJlLlxuICBpZiAoaWR4ID4gMCAmJiAvXlxcZCskLy50ZXN0KGVudHJ5LnNsaWNlKGlkeCArIDEpKSkge1xuICAgIHJldHVybiB7IGhvc3Q6IGVudHJ5LnNsaWNlKDAsIGlkeCkudG9Mb3dlckNhc2UoKSwgcG9ydDogZW50cnkuc2xpY2UoaWR4ICsgMSkgfTtcbiAgfVxuICByZXR1cm4geyBob3N0OiBlbnRyeS50b0xvd2VyQ2FzZSgpLCBwb3J0OiBudWxsIH07XG59XG5cbmZ1bmN0aW9uIGhvc3RNYXRjaGVzKFxuICB1cmxIb3N0OiBzdHJpbmcsXG4gIGVudHJ5SG9zdDogc3RyaW5nLFxuICBpbmNsdWRlV3d3OiBib29sZWFuLFxuKTogYm9vbGVhbiB7XG4gIGlmICh1cmxIb3N0ID09PSBlbnRyeUhvc3QpIHJldHVybiB0cnVlO1xuICBpZiAoIWluY2x1ZGVXd3cpIHJldHVybiBmYWxzZTtcbiAgY29uc3Qgc3RyaXAgPSAoaDogc3RyaW5nKSA9PiAoaC5zdGFydHNXaXRoKFwid3d3LlwiKSA/IGguc2xpY2UoNCkgOiBoKTtcbiAgcmV0dXJuIHN0cmlwKHVybEhvc3QpID09PSBzdHJpcChlbnRyeUhvc3QpO1xufVxuXG4vKipcbiAqIERlY2lkZSB3aGV0aGVyIGEgbWFya2Rvd24gbGluayBtYXkgcmVuZGVyIGFzIGEgY2xpY2thYmxlIGFuY2hvci5cbiAqIERpc2FsbG93ZWQgbGlua3MgYXJlIHJlbmRlcmVkIGFzIHBsYWluIHRleHQgYnkgdGhlIG1hcmtkb3duIHJlbmRlcmVyLlxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNMaW5rQWxsb3dlZChocmVmOiBzdHJpbmcsIHBvbGljeTogTGlua1BvbGljeSk6IGJvb2xlYW4ge1xuICBsZXQgdXJsOiBVUkw7XG4gIHRyeSB7XG4gICAgdXJsID0gbmV3IFVSTChocmVmKTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIGZhbHNlOyAvLyByZWxhdGl2ZS9tYWxmb3JtZWQgVVJMcyBuZXZlciByZW5kZXIgYXMgbGlua3NcbiAgfVxuICBjb25zdCBzY2hlbWUgPSB1cmwucHJvdG9jb2w7XG4gIGlmIChzY2hlbWUgPT09IFwiamF2YXNjcmlwdDpcIikgcmV0dXJuIGZhbHNlOyAvLyBleHBsaWNpdCwgYmVsdCBhbmQgYnJhY2VzXG4gIGlmIChzY2hlbWUgIT09IFwiaHR0cHM6XCIgJiYgc2NoZW1lICE9PSBcImh0dHA6XCIpIHJldHVybiBmYWxzZTtcbiAgaWYgKHNjaGVtZSA9PT0gXCJodHRwOlwiICYmICFwb2xpY3kuYWxsb3dfaHR0cCkgcmV0dXJuIGZhbHNlO1xuICBpZiAocG9saWN5LmFsbG93X2FsbCkgcmV0dXJuIHRydWU7XG5cbiAgY29uc3QgdXJsSG9zdCA9IHVybC5ob3N0bmFtZS50b0xvd2VyQ2FzZSgpO1xuICBjb25zdCB1cmxQb3J0ID0gdXJsLnBvcnQ7IC8vIFwiXCIgd2hlbiBkZWZhdWx0IGZvciB0aGUgc2NoZW1lXG4gIGZvciAoY29uc3QgcmF3IG9mIHBvbGljeS5hbGxvd2VkX2hvc3RzKSB7XG4gICAgY29uc3QgZW50cnkgPSByYXcudHJpbSgpO1xuICAgIGlmICghZW50cnkpIGNvbnRpbnVlO1xuICAgIGNvbnN0IHsgaG9zdCwgcG9ydCB9ID0gc3BsaXRIb3N0UG9ydChlbnRyeSk7XG4gICAgaWYgKCFob3N0TWF0Y2hlcyh1cmxIb3N0LCBob3N0LCBwb2xpY3kuaW5jbHVkZV93d3dfdmFyaWFudHMpKSBjb250aW51ZTtcbiAgICBpZiAocG9ydCA9PT0gbnVsbCkgcmV0dXJuIHRydWU7XG4gICAgY29uc3QgZWZmZWN0aXZlUG9ydCA9IHVybFBvcnQgfHwgKHNjaGVtZSA9PT0gXCJodHRwczpcIiA/IFwiNDQzXCIgOiBcIjgwXCIpO1xuICAgIGlmIChlZmZlY3RpdmVQb3J0ID09PSBwb3J0KSByZXR1cm4gdHJ1ZTtcbiAgfVxuICByZXR1cm4gZmFsc2U7XG59XG4iLCAiLy8gV2lkZ2V0IHJ1bnRpbWUgY29uZmlnIFx1MjAxNCB0aGUgc2hhcGUgc2VydmVkIGJ5IHRoZSBQVUJMSUMgY29uZmlnIGVuZHBvaW50XG4vLyAoYEdFVCB7b3JpZ2lufS9hcGkvd2lkZ2V0L3twdWJsaWNfaWR9L2NvbmZpZ2AsIHJ1bnRpbWUtc2FmZSBmaWVsZHMgb25seSlcbi8vIHBsdXMgZGVmYXVsdHMgYW5kIHRoZSBDU1MgY3VzdG9tLXByb3BlcnR5IHByb2plY3Rpb24uXG4vL1xuLy8gQmFja2VuZCB2YWxpZGF0aW9uIGlzIGF1dGhvcml0YXRpdmUgKHZvc29wdWxzZS1hcGkgd2lkZ2V0IHJvdXRlcyk7IHRoZVxuLy8gZGVmYXVsdHMgaGVyZSBvbmx5IGZpbGwgZ2FwcyBzbyBhIHBhcnRpYWwgY29uZmlnIHN0aWxsIHJlbmRlcnMuXG5cbmltcG9ydCB0eXBlIHsgTGlua1BvbGljeSB9IGZyb20gXCIuL2xpbmstcG9saWN5XCI7XG5pbXBvcnQgeyBERUZBVUxUX0xJTktfUE9MSUNZIH0gZnJvbSBcIi4vbGluay1wb2xpY3lcIjtcbmltcG9ydCB0eXBlIHsgV2lkZ2V0VGV4dEtleSB9IGZyb20gXCIuL3RleHQtZGVmYXVsdHNcIjtcblxuZXhwb3J0IHR5cGUgV2lkZ2V0VmFyaWFudCA9IFwidGlueVwiIHwgXCJjb21wYWN0XCIgfCBcImZ1bGxcIjtcbmV4cG9ydCB0eXBlIFdpZGdldFBsYWNlbWVudCA9XG4gIHwgXCJ0b3AtbGVmdFwiXG4gIHwgXCJ0b3BcIlxuICB8IFwidG9wLXJpZ2h0XCJcbiAgfCBcImJvdHRvbS1sZWZ0XCJcbiAgfCBcImJvdHRvbVwiXG4gIHwgXCJib3R0b20tcmlnaHRcIjtcbmV4cG9ydCB0eXBlIEV4cGFuZGVkQmVoYXZpb3IgPVxuICB8IFwic3RhcnRzX2NvbGxhcHNlZFwiXG4gIHwgXCJzdGFydHNfZXhwYW5kZWRcIlxuICB8IFwiYWx3YXlzX2V4cGFuZGVkXCI7XG5leHBvcnQgdHlwZSBTeW50YXhUaGVtZSA9IFwiYXV0b1wiIHwgXCJsaWdodFwiIHwgXCJkYXJrXCI7XG5cbmV4cG9ydCB0eXBlIFdpZGdldEF2YXRhciA9XG4gIHwgeyBraW5kOiBcIm9yYlwiOyBjb2xvcl8xOiBzdHJpbmc7IGNvbG9yXzI6IHN0cmluZyB9XG4gIHwgeyBraW5kOiBcInVybFwiOyB1cmw6IHN0cmluZyB9XG4gIHwgeyBraW5kOiBcImltYWdlXCI7IHVybDogc3RyaW5nIH07XG5cbmV4cG9ydCBpbnRlcmZhY2UgV2lkZ2V0Q29sb3JzIHtcbiAgYmFzZTogc3RyaW5nO1xuICBiYXNlX2hvdmVyOiBzdHJpbmc7XG4gIGJhc2VfYWN0aXZlOiBzdHJpbmc7XG4gIGJhc2VfYm9yZGVyOiBzdHJpbmc7XG4gIGJhc2Vfc3VidGxlOiBzdHJpbmc7XG4gIGJhc2VfcHJpbWFyeTogc3RyaW5nO1xuICBiYXNlX2Vycm9yOiBzdHJpbmc7XG4gIGFjY2VudDogc3RyaW5nO1xuICBhY2NlbnRfaG92ZXI6IHN0cmluZztcbiAgYWNjZW50X2FjdGl2ZTogc3RyaW5nO1xuICBhY2NlbnRfYm9yZGVyOiBzdHJpbmc7XG4gIGFjY2VudF9zdWJ0bGU6IHN0cmluZztcbiAgYWNjZW50X3ByaW1hcnk6IHN0cmluZztcbn1cblxuZXhwb3J0IGludGVyZmFjZSBXaWRnZXRSYWRpaSB7XG4gIG92ZXJsYXlfcGFkZGluZzogbnVtYmVyO1xuICBidXR0b25fcmFkaXVzOiBudW1iZXI7XG4gIGlucHV0X3JhZGl1czogbnVtYmVyO1xuICBidWJibGVfcmFkaXVzOiBudW1iZXI7XG4gIHNoZWV0X3JhZGl1czogbnVtYmVyO1xuICBjb21wYWN0X3NoZWV0X3JhZGl1czogbnVtYmVyO1xuICBkcm9wZG93bl9zaGVldF9yYWRpdXM6IG51bWJlcjtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBXaWRnZXRUZXJtcyB7XG4gIGVuYWJsZWQ6IGJvb2xlYW47XG4gIC8qKiBNYXJrZG93biBib2R5IHNob3duIGluIHRoZSBnYXRlLiAqL1xuICBjb250ZW50OiBzdHJpbmc7XG4gIC8qKiBXaGVuIG5vbi1lbXB0eSwgYWNjZXB0aW5nIHN0b3JlcyB0aGlzIGxvY2FsU3RvcmFnZSBrZXkgYW5kIGZ1dHVyZVxuICAgKiAgdmlzaXRzIHNraXAgdGhlIHByb21wdC4gKi9cbiAgbG9jYWxfc3RvcmFnZV9rZXk6IHN0cmluZztcbn1cblxuZXhwb3J0IGludGVyZmFjZSBXaWRnZXRGZWF0dXJlVG9nZ2xlcyB7XG4gIC8qKiBTdG9yYWdlIGZvcm0gb2YgdGhlIHNpbmdsZSBcIkNoYXQgKHRleHQtb25seSkgbW9kZVwiIHRvZ2dsZTpcbiAgICogIGB2b2ljZV9lbmFibGVkID0gIXRleHRfb25seWAuIFRleHQtb25seSBPRkYgKGRlZmF1bHQpID0gdm9pY2UgQU5EXG4gICAqICBjaGF0IGJvdGggYXZhaWxhYmxlOyBPTiA9IGNoYXQgb25seS4gKi9cbiAgdm9pY2VfZW5hYmxlZDogYm9vbGVhbjtcbiAgLyoqIExFR0FDWSBcdTIwMTQgYWNjZXB0ZWQgZnJvbSBzdG9yZWQgY29uZmlncyBidXQgZm9yY2VkIGB0cnVlYCBieVxuICAgKiAgYG1lcmdlQ29uZmlnYDogY2hhdCBpcyBhbHdheXMgYXZhaWxhYmxlIChubyBjaGF0LW9mZiBtb2RlIGluIHRoZVxuICAgKiAgc2luZ2xlLXRvZ2dsZSBtb2RlbCkuICovXG4gIHRleHRfZW5hYmxlZDogYm9vbGVhbjtcbiAgLyoqIFNob3cgdGhlIGNvbXBvc2VyIGR1cmluZyBhIGxpdmUgY2FsbDsgdHlwZWQgdGV4dCBiZWNvbWVzIGEgcmVhbFxuICAgKiAgdXNlciB0dXJuIChSVFZJIHNlbmQtdGV4dCkuICovXG4gIHNlbmRfdGV4dF93aGlsZV9vbl9jYWxsOiBib29sZWFuO1xuICB0cmFuc2NyaXB0X2VuYWJsZWQ6IGJvb2xlYW47XG4gIGxhbmd1YWdlX2Ryb3Bkb3duX2VuYWJsZWQ6IGJvb2xlYW47XG4gIG11dGVfYnV0dG9uX2VuYWJsZWQ6IGJvb2xlYW47XG4gIHNob3dfY29udmVyc2F0aW9uX2lkOiBib29sZWFuO1xuICBoaWRlX2F1ZGlvX3RhZ3M6IGJvb2xlYW47XG4gIGFjdGlvbl9pbmRpY2F0b3JfZW5hYmxlZDogYm9vbGVhbjtcbiAgcmVzaXplX2J1dHRvbl9lbmFibGVkOiBib29sZWFuO1xuICBmZWVkYmFja19lbmFibGVkOiBib29sZWFuO1xuICAvKiogRWxlbWVudC1vbmx5IGRpc3BsYXkgZmxhZ3MgKEU0IFE5KSBcdTIwMTQgc2V0IGJ5IHRoZSBgc2hvdy0qYCBhdHRyaWJ1dGVzLFxuICAgKiAgbmV2ZXIgYnkgdGhlIHNlcnZlciBjb25maWc7IHRoZSBkZWZhdWx0cyBhcmUgdG9kYXkncyByZW5kZXJpbmcuICovXG4gIHNob3dfYWdlbnRfc3RhdHVzOiBib29sZWFuO1xuICBzaG93X2xhbmd1YWdlX3NlbGVjdG9yX29uX3RyaWdnZXI6IGJvb2xlYW47XG4gIHNob3dfYXZhdGFyX3doZW5fY29sbGFwc2VkOiBib29sZWFuO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFdpZGdldFJ1bnRpbWVDb25maWcgZXh0ZW5kcyBXaWRnZXRGZWF0dXJlVG9nZ2xlcyB7XG4gIGFnZW50X25hbWU6IHN0cmluZztcbiAgdmFyaWFudDogV2lkZ2V0VmFyaWFudDtcbiAgcGxhY2VtZW50OiBXaWRnZXRQbGFjZW1lbnQ7XG4gIGV4cGFuZGVkX2JlaGF2aW9yOiBFeHBhbmRlZEJlaGF2aW9yO1xuICBjb2xsYXBzaWJsZTogYm9vbGVhbjtcbiAgc3ludGF4X3RoZW1lOiBTeW50YXhUaGVtZTtcbiAgYXZhdGFyOiBXaWRnZXRBdmF0YXI7XG4gIGNvbG9yczogV2lkZ2V0Q29sb3JzO1xuICByYWRpaTogV2lkZ2V0UmFkaWk7XG4gIHRlcm1zOiBXaWRnZXRUZXJtcztcbiAgbGlua19wb2xpY3k6IExpbmtQb2xpY3k7XG4gIC8qKiBCQ1AtNDctaXNoIGxhbmd1YWdlIGNvZGVzIHRoZSBhZ2VudCBzdXBwb3J0czsgZmlyc3QgZW50cnkgaXMgZGVmYXVsdC4gKi9cbiAgbGFuZ3VhZ2VzOiBzdHJpbmdbXTtcbiAgdGV4dDogUGFydGlhbDxSZWNvcmQ8V2lkZ2V0VGV4dEtleSwgc3RyaW5nPj47XG59XG5cbmV4cG9ydCBjb25zdCBERUZBVUxUX0NPTE9SUzogV2lkZ2V0Q29sb3JzID0ge1xuICBiYXNlOiBcIiNmZmZmZmZcIixcbiAgYmFzZV9ob3ZlcjogXCIjZjlmYWZiXCIsXG4gIGJhc2VfYWN0aXZlOiBcIiNmM2Y0ZjZcIixcbiAgYmFzZV9ib3JkZXI6IFwiI2U1ZTdlYlwiLFxuICBiYXNlX3N1YnRsZTogXCIjNmI3MjgwXCIsXG4gIGJhc2VfcHJpbWFyeTogXCIjMDAwMDAwXCIsXG4gIGJhc2VfZXJyb3I6IFwiI2VmNDQ0NFwiLFxuICBhY2NlbnQ6IFwiIzAwMDAwMFwiLFxuICBhY2NlbnRfaG92ZXI6IFwiIzFmMjkzN1wiLFxuICBhY2NlbnRfYWN0aXZlOiBcIiMzNzQxNTFcIixcbiAgYWNjZW50X2JvcmRlcjogXCIjNGI1NTYzXCIsXG4gIGFjY2VudF9zdWJ0bGU6IFwiIzZiNzI4MFwiLFxuICBhY2NlbnRfcHJpbWFyeTogXCIjZmZmZmZmXCIsXG59O1xuXG5leHBvcnQgY29uc3QgREVGQVVMVF9SQURJSTogV2lkZ2V0UmFkaWkgPSB7XG4gIG92ZXJsYXlfcGFkZGluZzogMzIsXG4gIGJ1dHRvbl9yYWRpdXM6IDE4LFxuICBpbnB1dF9yYWRpdXM6IDE4LFxuICBidWJibGVfcmFkaXVzOiAxNSxcbiAgc2hlZXRfcmFkaXVzOiAyNCxcbiAgY29tcGFjdF9zaGVldF9yYWRpdXM6IDMwLFxuICBkcm9wZG93bl9zaGVldF9yYWRpdXM6IDI0LFxufTtcblxuZXhwb3J0IGNvbnN0IERFRkFVTFRfQ09ORklHOiBXaWRnZXRSdW50aW1lQ29uZmlnID0ge1xuICBhZ2VudF9uYW1lOiBcIkFJIEFnZW50XCIsXG4gIHZhcmlhbnQ6IFwiY29tcGFjdFwiLFxuICBwbGFjZW1lbnQ6IFwiYm90dG9tLXJpZ2h0XCIsXG4gIGV4cGFuZGVkX2JlaGF2aW9yOiBcInN0YXJ0c19jb2xsYXBzZWRcIixcbiAgY29sbGFwc2libGU6IHRydWUsXG4gIHN5bnRheF90aGVtZTogXCJhdXRvXCIsXG4gIGF2YXRhcjogeyBraW5kOiBcIm9yYlwiLCBjb2xvcl8xOiBcIiM3OTU5ZmZcIiwgY29sb3JfMjogXCIjOWI3YWZmXCIgfSxcbiAgY29sb3JzOiBERUZBVUxUX0NPTE9SUyxcbiAgcmFkaWk6IERFRkFVTFRfUkFESUksXG4gIHRlcm1zOiB7IGVuYWJsZWQ6IGZhbHNlLCBjb250ZW50OiBcIlwiLCBsb2NhbF9zdG9yYWdlX2tleTogXCJcIiB9LFxuICBsaW5rX3BvbGljeTogREVGQVVMVF9MSU5LX1BPTElDWSxcbiAgbGFuZ3VhZ2VzOiBbXSxcbiAgdGV4dDoge30sXG4gIHZvaWNlX2VuYWJsZWQ6IHRydWUsXG4gIHRleHRfZW5hYmxlZDogdHJ1ZSxcbiAgc2VuZF90ZXh0X3doaWxlX29uX2NhbGw6IHRydWUsXG4gIHRyYW5zY3JpcHRfZW5hYmxlZDogdHJ1ZSxcbiAgbGFuZ3VhZ2VfZHJvcGRvd25fZW5hYmxlZDogdHJ1ZSxcbiAgbXV0ZV9idXR0b25fZW5hYmxlZDogdHJ1ZSxcbiAgc2hvd19jb252ZXJzYXRpb25faWQ6IHRydWUsXG4gIGhpZGVfYXVkaW9fdGFnczogZmFsc2UsXG4gIGFjdGlvbl9pbmRpY2F0b3JfZW5hYmxlZDogdHJ1ZSxcbiAgcmVzaXplX2J1dHRvbl9lbmFibGVkOiB0cnVlLFxuICBmZWVkYmFja19lbmFibGVkOiB0cnVlLFxuICBzaG93X2FnZW50X3N0YXR1czogdHJ1ZSxcbiAgc2hvd19sYW5ndWFnZV9zZWxlY3Rvcl9vbl90cmlnZ2VyOiBmYWxzZSxcbiAgc2hvd19hdmF0YXJfd2hlbl9jb2xsYXBzZWQ6IHRydWUsXG59O1xuXG4vKiogRGVlcC1tZXJnZSBhIHNlcnZlciBjb25maWcgb3ZlciB0aGUgZGVmYXVsdHMgKGFycmF5cy9vYmplY3RzIHJlcGxhY2VkLFxuICogIG5lc3RlZCBrbm93biBvYmplY3RzIG1lcmdlZCBrZXktd2lzZSkuIFRvbGVyYXRlcyBtaXNzaW5nIGZpZWxkcy5cbiAqXG4gKiAgU2luZ2xlLXRvZ2dsZSBzZW1hbnRpY3M6IGNoYXQgaXMgQUxXQVlTIGF2YWlsYWJsZSAoYHRleHRfZW5hYmxlZGAgaXNcbiAqICBmb3JjZWQgYHRydWVgLCB3aGF0ZXZlciBhIHN0b3JlZCBjb25maWcgY2FycmllcyksIGFuZCB2b2ljZVxuICogIGF2YWlsYWJpbGl0eSBpcyBleGFjdGx5IGB2b2ljZV9lbmFibGVkYCAoPSAhdGV4dC1vbmx5KS4gQSBsZWdhY3lcbiAqICBjb25maWcgdGhhdCBleHBsaWNpdGx5IGRpc2FibGVkIHZvaWNlIHRoZXJlZm9yZSBiZWhhdmVzIGFzXG4gKiAgdGV4dC1vbmx5IE9OLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG1lcmdlQ29uZmlnKFxuICBwYXJ0aWFsOiBQYXJ0aWFsPFdpZGdldFJ1bnRpbWVDb25maWc+IHwgdW5kZWZpbmVkLFxuKTogV2lkZ2V0UnVudGltZUNvbmZpZyB7XG4gIGlmICghcGFydGlhbCkgcmV0dXJuIERFRkFVTFRfQ09ORklHO1xuICByZXR1cm4ge1xuICAgIC4uLkRFRkFVTFRfQ09ORklHLFxuICAgIC4uLnBhcnRpYWwsXG4gICAgdGV4dF9lbmFibGVkOiB0cnVlLFxuICAgIGF2YXRhcjogcGFydGlhbC5hdmF0YXIgPz8gREVGQVVMVF9DT05GSUcuYXZhdGFyLFxuICAgIGNvbG9yczogeyAuLi5ERUZBVUxUX0NPTE9SUywgLi4uKHBhcnRpYWwuY29sb3JzID8/IHt9KSB9LFxuICAgIHJhZGlpOiB7IC4uLkRFRkFVTFRfUkFESUksIC4uLihwYXJ0aWFsLnJhZGlpID8/IHt9KSB9LFxuICAgIHRlcm1zOiB7IC4uLkRFRkFVTFRfQ09ORklHLnRlcm1zLCAuLi4ocGFydGlhbC50ZXJtcyA/PyB7fSkgfSxcbiAgICBsaW5rX3BvbGljeTogeyAuLi5ERUZBVUxUX0xJTktfUE9MSUNZLCAuLi4ocGFydGlhbC5saW5rX3BvbGljeSA/PyB7fSkgfSxcbiAgICBsYW5ndWFnZXM6IHBhcnRpYWwubGFuZ3VhZ2VzID8/IFtdLFxuICAgIHRleHQ6IHBhcnRpYWwudGV4dCA/PyB7fSxcbiAgfTtcbn1cblxuLyoqXG4gKiBQcm9qZWN0IGNvbmZpZyBvbnRvIHRoZSBzaGFkb3ctcm9vdCBDU1MgY3VzdG9tIHByb3BlcnRpZXMuXG4gKiBFdmVyeSB2aXN1YWwga25vYiB0aGUgd2lkZ2V0IHVzZXMgZmxvd3MgdGhyb3VnaCB0aGVzZSB2YXJpYWJsZXMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBidWlsZENzc1ZhcnMoY2ZnOiBXaWRnZXRSdW50aW1lQ29uZmlnKTogUmVjb3JkPHN0cmluZywgc3RyaW5nPiB7XG4gIGNvbnN0IGMgPSBjZmcuY29sb3JzO1xuICBjb25zdCByID0gY2ZnLnJhZGlpO1xuICByZXR1cm4ge1xuICAgIFwiLS12dy1iYXNlXCI6IGMuYmFzZSxcbiAgICBcIi0tdnctYmFzZS1ob3ZlclwiOiBjLmJhc2VfaG92ZXIsXG4gICAgXCItLXZ3LWJhc2UtYWN0aXZlXCI6IGMuYmFzZV9hY3RpdmUsXG4gICAgXCItLXZ3LWJhc2UtYm9yZGVyXCI6IGMuYmFzZV9ib3JkZXIsXG4gICAgXCItLXZ3LWJhc2Utc3VidGxlXCI6IGMuYmFzZV9zdWJ0bGUsXG4gICAgXCItLXZ3LWJhc2UtcHJpbWFyeVwiOiBjLmJhc2VfcHJpbWFyeSxcbiAgICBcIi0tdnctYmFzZS1lcnJvclwiOiBjLmJhc2VfZXJyb3IsXG4gICAgXCItLXZ3LWFjY2VudFwiOiBjLmFjY2VudCxcbiAgICBcIi0tdnctYWNjZW50LWhvdmVyXCI6IGMuYWNjZW50X2hvdmVyLFxuICAgIFwiLS12dy1hY2NlbnQtYWN0aXZlXCI6IGMuYWNjZW50X2FjdGl2ZSxcbiAgICBcIi0tdnctYWNjZW50LWJvcmRlclwiOiBjLmFjY2VudF9ib3JkZXIsXG4gICAgXCItLXZ3LWFjY2VudC1zdWJ0bGVcIjogYy5hY2NlbnRfc3VidGxlLFxuICAgIFwiLS12dy1hY2NlbnQtcHJpbWFyeVwiOiBjLmFjY2VudF9wcmltYXJ5LFxuICAgIFwiLS12dy1vdmVybGF5LXBhZGRpbmdcIjogYCR7ci5vdmVybGF5X3BhZGRpbmd9cHhgLFxuICAgIFwiLS12dy1idXR0b24tcmFkaXVzXCI6IGAke3IuYnV0dG9uX3JhZGl1c31weGAsXG4gICAgXCItLXZ3LWlucHV0LXJhZGl1c1wiOiBgJHtyLmlucHV0X3JhZGl1c31weGAsXG4gICAgXCItLXZ3LWJ1YmJsZS1yYWRpdXNcIjogYCR7ci5idWJibGVfcmFkaXVzfXB4YCxcbiAgICBcIi0tdnctc2hlZXQtcmFkaXVzXCI6IGAke3Iuc2hlZXRfcmFkaXVzfXB4YCxcbiAgICBcIi0tdnctY29tcGFjdC1zaGVldC1yYWRpdXNcIjogYCR7ci5jb21wYWN0X3NoZWV0X3JhZGl1c31weGAsXG4gICAgXCItLXZ3LWRyb3Bkb3duLXNoZWV0LXJhZGl1c1wiOiBgJHtyLmRyb3Bkb3duX3NoZWV0X3JhZGl1c31weGAsXG4gIH07XG59XG4iLCAiLy8gQ2Fub25pY2FsIHdpZGdldCB0ZXh0IGtleXMgKyBFbmdsaXNoIGRlZmF1bHRzLlxuLy9cbi8vIFNJTkdMRSBTT1VSQ0UgT0YgVFJVVEggZm9yIHRoZSBvdmVycmlkYWJsZSBVSSBzdHJpbmdzLiBUaHJlZSBjb25zdW1lcnM6XG4vLyAgIDEuIHRoZSB3aWRnZXQgcnVudGltZSAodGhpcyBwYWNrYWdlKSBcdTIwMTQgZmFsbHMgYmFjayB0byB0aGVzZSBkZWZhdWx0cyxcbi8vICAgMi4gdGhlIGRhc2hib2FyZCBzZXR0aW5ncyBVSSAoZnJvbnRlbmQvc3JjLy4uLi93aWRnZXQgdGFiKSBcdTIwMTQgaW1wb3J0cyB0aGlzXG4vLyAgICAgIGZpbGUgZGlyZWN0bHkgYW5kIHJlbmRlcnMgdGhlIGRlZmF1bHRzIGFzIHBsYWNlaG9sZGVycyxcbi8vICAgMy4gYmFja2VuZCB2YWxpZGF0aW9uIFx1MjAxNCB2b3NvcHVsc2UvYmluL3Zvc29wdWxzZS1hcGkvc3JjL3JvdXRlcy93aWRnZXQucnNcbi8vICAgICAgbWlycm9ycyB0aGUgS0VZIFNFVCBhcyBgV0lER0VUX1RFWFRfS0VZU2A7IGEgdW5pdCB0ZXN0IHRoZXJlIHBpbnMgdGhlXG4vLyAgICAgIGNvdW50LiBDaGFuZ2luZyBrZXlzIGhlcmUgcmVxdWlyZXMgY2hhbmdpbmcgdGhlIFJ1c3QgbGlzdCBpbiB0aGUgc2FtZVxuLy8gICAgICBjaGFuZ2Utc2V0LlxuLy9cbi8vIEtleXMgYW5kIGRlZmF1bHRzIG1pcnJvciB0aGUgdmVuZG9yIGNvbnZhaSB3aWRnZXQncyB0ZXh0X2NvbnRlbnRzIG1hcC5cblxuZXhwb3J0IGNvbnN0IFdJREdFVF9URVhUX0RFRkFVTFRTID0ge1xuICBtYWluX2xhYmVsOiBcIk5lZWQgaGVscD9cIixcbiAgc3RhcnRfY2FsbDogXCJTdGFydCBhIGNhbGxcIixcbiAgc3RhcnRfY2hhdDogXCJTdGFydCBhIGNoYXRcIixcbiAgbmV3X2NhbGw6IFwiTmV3IGNhbGxcIixcbiAgZW5kX2NhbGw6IFwiRW5kXCIsXG4gIG11dGVfbWljcm9waG9uZTogXCJNdXRlIG1pY3JvcGhvbmVcIixcbiAgY2hhbmdlX2xhbmd1YWdlOiBcIkNoYW5nZSBsYW5ndWFnZVwiLFxuICBjb2xsYXBzZTogXCJDb2xsYXBzZVwiLFxuICBleHBhbmQ6IFwiRXhwYW5kXCIsXG4gIGNvcGllZDogXCJDb3BpZWQhXCIsXG4gIGFjY2VwdF90ZXJtczogXCJBY2NlcHRcIixcbiAgZGlzbWlzc190ZXJtczogXCJDYW5jZWxcIixcbiAgbGlzdGVuaW5nX3N0YXR1czogXCJMaXN0ZW5pbmdcIixcbiAgc3BlYWtpbmdfc3RhdHVzOiBcIlRhbGsgdG8gaW50ZXJydXB0XCIsXG4gIGNvbm5lY3Rpbmdfc3RhdHVzOiBcIkNvbm5lY3RpbmdcIixcbiAgY2hhdHRpbmdfc3RhdHVzOiBcIkNoYXR0aW5nIHdpdGggQUkgQWdlbnRcIixcbiAgaW5wdXRfbGFiZWw6IFwiVGV4dCBtZXNzYWdlIGlucHV0XCIsXG4gIGlucHV0X3BsYWNlaG9sZGVyOiBcIlNlbmQgYSBtZXNzYWdlXCIsXG4gIGlucHV0X3BsYWNlaG9sZGVyX3RleHRfb25seTogXCJTZW5kIGEgbWVzc2FnZVwiLFxuICBpbnB1dF9wbGFjZWhvbGRlcl9uZXdfY29udmVyc2F0aW9uOiBcIlN0YXJ0IGEgbmV3IGNvbnZlcnNhdGlvblwiLFxuICB1c2VyX2VuZGVkX2NvbnZlcnNhdGlvbjogXCJZb3UgZW5kZWQgdGhlIGNvbnZlcnNhdGlvblwiLFxuICBhZ2VudF9lbmRlZF9jb252ZXJzYXRpb246IFwiVGhlIGFnZW50IGVuZGVkIHRoZSBjb252ZXJzYXRpb25cIixcbiAgY29udmVyc2F0aW9uX2lkOiBcIkNvbnZlcnNhdGlvbiBJRFwiLFxuICBlcnJvcl9vY2N1cnJlZDogXCJBbiBlcnJvciBvY2N1cnJlZFwiLFxuICBjb3B5X2lkOiBcIkNvcHkgSURcIixcbiAgaW5pdGlhdGVfZmVlZGJhY2s6IFwiSG93IHdhcyB0aGlzIGNvbnZlcnNhdGlvbj9cIixcbiAgcmVxdWVzdF9mb2xsb3dfdXBfZmVlZGJhY2s6IFwiVGVsbCB1cyBtb3JlXCIsXG4gIHRoYW5rc19mb3JfZmVlZGJhY2s6IFwiVGhhbmsgeW91IGZvciB5b3VyIGZlZWRiYWNrIVwiLFxuICB0aGFua3NfZm9yX2ZlZWRiYWNrX2RldGFpbHM6XG4gICAgXCJZb3VyIGZlZWRiYWNrIGhlbHBzIHVzIGltcHJvdmUgb3VyIHNlcnZpY2UgYW5kIGJldHRlciBhc3Npc3QgeW91LlwiLFxuICBmb2xsb3dfdXBfZmVlZGJhY2tfcGxhY2Vob2xkZXI6IFwiVGVsbCB1cyBtb3JlIGFib3V0IHlvdXIgZXhwZXJpZW5jZS4uLlwiLFxuICBzdWJtaXQ6IFwiU3VibWl0XCIsXG4gIGdvX2JhY2s6IFwiR28gYmFja1wiLFxuICBzZW5kX21lc3NhZ2U6IFwiU2VuZFwiLFxuICB0ZXh0X21vZGU6IFwiU3dpdGNoIHRvIHRleHQgbW9kZVwiLFxuICB2b2ljZV9tb2RlOiBcIlN3aXRjaCB0byB2b2ljZSBtb2RlXCIsXG4gIHN3aXRjaGVkX3RvX3RleHRfbW9kZTogXCJTd2l0Y2hlZCB0byB0ZXh0IG1vZGVcIixcbiAgc3dpdGNoZWRfdG9fdm9pY2VfbW9kZTogXCJTd2l0Y2hlZCB0byB2b2ljZSBtb2RlXCIsXG4gIGNvcHk6IFwiQ29weVwiLFxuICBkb3dubG9hZDogXCJEb3dubG9hZFwiLFxuICB3cmFwOiBcIldyYXBcIixcbiAgYWdlbnRfd29ya2luZzogXCJXb3JraW5nLi4uXCIsXG4gIGFnZW50X2RvbmU6IFwiQ29tcGxldGVkXCIsXG4gIGFnZW50X2Vycm9yOiBcIkVycm9yIG9jY3VycmVkXCIsXG4gIGF0dGFjaF9maWxlOiBcIkF0dGFjaCBmaWxlXCIsXG4gIHJlbW92ZV9maWxlOiBcIlJlbW92ZSBmaWxlXCIsXG4gIGZpbGVfdXBsb2FkX2Vycm9yOiBcIkZhaWxlZCB0byB1cGxvYWQgZmlsZS5cIixcbiAgZmlsZV90eXBlX3Vuc3VwcG9ydGVkOiBcIlVuc3VwcG9ydGVkIGZpbGUgdHlwZS4gQWNjZXB0ZWQgdHlwZXM6XCIsXG4gIGZpbGVfdG9vX2xhcmdlOiBcIkZpbGUgc2l6ZSBleGNlZWRzIHRoZSBtYXhpbXVtIGxpbWl0LlwiLFxuICBmaWxlX2xpbWl0X3JlYWNoZWQ6IFwiTWF4aW11bSBudW1iZXIgb2YgZmlsZXMgZm9yIHRoaXMgY29udmVyc2F0aW9uIHJlYWNoZWQuXCIsXG4gIHR5cGluZ19pbmRpY2F0b3I6IFwiQWdlbnQgaXMgdHlwaW5nIC4uLlwiLFxuICAvLyBBZ2VudC1pbnRlZ3JhdGlvbiBFNyBcdTAwQTc0LjMgKFZPU08tNzYwKTogdGhlIGNhbGxlciB3YWl0cyBpbiB0aGUgYWdlbnQnc1xuICAvLyBxdWV1ZSAodmVuZG9yIHdpZGdldCBcdTIyNjUgMC4xNy4wIHNob3dzIGEgd2FpdGluZyBsaW5lIGFuZCBkaXNhYmxlcyBpbnB1dCkuXG4gIHF1ZXVlZF9zdGF0dXM6IFwiV2FpdGluZyBmb3IgYW4gYXZhaWxhYmxlIGFnZW50XHUyMDI2XCIsXG4gIHF1ZXVlX3RpbWVkX291dDogXCJObyBhZ2VudCBiZWNhbWUgYXZhaWxhYmxlIFx1MjAxNCBwbGVhc2UgdHJ5IGFnYWluIGxhdGVyXCIsXG59IGFzIGNvbnN0O1xuXG5leHBvcnQgdHlwZSBXaWRnZXRUZXh0S2V5ID0ga2V5b2YgdHlwZW9mIFdJREdFVF9URVhUX0RFRkFVTFRTO1xuXG5leHBvcnQgY29uc3QgV0lER0VUX1RFWFRfS0VZUyA9IE9iamVjdC5rZXlzKFxuICBXSURHRVRfVEVYVF9ERUZBVUxUUyxcbikgYXMgV2lkZ2V0VGV4dEtleVtdO1xuXG4vKiogUmVzb2x2ZSBhIHRleHQga2V5IGFnYWluc3QgcGVyLWFnZW50IG92ZXJyaWRlcywgZmFsbGluZyBiYWNrIHRvIGRlZmF1bHRzLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVUZXh0KFxuICBvdmVycmlkZXM6IFBhcnRpYWw8UmVjb3JkPFdpZGdldFRleHRLZXksIHN0cmluZz4+IHwgdW5kZWZpbmVkLFxuICBrZXk6IFdpZGdldFRleHRLZXksXG4pOiBzdHJpbmcge1xuICBjb25zdCB2ID0gb3ZlcnJpZGVzPy5ba2V5XTtcbiAgcmV0dXJuIHYgIT09IHVuZGVmaW5lZCAmJiB2ICE9PSBcIlwiID8gdiA6IFdJREdFVF9URVhUX0RFRkFVTFRTW2tleV07XG59XG4iLCAiLy8gVGhlIHZlbmRvcidzIGVsZW1lbnQgYXR0cmlidXRlcywgbWFwcGVkIG9udG8gb3VycyAoRTQgcGxhbiBcdTAwQTc0LjgsIG93bmVyXG4vLyBydWxpbmdzIFE5IC8gUTI1KS4gUHVyZSBmdW5jdGlvbnMgb3ZlciBhbiBhdHRyaWJ1dGUgcmVhZGVyIHNvIGV2ZXJ5IHJ1bGUgaXNcbi8vIHVuaXQtdGVzdGVkIHdpdGhvdXQgYSBET00uIEV2ZXJ5dGhpbmcgaGVyZSBpcyBBRERJVElWRTogYW4gZWxlbWVudCB3aXRob3V0XG4vLyB0aGVzZSBhdHRyaWJ1dGVzIHJlbmRlcnMgZXhhY3RseSBhcyBiZWZvcmUgKHRoZSBkZWZhdWx0cyBBUkUgdG9kYXknc1xuLy8gcmVuZGVyaW5nKSwgYW5kIGFuIGV4cGxpY2l0IGBvdmVycmlkZXNgIGF0dHJpYnV0ZSAvIHByb3BlcnR5IHdpbnMgb3ZlciB0aGVcbi8vIHBlci1rZXkgYG92ZXJyaWRlLSpgIGF0dHJpYnV0ZXMuXG5pbXBvcnQgdHlwZSB7IFdpZGdldFBsYWNlbWVudCwgV2lkZ2V0UnVudGltZUNvbmZpZywgV2lkZ2V0VmFyaWFudCB9IGZyb20gXCIuL2NvbmZpZ1wiO1xuaW1wb3J0IHsgV0lER0VUX1RFWFRfS0VZUywgdHlwZSBXaWRnZXRUZXh0S2V5IH0gZnJvbSBcIi4vdGV4dC1kZWZhdWx0c1wiO1xuXG5leHBvcnQgdHlwZSBBdHRyaWJ1dGVSZWFkZXIgPSAobmFtZTogc3RyaW5nKSA9PiBzdHJpbmcgfCBudWxsO1xuZXhwb3J0IHR5cGUgRGVidWdTaW5rID0gKGV2ZW50OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikgPT4gdm9pZDtcblxuLyoqIGBcInRydWVcImAgLyBgXCJmYWxzZVwiYCBcdTIxOTIgYm9vbGVhbjsgYW55dGhpbmcgZWxzZSAoYWJzZW50IGluY2x1ZGVkKSBcdTIxOTIgdW5kZWZpbmVkLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlQm9vbCh2YWx1ZTogc3RyaW5nIHwgbnVsbCk6IGJvb2xlYW4gfCB1bmRlZmluZWQge1xuICBpZiAodmFsdWUgPT09IFwidHJ1ZVwiKSByZXR1cm4gdHJ1ZTtcbiAgaWYgKHZhbHVlID09PSBcImZhbHNlXCIpIHJldHVybiBmYWxzZTtcbiAgcmV0dXJuIHVuZGVmaW5lZDtcbn1cblxuLyoqXG4gKiBROSBcdTIwMTQgdGhlIGZvdXIgZGlzcGxheSBhdHRyaWJ1dGVzIFx1MjE5MiB0aGUgcnVudGltZSBjb25maWcga2V5IGVhY2ggb3ZlcmxheXNcbiAqIGFmdGVyIGBtZXJnZUNvbmZpZygpYC4gRGVmYXVsdHMga2VlcCB0b2RheSdzIHJlbmRlcmluZzogdGhlIHN0YXR1cyBsaW5lIGFuZFxuICogdGhlIGNvbGxhcHNlZCBhdmF0YXIgYXJlIHNob3duLCB0aGUgcmVzaXplIGJ1dHRvbiBmb2xsb3dzIHRoZSBzZXJ2ZXIgY29uZmlnLFxuICogbm8gbGFuZ3VhZ2Ugc2VsZWN0b3Igb24gdGhlIGNvbGxhcHNlZCB0cmlnZ2VyLlxuICovXG5leHBvcnQgY29uc3QgRElTUExBWV9BVFRSSUJVVEVTID0gW1xuICBbXCJzaG93LWFnZW50LXN0YXR1c1wiLCBcInNob3dfYWdlbnRfc3RhdHVzXCJdLFxuICBbXCJzaG93LXJlc2l6ZS1idXR0b25cIiwgXCJyZXNpemVfYnV0dG9uX2VuYWJsZWRcIl0sXG4gIFtcInNob3ctbGFuZ3VhZ2Utc2VsZWN0b3Itb24tdHJpZ2dlclwiLCBcInNob3dfbGFuZ3VhZ2Vfc2VsZWN0b3Jfb25fdHJpZ2dlclwiXSxcbiAgW1wic2hvdy1hdmF0YXItd2hlbi1jb2xsYXBzZWRcIiwgXCJzaG93X2F2YXRhcl93aGVuX2NvbGxhcHNlZFwiXSxcbl0gYXMgY29uc3Qgc2F0aXNmaWVzIFJlYWRvbmx5QXJyYXk8cmVhZG9ubHkgW3N0cmluZywga2V5b2YgV2lkZ2V0UnVudGltZUNvbmZpZ10+O1xuXG5jb25zdCBWQVJJQU5UUzogcmVhZG9ubHkgV2lkZ2V0VmFyaWFudFtdID0gW1widGlueVwiLCBcImNvbXBhY3RcIiwgXCJmdWxsXCJdO1xuY29uc3QgUExBQ0VNRU5UUzogcmVhZG9ubHkgV2lkZ2V0UGxhY2VtZW50W10gPSBbXG4gIFwidG9wLWxlZnRcIixcbiAgXCJ0b3BcIixcbiAgXCJ0b3AtcmlnaHRcIixcbiAgXCJib3R0b20tbGVmdFwiLFxuICBcImJvdHRvbVwiLFxuICBcImJvdHRvbS1yaWdodFwiLFxuXTtcblxuLyoqXG4gKiBRMjUgXHUyMDE0IHRoZSB2ZW5kb3IncyBgdGV4dC1jb250ZW50c2Aga2V5cyB0aGF0IGRpZmZlciBmcm9tIG91cnMuIEV2ZXJ5IGtleSBvZlxuICogb3VycyB0aGF0IHRoZSB2ZW5kb3Igc2hhcmVzIChXSURHRVRfVEVYVF9LRVlTIHdlcmUgY29waWVkIGZyb20gdGhlIHZlbmRvcidzXG4gKiBtYXAsIHRleHQtZGVmYXVsdHMudHMpIG1hcHMgdG8gaXRzZWxmOyB0aGVzZSBhcmUgdGhlIHJlbmFtZXMuIEtleXMgaW5cbiAqIG5laXRoZXIgc2V0ICh0aGUgdmVuZG9yJ3MgZmlsZS1pbnB1dCAvIHJpY2gtY29udGVudCAvIHNob3J0IHF1ZXVlIGNvcHkpIGFyZVxuICogcmVwb3J0ZWQgdGhyb3VnaCB0aGUgZGVidWcgc2luayBhbmQgaWdub3JlZC5cbiAqL1xuZXhwb3J0IGNvbnN0IFZFTkRPUl9URVhUX1JFTkFNRVM6IFJlYWRvbmx5PFJlY29yZDxzdHJpbmcsIFdpZGdldFRleHRLZXk+PiA9IHtcbiAgcXVldWVfd2FpdGluZ19zdGF0dXM6IFwicXVldWVkX3N0YXR1c1wiLFxufTtcblxuY29uc3QgT1VSX1RFWFRfS0VZUzogUmVhZG9ubHlTZXQ8c3RyaW5nPiA9IG5ldyBTZXQoV0lER0VUX1RFWFRfS0VZUyk7XG5cbi8qKiBBIGB0ZXh0LWNvbnRlbnRzYCBKU09OIG9iamVjdCAodmVuZG9yIG9yIG91ciBrZXkgbmFtZXMpIFx1MjE5MiBvdXIgdGV4dCBvdmVycmlkZXMuICovXG5leHBvcnQgZnVuY3Rpb24gbWFwVGV4dENvbnRlbnRzKHJhdzogc3RyaW5nIHwgbnVsbCwgZGVidWc6IERlYnVnU2luayk6IFBhcnRpYWw8UmVjb3JkPFdpZGdldFRleHRLZXksIHN0cmluZz4+IHtcbiAgaWYgKCFyYXcpIHJldHVybiB7fTtcbiAgbGV0IHBhcnNlZDogdW5rbm93bjtcbiAgdHJ5IHtcbiAgICBwYXJzZWQgPSBKU09OLnBhcnNlKHJhdyk7XG4gIH0gY2F0Y2gge1xuICAgIGRlYnVnKHsgdHlwZTogXCJpbnZhbGlkX3RleHRfY29udGVudHNcIiB9KTtcbiAgICByZXR1cm4ge307XG4gIH1cbiAgaWYgKCFwYXJzZWQgfHwgdHlwZW9mIHBhcnNlZCAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KHBhcnNlZCkpIHtcbiAgICBkZWJ1Zyh7IHR5cGU6IFwiaW52YWxpZF90ZXh0X2NvbnRlbnRzXCIgfSk7XG4gICAgcmV0dXJuIHt9O1xuICB9XG4gIGNvbnN0IG91dDogUGFydGlhbDxSZWNvcmQ8V2lkZ2V0VGV4dEtleSwgc3RyaW5nPj4gPSB7fTtcbiAgZm9yIChjb25zdCBba2V5LCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMocGFyc2VkIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+KSkge1xuICAgIGlmICh0eXBlb2YgdmFsdWUgIT09IFwic3RyaW5nXCIpIGNvbnRpbnVlO1xuICAgIGNvbnN0IHRhcmdldCA9IE9VUl9URVhUX0tFWVMuaGFzKGtleSkgPyAoa2V5IGFzIFdpZGdldFRleHRLZXkpIDogVkVORE9SX1RFWFRfUkVOQU1FU1trZXldO1xuICAgIGlmICh0YXJnZXQpIG91dFt0YXJnZXRdID0gdmFsdWU7XG4gICAgZWxzZSBkZWJ1Zyh7IHR5cGU6IFwidW5tYXBwZWRfdGV4dF9jb250ZW50c19rZXlcIiwga2V5IH0pO1xuICB9XG4gIHJldHVybiBvdXQ7XG59XG5cbi8qKlxuICogVGhlIGZldGNoZWQgKG1lcmdlZCkgY29uZmlnIHdpdGggdGhlIGVsZW1lbnQncyBhdHRyaWJ1dGVzIGxhaWQgb3ZlciBpdDpcbiAqIHRoZSBmb3VyIGRpc3BsYXkgYXR0cmlidXRlcyAoUTkpLCBgdmFyaWFudGAsIGBwbGFjZW1lbnRgLCBgdGVybXMta2V5YCBhbmRcbiAqIGB0ZXh0LWNvbnRlbnRzYCAoUTI1KS4gQW4gaW52YWxpZCB2YWx1ZSBpcyBpZ25vcmVkICh0aGUgY29uZmlnIHN0YXlzKS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG92ZXJsYXlBdHRyaWJ1dGVzKFxuICBjZmc6IFdpZGdldFJ1bnRpbWVDb25maWcsXG4gIGF0dHI6IEF0dHJpYnV0ZVJlYWRlcixcbiAgZGVidWc6IERlYnVnU2luayxcbik6IFdpZGdldFJ1bnRpbWVDb25maWcge1xuICBjb25zdCBvdXQ6IFdpZGdldFJ1bnRpbWVDb25maWcgPSB7IC4uLmNmZyB9O1xuICBmb3IgKGNvbnN0IFtuYW1lLCBrZXldIG9mIERJU1BMQVlfQVRUUklCVVRFUykge1xuICAgIGNvbnN0IHZhbHVlID0gcGFyc2VCb29sKGF0dHIobmFtZSkpO1xuICAgIGlmICh2YWx1ZSAhPT0gdW5kZWZpbmVkKSBvdXRba2V5XSA9IHZhbHVlO1xuICB9XG4gIGNvbnN0IHZhcmlhbnQgPSBhdHRyKFwidmFyaWFudFwiKTtcbiAgaWYgKHZhcmlhbnQgJiYgKFZBUklBTlRTIGFzIHJlYWRvbmx5IHN0cmluZ1tdKS5pbmNsdWRlcyh2YXJpYW50KSkgb3V0LnZhcmlhbnQgPSB2YXJpYW50IGFzIFdpZGdldFZhcmlhbnQ7XG4gIGNvbnN0IHBsYWNlbWVudCA9IGF0dHIoXCJwbGFjZW1lbnRcIik7XG4gIGlmIChwbGFjZW1lbnQgJiYgKFBMQUNFTUVOVFMgYXMgcmVhZG9ubHkgc3RyaW5nW10pLmluY2x1ZGVzKHBsYWNlbWVudCkpIHtcbiAgICBvdXQucGxhY2VtZW50ID0gcGxhY2VtZW50IGFzIFdpZGdldFBsYWNlbWVudDtcbiAgfVxuICBjb25zdCB0ZXJtc0tleSA9IGF0dHIoXCJ0ZXJtcy1rZXlcIik7XG4gIGlmICh0ZXJtc0tleSkgb3V0LnRlcm1zID0geyAuLi5vdXQudGVybXMsIGxvY2FsX3N0b3JhZ2Vfa2V5OiB0ZXJtc0tleSB9O1xuICBjb25zdCB0ZXh0ID0gbWFwVGV4dENvbnRlbnRzKGF0dHIoXCJ0ZXh0LWNvbnRlbnRzXCIpLCBkZWJ1Zyk7XG4gIGlmIChPYmplY3Qua2V5cyh0ZXh0KS5sZW5ndGggPiAwKSBvdXQudGV4dCA9IHsgLi4ub3V0LnRleHQsIC4uLnRleHQgfTtcbiAgcmV0dXJuIG91dDtcbn1cblxuLyoqIFRoZSB2ZW5kb3IncyBgb3ZlcnJpZGUtKmAgYXR0cmlidXRlcyBcdTIxOTIgb3VyIGZsYXQgb3ZlcnJpZGUga2V5cyAodGhlIFx1MDBBNzQuNCB0YWJsZSkuICovXG5leHBvcnQgY29uc3QgT1ZFUlJJREVfQVRUUklCVVRFUyA9IFtcbiAgW1wib3ZlcnJpZGUtcHJvbXB0XCIsIFwic3lzdGVtX3Byb21wdFwiLCBcInN0cmluZ1wiXSxcbiAgW1wib3ZlcnJpZGUtbGxtXCIsIFwibGxtXCIsIFwic3RyaW5nXCJdLFxuICBbXCJvdmVycmlkZS1maXJzdC1tZXNzYWdlXCIsIFwiZmlyc3RfbWVzc2FnZVwiLCBcInN0cmluZ1wiXSxcbiAgW1wib3ZlcnJpZGUtbGFuZ3VhZ2VcIiwgXCJsYW5ndWFnZVwiLCBcInN0cmluZ1wiXSxcbiAgW1wib3ZlcnJpZGUtdm9pY2UtaWRcIiwgXCJ2b2ljZVwiLCBcInN0cmluZ1wiXSxcbiAgW1wib3ZlcnJpZGUtc3BlZWRcIiwgXCJ2b2ljZV9zcGVlZFwiLCBcIm51bWJlclwiXSxcbiAgW1wib3ZlcnJpZGUtc3RhYmlsaXR5XCIsIFwidm9pY2Vfc3RhYmlsaXR5XCIsIFwibnVtYmVyXCJdLFxuICBbXCJvdmVycmlkZS1zaW1pbGFyaXR5LWJvb3N0XCIsIFwidm9pY2Vfc2ltaWxhcml0eVwiLCBcIm51bWJlclwiXSxcbiAgW1wib3ZlcnJpZGUtdGV4dC1vbmx5XCIsIFwidGV4dF9vbmx5XCIsIFwiYm9vbGVhblwiXSxcbl0gYXMgY29uc3Q7XG5cbi8qKiBUaGUgcGVyLWtleSBvdmVycmlkZSBhdHRyaWJ1dGVzIGFzIG9uZSBvdmVycmlkZXMgb2JqZWN0LCBvciBgbnVsbGAgd2hlbiBub25lIGlzIHNldC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBhdHRyaWJ1dGVPdmVycmlkZXMoYXR0cjogQXR0cmlidXRlUmVhZGVyKTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gfCBudWxsIHtcbiAgY29uc3Qgb3V0OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiA9IHt9O1xuICBmb3IgKGNvbnN0IFtuYW1lLCBrZXksIGtpbmRdIG9mIE9WRVJSSURFX0FUVFJJQlVURVMpIHtcbiAgICBjb25zdCByYXcgPSBhdHRyKG5hbWUpO1xuICAgIGlmIChyYXcgPT09IG51bGwgfHwgcmF3ID09PSBcIlwiKSBjb250aW51ZTtcbiAgICBpZiAoa2luZCA9PT0gXCJudW1iZXJcIikge1xuICAgICAgY29uc3QgdmFsdWUgPSBOdW1iZXIocmF3KTtcbiAgICAgIGlmIChOdW1iZXIuaXNGaW5pdGUodmFsdWUpKSBvdXRba2V5XSA9IHZhbHVlO1xuICAgIH0gZWxzZSBpZiAoa2luZCA9PT0gXCJib29sZWFuXCIpIHtcbiAgICAgIGNvbnN0IHZhbHVlID0gcGFyc2VCb29sKHJhdyk7XG4gICAgICBpZiAodmFsdWUgIT09IHVuZGVmaW5lZCkgb3V0W2tleV0gPSB2YWx1ZTtcbiAgICB9IGVsc2Uge1xuICAgICAgb3V0W2tleV0gPSByYXc7XG4gICAgfVxuICB9XG4gIHJldHVybiBPYmplY3Qua2V5cyhvdXQpLmxlbmd0aCA+IDAgPyBvdXQgOiBudWxsO1xufVxuXG4vKiogUTMwIFx1MjAxNCBgdm9zby13aWRnZXQ6ZXhwYW5kIHtkZXRhaWwuYWN0aW9ufWAgXHUyMTkyIHRoZSBuZXh0IGV4cGFuZGVkIHN0YXRlIChgbnVsbGAgPSBpZ25vcmUpLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGV4cGFuZEFjdGlvbihhY3Rpb246IHVua25vd24sIGV4cGFuZGVkOiBib29sZWFuLCBjb2xsYXBzaWJsZTogYm9vbGVhbik6IGJvb2xlYW4gfCBudWxsIHtcbiAgaWYgKGFjdGlvbiA9PT0gXCJleHBhbmRcIikgcmV0dXJuIHRydWU7XG4gIGlmIChhY3Rpb24gPT09IFwiY29sbGFwc2VcIikgcmV0dXJuIGNvbGxhcHNpYmxlID8gZmFsc2UgOiBudWxsO1xuICBpZiAoYWN0aW9uID09PSBcInRvZ2dsZVwiKSByZXR1cm4gZXhwYW5kZWQgPyAoY29sbGFwc2libGUgPyBmYWxzZSA6IG51bGwpIDogdHJ1ZTtcbiAgcmV0dXJuIG51bGw7XG59XG5cbi8qKiBRMjIgXHUyMDE0IHRoZSBpbmJvdW5kIGV2ZW50cyB0aGUgZWxlbWVudCBmb3J3YXJkcyBvbmx5IHVuZGVyIGBhbGxvdy1ldmVudHM9XCJ0cnVlXCJgLiAqL1xuZXhwb3J0IGNvbnN0IEdBVEVEX0lOQk9VTkRfRVZFTlRTID0gW1xuICBcInZvc28td2lkZ2V0OnVzZXItbWVzc2FnZVwiLFxuICBcInZvc28td2lkZ2V0OnVzZXItYWN0aXZpdHlcIixcbiAgXCJ2b3NvLXdpZGdldDpjb250ZXh0dWFsLXVwZGF0ZVwiLFxuXSBhcyBjb25zdDtcblxuLyoqIFRoZSB1bmdhdGVkIFVJIGV2ZW50IChRMzApLCBoZWFyZCBvbiB0aGUgZWxlbWVudCBBTkQgb24gYGRvY3VtZW50YC4gKi9cbmV4cG9ydCBjb25zdCBFWFBBTkRfRVZFTlQgPSBcInZvc28td2lkZ2V0OmV4cGFuZFwiO1xuXG4vKiogRGlzcGF0Y2hlZCAoYnViYmxpbmcsIGNvbXBvc2VkKSBiZWZvcmUgZXZlcnkgc2Vzc2lvbiBzdGFydDsgbGlzdGVuZXJzIG11dGF0ZSBgZGV0YWlsLmNvbmZpZ2AuICovXG5leHBvcnQgY29uc3QgQ0FMTF9FVkVOVCA9IFwidm9zby13aWRnZXQ6Y2FsbFwiO1xuXG5leHBvcnQgdHlwZSBJbmJvdW5kQWN0aW9uID1cbiAgfCB7IGtpbmQ6IFwidXNlci1tZXNzYWdlXCI7IG1lc3NhZ2U6IHN0cmluZyB9XG4gIHwgeyBraW5kOiBcInVzZXItYWN0aXZpdHlcIiB9XG4gIHwgeyBraW5kOiBcImNvbnRleHR1YWwtdXBkYXRlXCI7IG1lc3NhZ2U6IHN0cmluZyB9O1xuXG4vKipcbiAqIFEyMiBcdTIwMTQgd2hhdCBvbmUgaW5ib3VuZCBldmVudCBhc2tzIGZvciwgb3IgYG51bGxgOiBub3RoaW5nIGlzIGZvcndhcmRlZFxuICogdW5sZXNzIHRoZSBlbGVtZW50IGNhcnJpZXMgYGFsbG93LWV2ZW50cz1cInRydWVcImAgKHRoZSB2ZW5kb3IncyBkZWZhdWx0IGtlZXBzXG4gKiB0aGlyZC1wYXJ0eSBzY3JpcHRzIGZyb20gc3RlZXJpbmcgYSBjb252ZXJzYXRpb24pOyBhIG1lc3NhZ2UgZXZlbnQgbmVlZHMgYVxuICogbm9uLWJsYW5rIGBkZXRhaWwubWVzc2FnZWAuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpbmJvdW5kQWN0aW9uKHR5cGU6IHN0cmluZywgYWxsb3dFdmVudHM6IHN0cmluZyB8IG51bGwsIGRldGFpbDogdW5rbm93bik6IEluYm91bmRBY3Rpb24gfCBudWxsIHtcbiAgaWYgKGFsbG93RXZlbnRzICE9PSBcInRydWVcIikgcmV0dXJuIG51bGw7XG4gIGNvbnN0IHJhdyA9IChkZXRhaWwgYXMgeyBtZXNzYWdlPzogdW5rbm93biB9IHwgbnVsbCB8IHVuZGVmaW5lZCk/Lm1lc3NhZ2U7XG4gIGNvbnN0IG1lc3NhZ2UgPSB0eXBlb2YgcmF3ID09PSBcInN0cmluZ1wiID8gcmF3LnRyaW0oKSA6IFwiXCI7XG4gIHN3aXRjaCAodHlwZSkge1xuICAgIGNhc2UgXCJ2b3NvLXdpZGdldDp1c2VyLW1lc3NhZ2VcIjpcbiAgICAgIHJldHVybiBtZXNzYWdlID8geyBraW5kOiBcInVzZXItbWVzc2FnZVwiLCBtZXNzYWdlIH0gOiBudWxsO1xuICAgIGNhc2UgXCJ2b3NvLXdpZGdldDp1c2VyLWFjdGl2aXR5XCI6XG4gICAgICByZXR1cm4geyBraW5kOiBcInVzZXItYWN0aXZpdHlcIiB9O1xuICAgIGNhc2UgXCJ2b3NvLXdpZGdldDpjb250ZXh0dWFsLXVwZGF0ZVwiOlxuICAgICAgcmV0dXJuIG1lc3NhZ2UgPyB7IGtpbmQ6IFwiY29udGV4dHVhbC11cGRhdGVcIiwgbWVzc2FnZSB9IDogbnVsbDtcbiAgICBkZWZhdWx0OlxuICAgICAgcmV0dXJuIG51bGw7XG4gIH1cbn1cbiJdLAogICJtYXBwaW5ncyI6ICI7QUFBQSxPQUFPLFVBQVU7QUFDakIsT0FBTyxZQUFZOzs7QUNrQlosSUFBTSxzQkFBa0M7QUFBQSxFQUM3QyxXQUFXO0FBQUEsRUFDWCxlQUFlLENBQUM7QUFBQSxFQUNoQixzQkFBc0I7QUFBQSxFQUN0QixZQUFZO0FBQ2Q7OztBQ3FGTyxJQUFNLGlCQUErQjtBQUFBLEVBQzFDLE1BQU07QUFBQSxFQUNOLFlBQVk7QUFBQSxFQUNaLGFBQWE7QUFBQSxFQUNiLGFBQWE7QUFBQSxFQUNiLGFBQWE7QUFBQSxFQUNiLGNBQWM7QUFBQSxFQUNkLFlBQVk7QUFBQSxFQUNaLFFBQVE7QUFBQSxFQUNSLGNBQWM7QUFBQSxFQUNkLGVBQWU7QUFBQSxFQUNmLGVBQWU7QUFBQSxFQUNmLGVBQWU7QUFBQSxFQUNmLGdCQUFnQjtBQUNsQjtBQUVPLElBQU0sZ0JBQTZCO0FBQUEsRUFDeEMsaUJBQWlCO0FBQUEsRUFDakIsZUFBZTtBQUFBLEVBQ2YsY0FBYztBQUFBLEVBQ2QsZUFBZTtBQUFBLEVBQ2YsY0FBYztBQUFBLEVBQ2Qsc0JBQXNCO0FBQUEsRUFDdEIsdUJBQXVCO0FBQ3pCO0FBRU8sSUFBTSxpQkFBc0M7QUFBQSxFQUNqRCxZQUFZO0FBQUEsRUFDWixTQUFTO0FBQUEsRUFDVCxXQUFXO0FBQUEsRUFDWCxtQkFBbUI7QUFBQSxFQUNuQixhQUFhO0FBQUEsRUFDYixjQUFjO0FBQUEsRUFDZCxRQUFRLEVBQUUsTUFBTSxPQUFPLFNBQVMsV0FBVyxTQUFTLFVBQVU7QUFBQSxFQUM5RCxRQUFRO0FBQUEsRUFDUixPQUFPO0FBQUEsRUFDUCxPQUFPLEVBQUUs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
