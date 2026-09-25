import { test } from "node:test";
import assert from "node:assert/strict";
import { fromOurOverrides, OVERRIDE_TABLE, toOurOverrides, type ConversationOverrides } from "../src/internal/overrides";

const vendor: ConversationOverrides = {
  agent: { prompt: { prompt: "Be brief.", llm: "gpt-x" }, firstMessage: "Hi!", language: "es" },
  tts: { voiceId: "v-1", speed: 1.1, stability: 0.4, similarityBoost: 0.7 },
  asr: { keywords: ["Convoso"] },
  conversation: { textOnly: true },
};

test("overrides: vendor → our flat keys, the table verbatim (plan §4.4)", () => {
  assert.deepEqual(toOurOverrides(vendor, { forwardTextOnly: true }), {
    system_prompt: "Be brief.",
    llm: "gpt-x",
    first_message: "Hi!",
    language: "es",
    voice: "v-1",
    voice_speed: 1.1,
    voice_stability: 0.4,
    voice_similarity: 0.7,
    text_only: true,
    asr: { keywords: ["Convoso"] },
  });
});

test("overrides: text_only is the transport selector — not forwarded by default", () => {
  assert.equal("text_only" in toOurOverrides(vendor), false);
});

test("overrides: our keys → vendor round-trips", () => {
  assert.deepEqual(fromOurOverrides(toOurOverrides(vendor, { forwardTextOnly: true })), vendor);
  assert.equal(OVERRIDE_TABLE.length, 9);
});

test("overrides: empty / absent stays empty", () => {
  assert.deepEqual(toOurOverrides(undefined), {});
  assert.deepEqual(fromOurOverrides({}), {});
});
