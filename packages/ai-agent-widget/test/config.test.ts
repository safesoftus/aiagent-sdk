import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG, mergeConfig } from "../src/config";

test("defaults: voice and chat both available, composer live during calls", () => {
  assert.equal(DEFAULT_CONFIG.voice_enabled, true);
  assert.equal(DEFAULT_CONFIG.text_enabled, true);
  assert.equal(DEFAULT_CONFIG.send_text_while_on_call, true);
});

test("mergeConfig forces chat availability (no chat-off mode)", () => {
  // Single-toggle model: `text_enabled` is legacy storage — chat is
  // ALWAYS available, whatever a stored config carries.
  const merged = mergeConfig({ text_enabled: false });
  assert.equal(merged.text_enabled, true);
});

test("voice availability is exactly voice_enabled (= !text_only)", () => {
  // A stored config with voice explicitly disabled behaves as
  // Chat (text-only) mode ON: chat available, voice not offered.
  const textOnly = mergeConfig({ voice_enabled: false, text_enabled: false });
  assert.equal(textOnly.voice_enabled, false);
  assert.equal(textOnly.text_enabled, true);

  const both = mergeConfig({ voice_enabled: true });
  assert.equal(both.voice_enabled, true);
  assert.equal(both.text_enabled, true);
});
