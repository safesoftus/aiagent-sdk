import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { peer, server } from "./harness";
import { Conversation, postOverallFeedback } from "../src/index";
import { overallFeedbackBody } from "../src/feedback";

// E4 Q16 — BOTH vendor feedback shapes natively, no lossy mapping, no
// onDebug no-op. The stored rows are asserted server-side: the per-response
// row by vosopulse-preview `webrtc_feedback_*` (preview_persistence tests),
// the whole-conversation rows by vosopulse-api's convai feedback route tests.

const AGENT = "0191f3c4-5b6a-7c8d-9e0f-a1b2c3d4e5f6";

beforeEach(() => server.reset());

test("feedback shape 1: sendFeedback(like) per response → `feedback {score, event_id}` on the data channel", async () => {
  const conversation = await Conversation.startSession({ agentId: AGENT, origin: "https://api.test" });
  const pc = peer();
  pc.dc.deliver({ type: "bot-output", data: { text: "Hello there.", spoken: true, aggregated_by: "sentence" } });
  conversation.sendFeedback(true);
  const sent = pc.dc.sent.at(-1)!;
  assert.equal(sent.label, "rtvi-ai");
  assert.equal(sent.type, "feedback");
  assert.deepEqual(sent.data, { score: "like", event_id: 1 });
  conversation.sendFeedback(false, 7);
  assert.deepEqual(pc.dc.sent.at(-1)!.data, { score: "dislike", event_id: 7 });
  conversation.sendFeedback(null, 7);
  assert.deepEqual(pc.dc.sent.at(-1)!.data, { score: null, event_id: 7 }, "null clears the thumb");
  await conversation.endSession();
});

test("feedback: sendFeedback when not connected warns and sends nothing", async () => {
  const conversation = await Conversation.startSession({ agentId: AGENT, origin: "https://api.test" });
  await conversation.endSession();
  const pc = peer();
  const before = pc.dc.sent.length;
  const warn = console.warn;
  const warnings: unknown[] = [];
  console.warn = (...args: unknown[]) => warnings.push(args);
  try {
    conversation.sendFeedback(true);
  } finally {
    console.warn = warn;
  }
  assert.equal(pc.dc.sent.length, before);
  assert.equal(warnings.length, 1);
});

test("feedback shape 2: postOverallFeedback(id, like) → thumbs body on the conversation feedback route", async () => {
  await postOverallFeedback("conv_abc", true, "https://api.test/", "sk_key");
  const call = server.calls.at(-1)!;
  assert.equal(call.method, "POST");
  assert.equal(call.url, "https://api.test/v1/convai/conversations/conv_abc/feedback");
  assert.deepEqual(call.body, { feedback: "like" });
  assert.equal(call.headers["Authorization"], "Bearer sk_key");
  await postOverallFeedback("conv_abc", false, "https://api.test");
  assert.deepEqual(server.calls.at(-1)!.body, { feedback: "dislike" });
  assert.equal(server.calls.at(-1)!.headers["Authorization"], undefined, "no key, no header");
});

test("feedback shape 3: postOverallFeedback(id, {rating, comment}) → rating + comment, never mapped to thumbs", async () => {
  await postOverallFeedback("conv_abc", { rating: 4, comment: "Quick and clear" }, "https://api.test");
  assert.deepEqual(server.calls.at(-1)!.body, { rating: 4, comment: "Quick and clear" });
  assert.deepEqual(overallFeedbackBody({ rating: 2 }), { rating: 2 }, "comment omitted when absent");
});

test("feedback: a refused vote rejects with the status", async () => {
  const fetchBefore = globalThis.fetch;
  Reflect.set(globalThis, "fetch", async () => ({ ok: false, status: 401, json: async () => ({}) }));
  try {
    await assert.rejects(postOverallFeedback("conv_abc", true, "https://api.test"), /\(401\)/);
  } finally {
    Reflect.set(globalThis, "fetch", fetchBefore);
  }
});
