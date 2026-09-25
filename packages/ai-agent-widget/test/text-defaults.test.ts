import test from "node:test";
import assert from "node:assert/strict";
import {
  WIDGET_TEXT_DEFAULTS,
  WIDGET_TEXT_KEYS,
  resolveText,
} from "../src/text-defaults";

test("exactly 52 text keys (pinned; backend mirrors this count)", () => {
  assert.equal(WIDGET_TEXT_KEYS.length, 52);
});

test("the queue texts (E7) exist with their exact defaults", () => {
  assert.equal(WIDGET_TEXT_DEFAULTS.queued_status, "Waiting for an available agent…");
  assert.equal(
    WIDGET_TEXT_DEFAULTS.queue_timed_out,
    "No agent became available — please try again later",
  );
});

test("spot-check exact defaults required by the spec", () => {
  assert.equal(WIDGET_TEXT_DEFAULTS.main_label, "Need help?");
  assert.equal(WIDGET_TEXT_DEFAULTS.speaking_status, "Talk to interrupt");
  assert.equal(WIDGET_TEXT_DEFAULTS.typing_indicator, "Agent is typing ...");
  assert.equal(
    WIDGET_TEXT_DEFAULTS.input_placeholder_new_conversation,
    "Start a new conversation",
  );
  assert.equal(WIDGET_TEXT_DEFAULTS.file_type_unsupported, "Unsupported file type. Accepted types:");
});

test("resolveText prefers non-empty overrides, falls back otherwise", () => {
  assert.equal(resolveText({ main_label: "Hi" }, "main_label"), "Hi");
  assert.equal(resolveText({ main_label: "" }, "main_label"), "Need help?");
  assert.equal(resolveText(undefined, "end_call"), "End");
});
